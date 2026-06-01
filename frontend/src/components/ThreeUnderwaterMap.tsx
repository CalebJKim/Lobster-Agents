import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type {
  AccessoryDecoration,
  AgentInfo,
  GeneratedHeadwear,
  LobsterAppearance,
  LobsterEyewear,
  LobsterHeadwear,
  NemoClawSandbox,
} from "../types";
import { SANDBOX_WORKSPACES } from "../utils/claws";
import { SPEECH_BUBBLE_TTL_MS } from "../utils/config";
import { AGENT_COLORS, AGENT_COLORS_HEX, ROOMS, type RoomDef } from "../utils/sprites";

const MAP_W = 640;
const MAP_H = 480;
const WORLD_SCALE = 10;
const FLOOR_W = MAP_W / WORLD_SCALE;
const FLOOR_H = MAP_H / WORLD_SCALE;

interface ThreeUnderwaterMapProps {
  agents: AgentInfo[];
  sandboxes?: NemoClawSandbox[];
  selectedAgent: string | null;
  onSelectAgent: (name: string | null) => void;
  onAssignAgentToSandbox?: (agentName: string, sandboxName: string) => void;
  /** Open the floating Task Monitor for the given sandbox. Fires when the user
   *  clicks a sandbox hut and no lobster is currently selected. */
  onOpenSandbox?: (sandboxName: string) => void;
  messages: { id?: string; agent: string; target: string; message: string; type: string; timestamp?: string }[];
  hasActiveQuery?: boolean;
}

interface AgentActor {
  group: THREE.Group;
  body: THREE.Mesh;
  claws: THREE.Group[];
  legs: THREE.Mesh[];
  bubbles: THREE.Group;
  label: THREE.Sprite;
  speech: THREE.Sprite;
  speechKey: string | null;
  ring: THREE.Mesh;
  target: THREE.Vector3;
  roamTarget: THREE.Vector3;
  nextRoamAt: number;
  anchorKey: string;
  sandboxSettled: boolean;
  visualKey: string;
}

interface Runtime {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  clickable: THREE.Object3D[];
  actors: Map<string, AgentActor>;
  resizeObserver: ResizeObserver;
  frame: number;
}

const VILLAGE_CENTER = new THREE.Vector3(-8, 0, -2);

const AGENT_ORDER = ["Clawdia", "Shelldon", "Coraline", "Reefus", "Pearl", "Snips", "Captain Claw"];
let SANDBOX_BY_ROOM = Object.fromEntries(
  SANDBOX_WORKSPACES.map((workspace) => [workspace.homeRoom, workspace.name])
) as Partial<Record<string, string>>;
let ROOM_BY_SANDBOX = Object.fromEntries(
  SANDBOX_WORKSPACES.map((workspace) => [workspace.name, workspace.homeRoom])
) as Partial<Record<string, string>>;

const VISUAL_ROOM_LAYOUT: Partial<
  Record<string, { x: number; z: number; rx: number; rz: number; color: number; phase: number }>
> = {
  // Four shared sandboxes, scattered organically (not on a ring). The
  // rx/rz here is the size of the kelp pad UNDER each hut — bigger now so
  // the huts themselves can be roomier without looking cramped.
  sandbox_cove: { x: -28, z: -14, rx: 7.4, rz: 5.6, color: 0xdce8cf, phase: 0.4 },  // Coral Cove
  sandbox_bridge:       { x:  20, z:  14, rx: 7.4, rz: 5.6, color: 0xe3ead1, phase: 3.2 },  // The Bridge
  sandbox_hollow:     { x:  26, z: -10, rx: 7.4, rz: 5.6, color: 0xdce8cf, phase: 5.5 },  // Quill Hollow
  sandbox_bench:      { x: -12, z:  18, rx: 7.4, rz: 5.6, color: 0xe1ead5, phase: 6.0 },  // Workbench
  war_room: { x: VILLAGE_CENTER.x, z: VILLAGE_CENTER.z, rx: 9.8, rz: 7.6, color: 0xd8dfbd, phase: 2.0 },
  break_room: { x: -31, z: 12, rx: 5.2, rz: 3.8, color: 0xcfe7db, phase: 0.9 },
  lobby: { x: 8, z: -22, rx: 6.4, rz: 4.6, color: 0xdce9ee, phase: 3.7 },
  bulletin_board: { x: 13, z: 16, rx: 5.2, rz: 4.0, color: 0xebd7b1, phase: 1.8 },
};

const STATIC_SANDBOX_ROOM_IDS = new Set(SANDBOX_WORKSPACES.map((workspace) => workspace.homeRoom));
const DYNAMIC_SANDBOX_POSITIONS = [
  { x: -33, z: 1 },
  { x: 34, z: 3 },
  { x: 2, z: 23 },
  { x: -4, z: -27 },
  { x: -31, z: 22 },
  { x: 32, z: -22 },
  { x: 18, z: 24 },
  { x: -24, z: -25 },
];

function updateSandboxLookups(sandboxes: NemoClawSandbox[] | undefined): RoomDef[] {
  const configured = Array.isArray(sandboxes) && sandboxes.length > 0 ? sandboxes : [];
  const byName = new Map(configured.map((sandbox) => [sandbox.name, sandbox]));
  const byHomeRoom = new Map(
    configured
      .filter((sandbox) => typeof sandbox.home_room === "string")
      .map((sandbox) => [sandbox.home_room as string, sandbox]),
  );

  SANDBOX_BY_ROOM = {};
  ROOM_BY_SANDBOX = {};
  const rooms: RoomDef[] = [];

  for (const workspace of SANDBOX_WORKSPACES) {
    const live = byName.get(workspace.name) ?? byHomeRoom.get(workspace.homeRoom);
    const room = ROOMS.find((item) => item.id === workspace.homeRoom);
    if (!room) continue;
    const sandboxName = live?.name ?? workspace.name;
    const homeRoom = live?.home_room ?? workspace.homeRoom;
    SANDBOX_BY_ROOM[homeRoom] = sandboxName;
    ROOM_BY_SANDBOX[sandboxName] = homeRoom;
    rooms.push({
      ...room,
      id: homeRoom,
      label: live?.display_name || workspace.displayName,
    });
  }

  const dynamic = configured.filter((sandbox) => {
    if (!sandbox.home_room) return false;
    return !STATIC_SANDBOX_ROOM_IDS.has(sandbox.home_room);
  });

  dynamic.forEach((sandbox, index) => {
    const homeRoom = sandbox.home_room as string;
    const position = DYNAMIC_SANDBOX_POSITIONS[index % DYNAMIC_SANDBOX_POSITIONS.length];
    const lap = Math.floor(index / DYNAMIC_SANDBOX_POSITIONS.length);
    VISUAL_ROOM_LAYOUT[homeRoom] = {
      x: position.x + Math.sin(index * 1.9) * lap * 2.2,
      z: position.z + Math.cos(index * 1.4) * lap * 2.0,
      rx: 7.4,
      rz: 5.6,
      color: index % 2 ? 0xe3ead1 : 0xdce8cf,
      phase: 0.8 + index * 0.83,
    };
    SANDBOX_BY_ROOM[homeRoom] = sandbox.name;
    ROOM_BY_SANDBOX[sandbox.name] = homeRoom;
    rooms.push({
      id: homeRoom,
      label: sandbox.display_name || sandbox.name.replace(/^nemoclaw-/, "").replace(/-/g, " "),
      x: 0,
      y: 0,
      w: 8,
      h: 7,
      color: 0xf0ddbd,
    });
  });

  return rooms;
}

const IDLE_ROUTE_POINTS = [
  new THREE.Vector3(-30, 0, 6),
  new THREE.Vector3(-22, 0, -2),
  new THREE.Vector3(-16, 0, -14),
  new THREE.Vector3(-5, 0, -18),
  new THREE.Vector3(6, 0, -11),
  new THREE.Vector3(7, 0, 5),
  new THREE.Vector3(-6, 0, 10),
  new THREE.Vector3(-17, 0, 8),
];

function pixelToWorld(x: number, y: number) {
  return new THREE.Vector3((x - MAP_W / 2) / WORLD_SCALE, 0, (y - MAP_H / 2) / WORLD_SCALE);
}

function agentTarget(agent: AgentInfo) {
  const visual = visualAgentTarget(agent);
  if (visual) return visual;

  const target = pixelToWorld(agent.position.x, agent.position.y);
  if (agent.location.startsWith("sandbox_")) {
    target.z += 2.75;
  }
  return target;
}

function sandboxRoomForAgent(agent?: AgentInfo | null): RoomDef["id"] | null {
  if (agent?.sandbox_home_room) return agent.sandbox_home_room;
  if (!agent?.sandbox_name) return null;
  return ROOM_BY_SANDBOX[agent.sandbox_name] ?? null;
}

function agentAnchorKey(agent: AgentInfo) {
  return `${sandboxRoomForAgent(agent) ?? agent.location}:${agent.sandbox_name ?? ""}`;
}

function roomCenter(room: RoomDef) {
  const visual = VISUAL_ROOM_LAYOUT[room.id];
  if (visual) return new THREE.Vector3(visual.x, 0, visual.z);

  const x = (room.x + room.w / 2) * 16;
  const y = (room.y + room.h / 2) * 16;
  return pixelToWorld(x, y);
}

function sandboxLocalToWorld(roomId: RoomDef["id"], localX: number, localZ: number) {
  const room = ROOMS.find((item) => item.id === roomId);
  const layout = VISUAL_ROOM_LAYOUT[roomId];
  const center = layout
    ? new THREE.Vector3(layout.x, 0, layout.z)
    : room
      ? roomCenter(room)
      : pixelToWorld(MAP_W / 2, MAP_H / 2);
  const rotation = angleToward(center);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return center.clone().add(
    new THREE.Vector3(
      localX * cos + localZ * sin,
      0,
      -localX * sin + localZ * cos
    )
  );
}

function sandboxSlotLocalPosition(name: string, radiusScale = 1) {
  const index = Math.max(0, AGENT_ORDER.indexOf(name));
  const angle = -Math.PI / 2 + index * ((Math.PI * 2) / AGENT_ORDER.length);
  return {
    x: Math.cos(angle) * 1.65 * radiusScale,
    z: Math.sin(angle) * 1.05 * radiusScale,
  };
}

function visualAgentTarget(agent: AgentInfo) {
  const sandboxRoom = sandboxRoomForAgent(agent);
  if (sandboxRoom) {
    // Wider radius so lobsters spread out inside the (now larger) sandbox huts.
    return sandboxGatherPosition(agent.name, sandboxRoom, 0.9);
  }

  const location = agent.location as RoomDef["id"];
  if (location.startsWith("sandbox_")) {
    // Inconsistent state: location is a sandbox room but no sandbox_name set.
    // Treat them as free-roaming in the reef commons.
    return freeReefPosition(agent.name);
  }
  const layout = VISUAL_ROOM_LAYOUT[location];
  if (!layout) return null;

  const center = new THREE.Vector3(layout.x, 0, layout.z);

  const { x, z } = orbitOffset(agent.name, location === "war_room" ? 4.25 : 2.15, location === "war_room" ? 3.0 : 1.55);
  return center.add(new THREE.Vector3(x, 0, z));
}

function freeReefPosition(name: string) {
  const { x, z } = orbitOffset(name, 7.4, 5.2);
  return VILLAGE_CENTER.clone().add(new THREE.Vector3(x, 0, z));
}

function sandboxGatherPosition(name: string, roomId: RoomDef["id"], radiusScale = 1) {
  const layout = VISUAL_ROOM_LAYOUT[roomId];
  if (!layout) return pixelToWorld(MAP_W / 2, MAP_H / 2);

  const slot = sandboxSlotLocalPosition(name, radiusScale);
  return sandboxLocalToWorld(roomId, slot.x, slot.z);
}

function orbitOffset(name: string, rx: number, rz: number) {
  const index = Math.max(0, AGENT_ORDER.indexOf(name));
  const angle = -Math.PI / 2 + index * ((Math.PI * 2) / AGENT_ORDER.length);
  return { x: Math.cos(angle) * rx, z: Math.sin(angle) * rz };
}

function seededAgentValue(name: string) {
  return name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function isFocusedWorkState(agent?: AgentInfo | null) {
  if (!agent) return false;
  return Boolean(agent.current_task) || agent.state === "researching" || agent.state === "coding" || agent.state === "presenting";
}

function pickIdleRoamTarget(name: string, elapsed: number, current: THREE.Vector3, agent?: AgentInfo) {
  const index = Math.max(0, AGENT_ORDER.indexOf(name));
  const seed = seededAgentValue(name);

  if (agent && sandboxRoomForAgent(agent)) {
    return agentTarget(agent);
  }

  const routeIndex = Math.floor(elapsed / 5 + index * 2 + seed) % IDLE_ROUTE_POINTS.length;
  const routePoint = IDLE_ROUTE_POINTS[routeIndex].clone();
  const commons = VILLAGE_CENTER.clone().add(
    new THREE.Vector3(
      Math.sin(index * 1.7) * 6.2,
      0,
      Math.cos(index * 1.3) * 4.5
    )
  );
  const useCommons = Math.floor(elapsed / 14 + index) % 4 === 0;
  const base = useCommons ? commons : routePoint;
  const wobble = new THREE.Vector3(
    Math.sin(elapsed * 0.71 + seed) * 1.2,
    0,
    Math.cos(elapsed * 0.53 + seed * 0.4) * 0.95
  );

  if (current.distanceTo(VILLAGE_CENTER) > 34) {
    return commons;
  }

  return base.add(wobble);
}

function moveToward(current: THREE.Vector3, target: THREE.Vector3, maxStep: number) {
  const delta = target.clone().sub(current);
  const distance = delta.length();
  if (distance <= maxStep || distance === 0) {
    current.copy(target);
    return;
  }
  current.add(delta.multiplyScalar(maxStep / distance));
}

function angleToward(from: THREE.Vector3, to = VILLAGE_CENTER) {
  const delta = to.clone().sub(from);
  return Math.atan2(delta.x, delta.z);
}

function makeCanvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 512, h = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas texture");
  draw(ctx, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

function makeSandTexture() {
  return makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = "#d7c49d";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const alpha = 0.08 + Math.random() * 0.12;
      ctx.fillStyle = Math.random() > 0.45 ? `rgba(117, 94, 63, ${alpha})` : `rgba(255, 246, 209, ${alpha})`;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for (let i = 0; i < 15; i++) {
      ctx.strokeStyle = `rgba(255, 255, 240, ${0.08 + Math.random() * 0.08})`;
      ctx.lineWidth = 2 + Math.random() * 2;
      ctx.beginPath();
      const baseY = Math.random() * h;
      for (let x = 0; x <= w; x += 12) {
        const y = baseY + Math.sin(x * 0.03 + i) * 12;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

function makeOceanTexture() {
  return makeCanvasTexture((ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, "#2bbfd0");
    gradient.addColorStop(0.48, "#1596b4");
    gradient.addColorStop(1, "#0b5f82");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(234, 255, 255, ${0.045 + Math.random() * 0.055})`;
      ctx.lineWidth = 1 + Math.random() * 1.6;
      ctx.beginPath();
      const baseY = Math.random() * h;
      const phase = Math.random() * Math.PI * 2;
      for (let x = -20; x <= w + 20; x += 14) {
        const y = baseY + Math.sin(x * 0.022 + phase) * (10 + Math.random() * 4);
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    for (let i = 0; i < 1800; i++) {
      const alpha = 0.025 + Math.random() * 0.045;
      ctx.fillStyle = `rgba(210, 255, 255, ${alpha})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  });
}

function makeTextSprite(text: string, color = "#f7fbff", bg = "rgba(8, 35, 45, 0.58)") {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create text sprite");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "700 28px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  const textW = Math.ceil(ctx.measureText(text).width);
  const pillW = Math.min(360, textW + 44);
  const x = (canvas.width - pillW) / 2;
  ctx.fillStyle = bg;
  roundRect(ctx, x, 20, pillW, 50, 18);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, x + 2, 22, pillW - 4, 46, 16);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, 45);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.8, 1.7, 1);
  return sprite;
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      return;
    }
    if (line) lines.push(line);
    line = word;
  });
  if (line) lines.push(line);

  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines && clipped.length > 0) {
    let last = clipped[clipped.length - 1];
    while (last.length > 0 && ctx.measureText(`${last}...`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    clipped[clipped.length - 1] = `${last.trim()}...`;
  }
  return clipped;
}

/**
 * High-contrast speech bubble drawn to an offscreen canvas, then mapped to a
 * camera-facing sprite above the lobster. The old version was nearly white
 * with 72%-opacity slate text — fine on paper, invisible over the aqua reef.
 * This one uses a dark glassy fill with crisp white type so dialogue is
 * actually readable at the demo's default camera distance.
 */
/**
 * Speech bubble drawn to an offscreen canvas. Just the message — the speaker
 * is already obvious from which lobster the bubble is anchored to, so the
 * "Reefus → Snips" header was wasted space. Every pixel goes to the words now.
 * Identity (color swatch) is encoded only as a thin accent strip on the left
 * so you can still tell who's talking at a glance without losing room.
 */
function makeSpeechTexture(agent: string, _target: string, message: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create speech texture");

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bubbleX = 28;
  const bubbleY = 28;
  const bubbleW = canvas.width - 56;
  const bubbleH = canvas.height - 96; // leave room for the pointer tail
  const radius = 34;

  // Drop shadow so the bubble pops off the reef.
  ctx.shadowColor = "rgba(2, 14, 22, 0.6)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 12;

  // Dark glass fill — readable over both light sand and dark water.
  ctx.fillStyle = "rgba(10, 24, 36, 0.94)";
  roundRect(ctx, bubbleX, bubbleY, bubbleW, bubbleH, radius);
  ctx.fill();

  // Triangle tail pointing down toward the lobster.
  ctx.beginPath();
  const tailX = canvas.width / 2;
  const tailTop = bubbleY + bubbleH - 1;
  ctx.moveTo(tailX - 32, tailTop);
  ctx.lineTo(tailX + 32, tailTop);
  ctx.lineTo(tailX, tailTop + 52);
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Subtle outer hairline.
  ctx.strokeStyle = "rgba(160, 220, 235, 0.28)";
  ctx.lineWidth = 3;
  roundRect(ctx, bubbleX + 1.5, bubbleY + 1.5, bubbleW - 3, bubbleH - 3, radius - 1.5);
  ctx.stroke();

  // Left-edge accent bar in the speaker's color — keeps identity without
  // burning a whole line of text on a header.
  const accent = AGENT_COLORS[agent] ?? "#7dd3fc";
  ctx.fillStyle = accent;
  roundRect(ctx, bubbleX + 18, bubbleY + 28, 10, bubbleH - 56, 5);
  ctx.fill();

  // Message body — fill the bubble. Bigger font, fewer lines, vertically
  // centered so 1-liners don't float at the top. Most reef chat is one or
  // two short sentences anyway; 3 lines is the cap.
  ctx.fillStyle = "rgba(248, 252, 254, 0.97)";
  ctx.font = "600 68px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "top";
  const padLeft = 56;
  const padRight = 48;
  const textLeft = bubbleX + padLeft;
  const textRight = bubbleX + bubbleW - padRight;
  const lineHeight = 88;
  const maxLines = 3;
  const lines = wrapCanvasText(ctx, message, textRight - textLeft, maxLines);
  const blockHeight = lines.length * lineHeight;
  const blockTop = bubbleY + (bubbleH - blockHeight) / 2 - 6;
  lines.forEach((line, index) => {
    ctx.fillText(line, textLeft, blockTop + index * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps — text doesn't need trilinear smoothing between mip levels,
  // and the smoothing is what was making it look fuzzy when the bubble
  // shrinks to ~60-100 px on screen. LinearFilter both ways + max anisotropy
  // gives crisp downsampling without the mipmap smear.
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 16;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function makeIslandShape(rx: number, rz: number, phase: number, steps = 132) {
  return new THREE.Shape(makeBlobPoints(rx, rz, phase, steps));
}

function makeShoreLine(points: THREE.Vector2[], y: number, color: number, opacity: number, scale = 1) {
  const edgePoints = points.map((p) => new THREE.Vector3(p.x * scale, y, -p.y * scale));
  edgePoints.push(edgePoints[0].clone());
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(edgePoints),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity })
  );
}

function makeOceanCaustics(scene: THREE.Scene) {
  const material = new THREE.LineBasicMaterial({ color: 0xeaffff, transparent: true, opacity: 0.12 });
  for (let i = 0; i < 18; i++) {
    const z = -29 + i * 3.4;
    const xStart = -48 + (i % 4) * 1.6;
    const points: THREE.Vector3[] = [];
    for (let j = 0; j < 36; j++) {
      const x = xStart + j * 2.9;
      const y = 0.045;
      points.push(new THREE.Vector3(x, y, z + Math.sin(j * 0.72 + i * 1.15) * 0.55));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone());
    line.rotation.y = -0.06;
    scene.add(line);
  }
}

function makeGround(scene: THREE.Scene) {
  const oceanW = FLOOR_W + 150;
  const oceanH = FLOOR_H + 132;
  const ocean = makeOceanTexture();
  ocean.repeat.set(1, 1);
  const oceanFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(oceanW, oceanH, 16, 16),
    new THREE.MeshBasicMaterial({ map: ocean, color: 0x8be9ef })
  );
  oceanFloor.rotation.x = -Math.PI / 2;
  oceanFloor.position.y = -0.045;
  scene.add(oceanFloor);

  const lagoonPoints = makeBlobPoints(45.5, 32.2, 1.35, 132);
  const lagoon = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(lagoonPoints)),
    new THREE.MeshBasicMaterial({
      color: 0x8ce8dc,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    })
  );
  lagoon.rotation.x = -Math.PI / 2;
  lagoon.position.y = -0.018;
  scene.add(lagoon);

  const sand = makeSandTexture();
  sand.repeat.set(6, 5);
  const islandPoints = makeBlobPoints(42.4, 29.4, 0.82, 132);
  const ground = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(islandPoints)),
    new THREE.MeshStandardMaterial({
      map: sand,
      roughness: 0.96,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.006;
  ground.receiveShadow = true;
  scene.add(ground);

  const wetSand = new THREE.Mesh(
    new THREE.ShapeGeometry(makeIslandShape(43.5, 30.4, 0.96, 132)),
    new THREE.MeshBasicMaterial({
      color: 0xf1dfb3,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.position.y = 0.014;
  scene.add(wetSand);

  scene.add(makeShoreLine(islandPoints, 0.055, 0xffffff, 0.3, 1.006));
  scene.add(makeShoreLine(lagoonPoints, 0.03, 0xdffcff, 0.22, 1.004));
  makeOceanCaustics(scene);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(oceanW, oceanH),
    new THREE.MeshBasicMaterial({ color: 0x9df7f3, transparent: true, opacity: 0.075, depthWrite: false })
  );
  water.name = "water-sheet";
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.08;
  scene.add(water);
}

function makeBlobPoints(rx: number, rz: number, phase: number, steps = 72) {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const wobble =
      1 +
      Math.sin(angle * 2.0 + phase) * 0.08 +
      Math.sin(angle * 5.0 + phase * 1.7) * 0.045;
    points.push(new THREE.Vector2(Math.cos(angle) * rx * wobble, Math.sin(angle) * rz * wobble));
  }
  return points;
}

function makeOrganicPad(
  scene: THREE.Scene,
  center: THREE.Vector3,
  rx: number,
  rz: number,
  color: number,
  opacity: number,
  phase: number
) {
  const points = makeBlobPoints(rx, rz, phase);
  const shape = new THREE.Shape(points);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(center.x, 0.018, center.z);
  scene.add(plate);

  const edgePoints = points.map((p) => new THREE.Vector3(center.x + p.x, 0.038, center.z - p.y));
  edgePoints.push(edgePoints[0].clone());
  scene.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: Math.min(opacity * 0.45, 0.075) })
    )
  );
}

function makeReefLabel(scene: THREE.Scene, text: string, center: THREE.Vector3, scale = 4.4) {
  const label = makeTextSprite(text, "#eef9ff", "rgba(10, 64, 76, 0.48)");
  label.position.set(center.x, 1.15, center.z);
  label.scale.set(scale, 1.05, 1);
  scene.add(label);
}

function makeShellPath(scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, phase: number) {
  const start = from.clone().setY(0.11);
  const end = to.clone().setY(0.11);
  const direction = end.clone().sub(start);
  const perp = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  const bend = Math.sin(phase) * 2.2 + Math.cos(phase * 1.7) * 1.2;
  const mid = start.clone().lerp(end, 0.5).add(perp.multiplyScalar(bend));
  const curve = new THREE.CatmullRomCurve3([start, mid, end]);

  const bed = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 42, 0.16, 8, false),
    new THREE.MeshStandardMaterial({
      color: 0xe9d9ae,
      transparent: true,
      opacity: 0.3,
      roughness: 0.9,
    })
  );
  bed.receiveShadow = true;
  scene.add(bed);

  const shellMats = [
    new THREE.MeshStandardMaterial({ color: 0xf8e4b9, roughness: 0.55 }),
    new THREE.MeshStandardMaterial({ color: 0x85ddd4, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xf4a4b8, roughness: 0.55 }),
  ];
  const steps = Math.max(8, Math.floor(from.distanceTo(to) / 1.4));
  for (let i = 1; i < steps; i++) {
    const pos = curve.getPoint(i / steps);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), shellMats[i % shellMats.length]);
    shell.position.set(pos.x, 0.2, pos.z);
    shell.scale.set(1.45, 0.28, 0.82);
    shell.rotation.y = phase + i * 0.8;
    shell.castShadow = true;
    scene.add(shell);
  }
}

// Real NVIDIA eye-mark SVG path (path #2 from the official Wikimedia
// commons NVIDIA_logo.svg). This is the asymmetric curl-into-a-stylized-eye
// shape; we feed it to SVGLoader and let it produce real THREE.Shape
// objects (with even-odd holes) which we then extrude into 3D.
const NVIDIA_EYE_SVG_PATH =
  "M82.211 102.414s22.504-33.203 67.437-36.638V53.73c-49.769 3.997-92.867 46.149-92.867 46.149s24.41 70.564 92.867 77.026v-12.804c-50.237-6.32-67.437-61.687-67.437-61.687zm67.437 36.223v11.727c-37.968-6.77-48.507-46.237-48.507-46.237s18.23-20.195 48.507-23.47v12.867c-.023 0-.039-.007-.058-.007-15.891-1.907-28.305 12.938-28.305 12.938s6.958 24.99 28.363 32.182m0-107.125V53.73c1.461-.112 2.922-.207 4.391-.257 56.582-1.907 93.449 46.406 93.449 46.406s-42.343 51.488-86.457 51.488c-4.043 0-7.828-.375-11.383-1.005v13.739a75.04 75.04 0 0 0 9.481.612c41.051 0 70.738-20.965 99.484-45.778 4.766 3.817 24.278 13.103 28.289 17.167-27.332 22.884-91.031 41.33-127.144 41.33-3.481 0-6.824-.211-10.11-.528v19.306H305.68V31.512H149.648zm0 49.144V65.777c1.446-.101 2.903-.179 4.391-.226 40.688-1.278 67.382 34.965 67.382 34.965s-28.832 40.042-59.746 40.042c-4.449 0-8.438-.715-12.028-1.922V93.523c15.84 1.914 19.028 8.911 28.551 24.786l21.181-17.859s-15.461-20.277-41.524-20.277c-2.834-.001-5.545.198-8.207.483";

function makeNvidiaEyeMark(): THREE.Group {
  // 3D NVIDIA eye-mark, built from the actual NVIDIA logo SVG path. Three.js's
  // SVGLoader parses the path string into THREE.Shape objects honoring the
  // even-odd fill rule, so the inner reveals and outer outline come out as
  // a single solid with holes — not a wonky donut.
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x76b900,
    emissive: 0x4d8400,
    emissiveIntensity: 0.55,
    roughness: 0.3,
    metalness: 0.2,
  });

  const svgString = `<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="${NVIDIA_EYE_SVG_PATH}"/></svg>`;
  const svgData = new SVGLoader().parse(svgString);

  const meshGroup = new THREE.Group();
  svgData.paths.forEach((path) => {
    const shapes = SVGLoader.createShapes(path);
    shapes.forEach((shape) => {
      const geom = new THREE.ExtrudeGeometry(shape, {
        depth: 12,
        bevelEnabled: true,
        bevelThickness: 1.4,
        bevelSize: 1.2,
        bevelSegments: 4,
        curveSegments: 24,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshGroup.add(mesh);
    });
  });

  // Center on the SVG bbox so subsequent scale/rotate happens around its
  // visual midpoint.
  const bbox = new THREE.Box3().setFromObject(meshGroup);
  const center = bbox.getCenter(new THREE.Vector3());
  meshGroup.position.set(-center.x, -center.y, -center.z);

  const size = bbox.getSize(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.add(meshGroup);

  // Fit a 2.4-unit-wide footprint on the 1.7-radius platform.
  const targetWidth = 2.4;
  const s = targetWidth / size.x;
  wrapper.scale.set(s, s, s);

  // rotation.x = +Math.PI/2 lays the shape flat AND fixes SVG's Y-down
  // convention in a single step. After this rotation the extrude depth
  // points up out of the platform and the logo reads right-side-up from
  // the default camera angle.
  wrapper.rotation.x = Math.PI / 2;

  root.add(wrapper);
  return root;
}

function makeNvidiaCenterpiece(scene: THREE.Scene, center: THREE.Vector3) {
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);

  // Rock outcrop rising from inside the conference table. Base is narrow
  // enough (~1.3 r) to fit between the shell seats (seats sit at r ≈ 2.2),
  // and the whole stack is tall enough that the logo platform clears the
  // seats and reads cleanly from the default camera angle.
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x3e4a55,
    roughness: 0.88,
    metalness: 0.06,
  });

  // Base boulder — chunky, rotated to break up symmetry.
  const base = new THREE.Mesh(new THREE.DodecahedronGeometry(1.35, 0), rockMat);
  base.scale.set(1.05, 1.35, 1.05);
  base.position.y = 1.05;
  base.rotation.set(0.15, 0.6, -0.1);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  // Upper boulder — slightly narrower, offset for an irregular silhouette.
  const upper = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), rockMat);
  upper.scale.set(1.15, 0.9, 1.0);
  upper.position.set(0.12, 2.05, -0.08);
  upper.rotation.set(-0.2, 1.4, 0.3);
  upper.castShadow = true;
  upper.receiveShadow = true;
  group.add(upper);

  // Small side chunk to add asymmetry near the base.
  const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), rockMat);
  chunk.scale.set(1.2, 0.7, 0.95);
  chunk.position.set(-1.0, 0.55, 0.6);
  chunk.rotation.set(0.4, -0.9, 0.2);
  chunk.castShadow = true;
  chunk.receiveShadow = true;
  group.add(chunk);

  // Flat dark platform sitting on top of the rock — clean stage for the logo.
  const platformY = 2.85;
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.85, 0.16, 32),
    new THREE.MeshStandardMaterial({
      color: 0x14181f,
      roughness: 0.45,
      metalness: 0.4,
    }),
  );
  platform.position.y = platformY;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  // NVIDIA-green emissive rim around the platform edge.
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.72, 0.045, 10, 72),
    new THREE.MeshStandardMaterial({
      color: 0x76b900,
      roughness: 0.3,
      emissive: 0x76b900,
      emissiveIntensity: 1.1,
    }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = platformY + 0.09;
  group.add(rim);

  // 3D NVIDIA eye-mark. Two interlocking lens shapes traced with bezier
  // curves, extruded with a slight bevel, then laid flat on the platform.
  // No PNG / texture — purely vector geometry so it stays crisp at any
  // zoom and catches the green key-light on its bevel.
  const logo = makeNvidiaEyeMark();
  logo.position.y = platformY + 0.09;
  group.add(logo);

  // Subtle green key-light from above to make the rim and logo pop.
  const key = new THREE.PointLight(0x9aff33, 0.9, 6.5, 1.4);
  key.position.set(0, platformY + 2.0, 0);
  group.add(key);

  // Soft green halo on the reef floor at the rock's footprint.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.6, 64),
    new THREE.MeshBasicMaterial({
      color: 0x76b900,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.04;
  group.add(halo);

  scene.add(group);
}

function makeVillageCove(scene: THREE.Scene) {
  // The two big pale "village" pads (32×24 and 20×15) used to live here as
  // a hub for the 7-sandbox-on-a-ring layout. With scattered huts they
  // stacked into a ~60%-opacity wash that gave the centre of the map a
  // milky cast. Removed. War-room landmark pad is still drawn below via
  // the per-room loop, just smaller and less opaque.

  ROOMS.forEach((room) => {
    const layout = VISUAL_ROOM_LAYOUT[room.id];
    if (!layout) return;
    const center = roomCenter(room);
    makeOrganicPad(
      scene,
      center,
      layout.rx,
      layout.rz,
      layout.color,
      room.id.startsWith("sandbox_") ? 0.12 : room.id === "war_room" ? 0.16 : 0.1,
      layout.phase,
    );
  });

  // Centerpiece: dark rock with the NVIDIA wordmark on top.
  makeNvidiaCenterpiece(scene, VILLAGE_CENTER);
}

function makeNemoSandbox(room: RoomDef) {
  const group = new THREE.Group();
  const center = roomCenter(room);
  const sandboxName = SANDBOX_BY_ROOM[room.id];
  group.name = `nemoclaw-sandbox-${room.id}`;
  if (sandboxName) group.userData.sandboxName = sandboxName;
  group.position.copy(center);
  group.position.y = 0.05;
  group.rotation.y = angleToward(group.position);

  const accent = AGENT_COLORS_HEX[roomAgentName(room.id)] ?? 0x80d9d6;
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd7c69f, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x6d7f79, roughness: 0.78 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xa8f4f0,
    transparent: true,
    opacity: 0.26,
    roughness: 0.03,
    transmission: 0.45,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.42,
    emissive: accent,
    emissiveIntensity: 0.18,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x16343a,
    roughness: 0.5,
    emissive: accent,
    emissiveIntensity: 0.08,
  });

  const sand = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.24, 3.85), sandMat);
  sand.position.y = 0.18;
  sand.receiveShadow = true;
  group.add(sand);

  const underlay = new THREE.Mesh(new THREE.BoxGeometry(6.15, 0.18, 4.3), rimMat);
  underlay.position.y = 0.06;
  underlay.castShadow = true;
  underlay.receiveShadow = true;
  group.add(underlay);

  const walls: [number, number, number, number, number][] = [
    [0, 0.72, 2.08, 6.2, 0.72],
    [0, 0.72, -2.08, 6.2, 0.72],
    [-3.1, 0.72, 0, 0.18, 0.72],
    [3.1, 0.72, 0, 0.18, 0.72],
  ];
  walls.forEach(([x, y, z, w, h], index) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, index < 2 ? 0.16 : 4.16),
      glassMat
    );
    wall.position.set(x, y, z);
    wall.castShadow = true;
    group.add(wall);
  });

  const rail = new THREE.Mesh(new THREE.TorusGeometry(2.85, 0.055, 8, 56), accentMat);
  rail.scale.z = 0.68;
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 1.12;
  group.add(rail);

  for (let i = 0; i < 4; i++) {
    const x = i < 2 ? -3.08 : 3.08;
    const z = i % 2 === 0 ? -2.06 : 2.06;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.05, 8), rimMat);
    post.position.set(x, 0.62, z);
    post.castShadow = true;
    group.add(post);
  }

  const consoleBase = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.38, 0.72), darkMat);
  consoleBase.position.set(2.05, 0.54, 1.42);
  consoleBase.rotation.y = -0.32;
  consoleBase.castShadow = true;
  group.add(consoleBase);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.42, 0.05), accentMat);
  screen.position.set(2.05, 0.88, 1.23);
  screen.rotation.y = -0.32;
  group.add(screen);

  for (let i = 0; i < 5; i++) {
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), i % 2 ? accentMat : rimMat);
    bead.position.set(-2.25 + i * 0.55, 0.38 + Math.sin(i) * 0.025, -1.35 + Math.cos(i) * 0.16);
    bead.scale.set(1.3, 0.45, 0.9);
    bead.castShadow = true;
    group.add(bead);
  }

  const label = makeTextSprite(room.label.replace(" Sandbox", ""), "#eef9ff", "rgba(10, 64, 76, 0.54)");
  label.position.set(0, 1.72, -2.9);
  label.scale.set(4.1, 0.96, 1);
  group.add(label);

  group.traverse((obj) => {
    if (sandboxName) obj.userData.sandboxName = sandboxName;
  });

  // Scale the whole hut up so multiple lobsters fit comfortably inside.
  // The lobster gather radius is bumped to 0.9 in visualAgentTarget to match.
  group.scale.setScalar(1.4);
  return group;
}

function roomAgentName(roomId: string) {
  const byRoom: Record<string, string> = {
    sandbox_cove: "Clawdia",
    desk_analyst: "Shelldon",
    desk_critic: "Coraline",
    desk_planner: "Reefus",
    sandbox_hollow: "Pearl",
    sandbox_bench: "Snips",
    sandbox_bridge: "Captain Claw",
  };
  return byRoom[roomId];
}

function makeTideTable() {
  const group = new THREE.Group();
  const room = ROOMS.find((r) => r.id === "war_room");
  if (!room) return group;
  const center = roomCenter(room);
  group.position.set(center.x, 0.12, center.z + 0.9);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x6a7769, roughness: 0.85 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.35, 16), tableMat);
  table.position.y = 0.35;
  table.castShadow = true;
  table.receiveShadow = true;
  group.add(table);

  for (let i = 0; i < 9; i++) {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.16 + (i % 3) * 0.04, 8, 6),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf6c57b : 0x6ed7cf, roughness: 0.5 })
    );
    const a = (i / 9) * Math.PI * 2;
    shell.position.set(Math.cos(a) * 2.2, 0.62, Math.sin(a) * 1.4);
    shell.scale.set(1.4, 0.45, 0.85);
    group.add(shell);
  }

  const label = makeTextSprite(room.label, "#eef9ff", "rgba(10, 64, 76, 0.5)");
  label.position.set(0, 1.35, -4.4);
  label.scale.set(4.2, 1.0, 1);
  group.add(label);
  return group;
}

function makeShellLounge() {
  const group = new THREE.Group();
  const room = ROOMS.find((r) => r.id === "break_room");
  if (!room) return group;
  const center = roomCenter(room);
  group.position.set(center.x, 0.1, center.z);
  group.rotation.y = angleToward(group.position);

  const seatMat = new THREE.MeshStandardMaterial({ color: 0x7b8780, roughness: 0.86 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x67cfc6, roughness: 0.55 });
  for (let i = 0; i < 4; i++) {
    const angle = -0.9 + i * 0.6;
    const seat = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 0), seatMat);
    seat.position.set(Math.cos(angle) * 2.4, 0.42, Math.sin(angle) * 1.45);
    seat.scale.set(1.25, 0.55, 0.95);
    seat.rotation.y = -angle;
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    const cushion = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 6), cushionMat);
    cushion.position.set(seat.position.x, 0.78, seat.position.z);
    cushion.scale.set(1.25, 0.28, 0.75);
    group.add(cushion);
  }

  const label = makeTextSprite(room.label, "#eef9ff", "rgba(10, 64, 76, 0.5)");
  label.position.set(0, 1.35, -2.9);
  label.scale.set(4.0, 0.95, 1);
  group.add(label);
  return group;
}

function makeTidePool() {
  const group = new THREE.Group();
  const room = ROOMS.find((r) => r.id === "lobby");
  if (!room) return group;
  const center = roomCenter(room);
  group.position.set(center.x, 0.08, center.z);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(3.3, 3.65, 0.28, 28),
    new THREE.MeshStandardMaterial({ color: 0x6e8177, roughness: 0.8 })
  );
  rim.position.y = 0.18;
  rim.scale.z = 0.72;
  rim.castShadow = true;
  rim.receiveShadow = true;
  group.add(rim);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.82, 36),
    new THREE.MeshPhysicalMaterial({
      color: 0x7bdde0,
      transparent: true,
      opacity: 0.68,
      roughness: 0.05,
      transmission: 0.25,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.36;
  water.scale.y = 0.72;
  group.add(water);

  const label = makeTextSprite(room.label, "#eef9ff", "rgba(10, 64, 76, 0.5)");
  label.position.set(0, 1.1, -3.1);
  label.scale.set(3.6, 0.9, 1);
  group.add(label);
  return group;
}

function makeNoticeRock() {
  const group = new THREE.Group();
  const room = ROOMS.find((r) => r.id === "bulletin_board");
  if (!room) return group;
  const center = roomCenter(room);
  group.position.set(center.x, 0.1, center.z);
  group.rotation.y = angleToward(group.position);

  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.8, 0),
    new THREE.MeshStandardMaterial({ color: 0x7a7d76, roughness: 0.9 })
  );
  rock.scale.set(1.35, 0.85, 0.72);
  rock.position.y = 0.85;
  rock.castShadow = true;
  rock.receiveShadow = true;
  group.add(rock);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1.1, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xe7c48f, roughness: 0.72 })
  );
  board.position.set(0, 1.12, 1.15);
  board.castShadow = true;
  group.add(board);

  const label = makeTextSprite(room.label, "#eef9ff", "rgba(10, 64, 76, 0.5)");
  label.position.set(0, 1.72, -2.2);
  label.scale.set(3.8, 0.9, 1);
  group.add(label);
  return group;
}

export function makeCoralPatch(x: number, z: number, color: number, count = 8, spread = 1.35, height = 1.15) {
  const group = new THREE.Group();
  group.position.set(x, 0.05, z);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.62,
    emissive: color,
    emissiveIntensity: 0.025,
  });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xf7f0cf, roughness: 0.55 });
  for (let i = 0; i < count; i++) {
    const branchHeight = height * (0.55 + Math.random() * 0.72);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.085, branchHeight, 7), mat);
    branch.position.set((Math.random() - 0.5) * spread, branchHeight / 2, (Math.random() - 0.5) * spread);
    branch.rotation.z = (Math.random() - 0.5) * 0.7;
    branch.rotation.x = (Math.random() - 0.5) * 0.45;
    branch.castShadow = true;
    group.add(branch);

    if (i % 3 === 0) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 7, 5), tipMat);
      tip.position.set(branch.position.x, branchHeight + 0.06, branch.position.z);
      tip.scale.set(1.1, 0.7, 1.1);
      group.add(tip);
    }
  }
  return group;
}

export function makeSeaweedPatch(x: number, z: number, count = 7, color = 0x2fa184) {
  const group = new THREE.Group();
  group.position.set(x, 0.05, z);
  const mats = [
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
    new THREE.MeshStandardMaterial({ color: 0x5cc6a5, roughness: 0.7 }),
  ];

  for (let i = 0; i < count; i++) {
    const stalkHeight = 0.8 + Math.random() * 1.5;
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.05, stalkHeight, 6),
      mats[i % mats.length]
    );
    stalk.position.set((Math.random() - 0.5) * 1.8, stalkHeight / 2, (Math.random() - 0.5) * 1.8);
    stalk.rotation.x = (Math.random() - 0.5) * 0.35;
    stalk.rotation.z = (Math.random() - 0.5) * 0.55;
    stalk.castShadow = true;
    group.add(stalk);
  }

  return group;
}

export function makeAnemonePatch(x: number, z: number, color = 0xf37aa7) {
  const group = new THREE.Group();
  group.position.set(x, 0.06, z);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.48,
    emissive: color,
    emissiveIntensity: 0.04,
  });
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const tentacle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.045, 0.75, 6), mat);
    tentacle.position.set(Math.cos(angle) * 0.34, 0.35, Math.sin(angle) * 0.34);
    tentacle.rotation.z = Math.cos(angle) * 0.6;
    tentacle.rotation.x = Math.sin(angle) * 0.6;
    group.add(tentacle);
  }
  const center = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 7), mat);
  center.scale.set(1.2, 0.55, 1.2);
  center.position.y = 0.16;
  group.add(center);
  return group;
}

function makePalmLeaf(length: number, width: number, color: number) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(length * 0.42, width, length, 0.02);
  shape.quadraticCurveTo(length * 0.42, -width * 0.72, 0, 0);

  const leaf = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      side: THREE.DoubleSide,
      emissive: color,
      emissiveIntensity: 0.025,
    })
  );
  leaf.castShadow = true;
  return leaf;
}

function makePalmTree(x: number, z: number, scale = 1, rotation = 0) {
  const group = new THREE.Group();
  group.position.set(x, 0.04, z);
  group.scale.setScalar(scale);
  group.rotation.y = rotation;
  group.name = "reef-palm-tree";

  const mound = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 1.65, 0.2, 32),
    new THREE.MeshStandardMaterial({ color: 0xe4d2a4, roughness: 0.96 })
  );
  mound.scale.set(1.1, 1, 0.76);
  mound.position.y = 0.08;
  mound.castShadow = true;
  mound.receiveShadow = true;
  group.add(mound);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x9b7046, roughness: 0.82 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x6f4e31, roughness: 0.86 });
  const trunk = new THREE.Group();
  trunk.position.set(0.05, 0.15, 0);
  trunk.rotation.z = -0.24;
  trunk.rotation.x = 0.08;
  group.add(trunk);

  const segmentCount = 7;
  for (let i = 0; i < segmentCount; i++) {
    const taper = 1 - i * 0.055;
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15 * taper, 0.2 * taper, 0.52, 10),
      i % 2 === 0 ? trunkMat : ringMat
    );
    segment.position.set(Math.sin(i * 0.45) * 0.05, 0.36 + i * 0.48, 0);
    segment.rotation.z = Math.sin(i * 0.65) * 0.045;
    segment.castShadow = true;
    trunk.add(segment);
  }

  const crownY = 3.72;
  const leafColors = [0x2e9f61, 0x47b86f, 0x1f7a55];
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const leaf = makePalmLeaf(1.95 + (i % 3) * 0.18, 0.34, leafColors[i % leafColors.length]);
    leaf.position.set(0, crownY, 0);
    leaf.rotation.y = angle;
    leaf.rotation.z = -0.32 - (i % 2) * 0.16;
    leaf.rotation.x = Math.sin(angle) * 0.2;
    trunk.add(leaf);
  }

  const coconutMat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.78 });
  for (let i = 0; i < 3; i++) {
    const coconut = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), coconutMat);
    coconut.position.set(Math.cos(i * 2.1) * 0.18, crownY - 0.14, Math.sin(i * 2.1) * 0.15);
    coconut.castShadow = true;
    trunk.add(coconut);
  }

  return group;
}

function makePalmGrove(scene: THREE.Scene) {
  const palms: [number, number, number, number][] = [
    [-35.5, 24.5, 1.05, 0.45],
    [-32.7, 23.0, 0.72, -0.55],
    [31.4, 22.0, 0.9, 2.15],
    [35.0, 18.5, 0.68, 1.55],
    [-38.2, -12.8, 0.84, -1.15],
    [-34.4, -18.5, 0.62, -0.45],
    [12.4, -28.2, 0.78, 2.65],
    [16.2, -26.8, 0.58, 2.05],
    [39.0, -8.5, 0.7, 1.0],
  ];

  palms.forEach(([x, z, scale, rotation]) => {
    scene.add(makePalmTree(x, z, scale, rotation));
  });
}

function makeCoralGarden(scene: THREE.Scene) {
  const placements: [number, number, number, number, number, number][] = [
    [-34, -12, 0xff7f9a, 12, 2.2, 1.55],
    [-31, -23, 0xf2b96f, 10, 1.7, 1.35],
    [-34, 2, 0xff9bb1, 11, 1.8, 1.25],
    [-28, 19, 0x6ed7cf, 12, 2.0, 1.45],
    [-13, 20, 0xb18cff, 9, 1.65, 1.25],
    [3, 20, 0xff7f9a, 10, 1.85, 1.35],
    [19, 15, 0x42b8a8, 12, 2.2, 1.55],
    [21, -3, 0xf2b96f, 8, 1.5, 1.1],
    [18, -24, 0x42b8a8, 11, 2.1, 1.5],
    [-2, -27, 0xff9bb1, 9, 1.7, 1.2],
  ];

  placements.forEach(([x, z, color, count, spread, height]) => {
    scene.add(makeCoralPatch(x, z, color, count, spread, height));
  });

  scene.add(makeSeaweedPatch(-36, 9, 9, 0x2fa184));
  scene.add(makeSeaweedPatch(-18, -25, 7, 0x47b99a));
  scene.add(makeSeaweedPatch(11, 20, 8, 0x2fa184));
  scene.add(makeSeaweedPatch(25, -15, 9, 0x47b99a));
  scene.add(makeAnemonePatch(-22, 18, 0xff7fb5));
  scene.add(makeAnemonePatch(15, 3, 0xf6a0d4));
  scene.add(makeAnemonePatch(4, -25, 0xff8a78));
  makePalmGrove(scene);
}

export function makeBubbles(count: number, spread = 0.55) {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xdffcff,
    transparent: true,
    opacity: 0.42,
    roughness: 0.05,
    transmission: 0.35,
  });
  for (let i = 0; i < count; i++) {
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.07, 8, 6), mat);
    bubble.position.set((Math.random() - 0.5) * spread, 1.0 + Math.random() * 1.8, (Math.random() - 0.5) * spread);
    bubble.userData.offset = Math.random() * Math.PI * 2;
    group.add(bubble);
  }
  return group;
}

const DEFAULT_LOBSTER_APPEARANCE: LobsterAppearance = {
  headwear: "none",
  eyewear: "none",
  generated_headwear: null,
};

function lobsterAppearance(agent: AgentInfo): LobsterAppearance {
  return {
    headwear: agent.appearance?.headwear ?? DEFAULT_LOBSTER_APPEARANCE.headwear,
    eyewear: agent.appearance?.eyewear ?? DEFAULT_LOBSTER_APPEARANCE.eyewear,
    generated_headwear: agent.appearance?.generated_headwear ?? null,
  };
}

function agentVisualKey(agent: AgentInfo) {
  const appearance = lobsterAppearance(agent);
  const generated = appearance.generated_headwear;
  const generatedKey = generated
    ? [
        generated.kind,
        generated.label,
        generated.primary,
        generated.accent ?? "",
        (generated.decorations ?? [])
          .map((dec) => `${dec.type}:${dec.color}:${dec.count}`)
          .join("|"),
      ].join(",")
    : "";
  return [
    agent.species ?? "lobster",
    agent.color ?? "",
    appearance.headwear,
    appearance.eyewear,
    generatedKey,
  ].join(":");
}

function makeLobsterAccessories(agent: AgentInfo) {
  const appearance = lobsterAppearance(agent);
  const group = new THREE.Group();
  group.name = `accessories-${agent.name}`;

  const headwear = makeHeadwear(appearance.headwear, appearance.generated_headwear);
  if (headwear) group.add(headwear);

  const eyewear = makeEyewear(appearance.eyewear);
  if (eyewear) group.add(eyewear);

  return group;
}

function makeHeadwear(headwear: LobsterHeadwear, generated?: GeneratedHeadwear | null) {
  if (headwear === "generated") return makeGeneratedHeadwear(generated);
  if (headwear === "cowboy_hat") return makeCowboyHat();
  if (headwear === "baseball_cap") return makeBaseballCap();
  return null;
}

function makeEyewear(eyewear: LobsterEyewear) {
  if (eyewear === "sunglasses") return makeSunglasses();
  return null;
}

function colorNumber(hex: string | null | undefined, fallback: number) {
  if (!hex) return fallback;
  return parseHexColor(hex) ?? fallback;
}

function makeGeneratedHeadwear(spec?: GeneratedHeadwear | null) {
  if (!spec) return null;
  if (spec.kind === "wizard_hat") return makeGeneratedWizardHat(spec);
  if (spec.kind === "top_hat") return makeGeneratedTopHat(spec);
  if (spec.kind === "crown") return makeGeneratedCrown(spec);
  if (spec.kind === "beanie") return makeGeneratedBeanie(spec);
  return makeGeneratedPartyHat(spec);
}

function makeHatMaterial(color: number, roughness = 0.58) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
  });
}

function makeGeneratedPartyHat(spec: GeneratedHeadwear) {
  const group = new THREE.Group();
  group.name = "accessory-generated-party-hat";
  const primary = colorNumber(spec.primary, 0x7c3aed);
  const accent = colorNumber(spec.accent, 0xfacc15);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.05, 32), makeHatMaterial(primary));
  cone.position.set(0, 1.76, 0.36);
  cone.castShadow = true;
  group.add(cone);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 10, 44), makeHatMaterial(accent, 0.46));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 1.24, 0.36);
  group.add(rim);

  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), makeHatMaterial(accent, 0.5));
  pom.position.set(0, 2.31, 0.36);
  pom.castShadow = true;
  group.add(pom);

  addGeneratedDecorations(group, spec, { y: 1.68, z: 0.79, spreadX: 0.28, defaultColor: accent });
  return group;
}

function makeGeneratedWizardHat(spec: GeneratedHeadwear) {
  const group = new THREE.Group();
  group.name = "accessory-generated-wizard-hat";
  const primary = colorNumber(spec.primary, 0x6d28d9);
  const accent = colorNumber(spec.accent, 0xfacc15);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.08, 40), makeHatMaterial(primary, 0.68));
  brim.position.set(0, 1.26, 0.34);
  brim.scale.set(1.18, 1, 0.58);
  brim.castShadow = true;
  group.add(brim);

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.44, 1.28, 36), makeHatMaterial(primary, 0.62));
  cone.position.set(0, 1.85, 0.34);
  cone.rotation.x = -0.1;
  cone.castShadow = true;
  group.add(cone);

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.04, 8, 40), makeHatMaterial(accent, 0.42));
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 1.39, 0.43);
  band.scale.set(1.08, 0.72, 1);
  group.add(band);

  addGeneratedDecorations(group, spec, { y: 1.72, z: 0.78, spreadX: 0.25, defaultColor: accent });
  return group;
}

function makeGeneratedTopHat(spec: GeneratedHeadwear) {
  const group = new THREE.Group();
  group.name = "accessory-generated-top-hat";
  const primary = colorNumber(spec.primary, 0x111827);
  const accent = colorNumber(spec.accent, 0xfacc15);
  const mat = makeHatMaterial(primary, 0.52);

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.78, 0.08, 40), mat);
  brim.position.set(0, 1.28, 0.34);
  brim.scale.set(1.12, 1, 0.54);
  brim.castShadow = true;
  group.add(brim);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.45, 0.66, 32), mat);
  crown.position.set(0, 1.65, 0.34);
  crown.scale.set(0.95, 1, 0.74);
  crown.castShadow = true;
  group.add(crown);

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.04, 8, 40), makeHatMaterial(accent, 0.45));
  band.rotation.x = Math.PI / 2;
  band.position.set(0, 1.47, 0.34);
  band.scale.set(0.95, 0.74, 1);
  group.add(band);

  addGeneratedDecorations(group, spec, { y: 1.55, z: 0.72, spreadX: 0.25, defaultColor: accent });
  return group;
}

function makeGeneratedCrown(spec: GeneratedHeadwear) {
  const group = new THREE.Group();
  group.name = "accessory-generated-crown";
  const primary = colorNumber(spec.primary, 0xf59e0b);
  const accent = colorNumber(spec.accent, 0x38bdf8);
  const gold = makeHatMaterial(primary, 0.36);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.56, 0.2, 36, 1, true), gold);
  base.position.set(0, 1.32, 0.34);
  base.scale.set(1.08, 1, 0.7);
  base.castShadow = true;
  group.add(base);

  for (let i = 0; i < 5; i++) {
    const x = -0.42 + i * 0.21;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 4), gold);
    spike.position.set(x, 1.55 + (i % 2) * 0.05, 0.63);
    spike.rotation.z = i % 2 ? 0.12 : -0.12;
    spike.castShadow = true;
    group.add(spike);

    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), makeHatMaterial(accent, 0.32));
    gem.position.set(x, 1.75 + (i % 2) * 0.05, 0.64);
    group.add(gem);
  }

  addGeneratedDecorations(group, spec, { y: 1.34, z: 0.72, spreadX: 0.28, defaultColor: accent });
  return group;
}

function makeGeneratedBeanie(spec: GeneratedHeadwear) {
  const group = new THREE.Group();
  group.name = "accessory-generated-beanie";
  const primary = colorNumber(spec.primary, 0x3b82f6);
  const accent = colorNumber(spec.accent, 0xf8fafc);

  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    makeHatMaterial(primary, 0.76)
  );
  cap.position.set(0, 1.28, 0.34);
  cap.scale.set(1.0, 0.78, 0.76);
  cap.castShadow = true;
  group.add(cap);

  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.055, 10, 44), makeHatMaterial(accent, 0.72));
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, 1.28, 0.34);
  cuff.scale.set(1.0, 0.76, 1);
  group.add(cuff);

  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), makeHatMaterial(accent, 0.72));
  pom.position.set(0, 1.72, 0.34);
  pom.castShadow = true;
  group.add(pom);

  addGeneratedDecorations(group, spec, { y: 1.38, z: 0.74, spreadX: 0.26, defaultColor: accent });
  return group;
}

function addGeneratedDecorations(
  group: THREE.Group,
  spec: GeneratedHeadwear,
  opts: { y: number; z: number; spreadX: number; defaultColor: number }
) {
  const decorations = spec.decorations && spec.decorations.length > 0
    ? spec.decorations
    : [{ type: "band", color: spec.accent ?? "#facc15", count: 1 } as AccessoryDecoration];

  decorations.forEach((dec, decIndex) => {
    const color = colorNumber(dec.color, opts.defaultColor);
    const count = Math.max(1, Math.min(8, Math.round(dec.count || 1)));
    if (dec.type === "band" || dec.type === "stripe") {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.36 + decIndex * 0.035, 0.025, 8, 40),
        makeHatMaterial(color, 0.42)
      );
      band.rotation.x = Math.PI / 2;
      band.position.set(0, opts.y - 0.24 + decIndex * 0.16, opts.z - 0.35);
      band.scale.set(1.05, 0.72, 1);
      group.add(band);
      return;
    }
    if (dec.type === "pom") {
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), makeHatMaterial(color, 0.65));
      pom.position.set(0, opts.y + 0.58, opts.z - 0.42);
      pom.castShadow = true;
      group.add(pom);
      return;
    }

    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2;
      const row = Math.floor(i / 4);
      const x = offset * opts.spreadX * (row ? 0.7 : 1);
      const y = opts.y + row * 0.18 + Math.sin(i * 1.7) * 0.035;
      const z = opts.z + row * 0.015;
      if (dec.type === "star") {
        const star = makeStarMesh(color, 0.095);
        star.position.set(x, y, z + 0.015);
        group.add(star);
      } else if (dec.type === "gem") {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.065), makeHatMaterial(color, 0.34));
        gem.position.set(x, y, z);
        group.add(gem);
      } else {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 6), makeHatMaterial(color, 0.46));
        dot.position.set(x, y, z);
        group.add(dot);
      }
    }
  });
}

function makeStarMesh(color: number, radius = 0.1) {
  const shape = new THREE.Shape();
  const points = 10;
  for (let i = 0; i <= points; i++) {
    const angle = -Math.PI / 2 + (i / points) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  );
  mesh.name = "generated-star";
  return mesh;
}

function makeCowboyHat() {
  const group = new THREE.Group();
  group.name = "accessory-cowboy-hat";

  const felt = new THREE.MeshStandardMaterial({ color: 0x8a5128, roughness: 0.72 });
  const darkFelt = new THREE.MeshStandardMaterial({ color: 0x4b2d19, roughness: 0.8 });

  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.76, 0.08, 32), felt);
  brim.position.set(0, 1.3, 0.34);
  brim.scale.set(1.28, 1, 0.56);
  brim.castShadow = true;
  group.add(brim);

  [-1, 1].forEach((side) => {
    const curledSide = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.78), felt);
    curledSide.position.set(side * 0.82, 1.36, 0.34);
    curledSide.rotation.z = side * 0.38;
    curledSide.castShadow = true;
    group.add(curledSide);
  });

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.49, 0.48, 24), felt);
  crown.position.set(0, 1.55, 0.32);
  crown.scale.set(1.0, 1, 0.72);
  crown.castShadow = true;
  group.add(crown);

  const band = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.035, 8, 36), darkFelt);
  band.position.set(0, 1.43, 0.32);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1.0, 0.72, 1);
  group.add(band);

  const crease = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.36), darkFelt);
  crease.position.set(0, 1.77, 0.45);
  crease.rotation.x = -0.2;
  crease.castShadow = true;
  group.add(crease);

  return group;
}

function makeBaseballCap() {
  const group = new THREE.Group();
  group.name = "accessory-baseball-cap";

  const capMat = new THREE.MeshStandardMaterial({ color: 0x1d4f8f, roughness: 0.62 });
  const billMat = new THREE.MeshStandardMaterial({ color: 0xf2484b, roughness: 0.62 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0xf8f7ee, roughness: 0.5 });

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    capMat
  );
  crown.position.set(0, 1.22, 0.36);
  crown.scale.set(0.95, 0.72, 0.78);
  crown.castShadow = true;
  group.add(crown);

  const bill = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.52), billMat);
  bill.position.set(0, 1.21, 0.82);
  bill.rotation.x = -0.16;
  bill.castShadow = true;
  group.add(bill);

  const button = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 6), seamMat);
  button.position.set(0, 1.6, 0.36);
  button.scale.set(1, 0.48, 1);
  group.add(button);

  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.72), seamMat);
  seam.position.set(0, 1.38, 0.36);
  seam.rotation.x = 0.33;
  group.add(seam);

  return group;
}

function makeSunglasses() {
  const group = new THREE.Group();
  group.name = "accessory-sunglasses";

  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0x090d12,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.38 });

  [-1, 1].forEach((side) => {
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 10), lensMat);
    lens.position.set(side * 0.32, 1.22, 0.91);
    lens.scale.set(1.2, 0.78, 0.16);
    lens.rotation.y = side * 0.08;
    group.add(lens);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.46), frameMat);
    arm.position.set(side * 0.52, 1.22, 0.7);
    arm.rotation.y = side * -0.2;
    group.add(arm);
  });

  const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.24, 8), frameMat);
  bridge.position.set(0, 1.22, 0.93);
  bridge.rotation.z = Math.PI / 2;
  group.add(bridge);

  return group;
}

function makeCrab(agent: AgentInfo) {
  const accent = AGENT_COLORS_HEX[agent.name] ?? 0xffc857;
  const shellColor = lobsterShell(agent.name, agent.color);
  const shellMat = new THREE.MeshStandardMaterial({ color: shellColor, roughness: 0.62, metalness: 0.02 });
  const clawMat = new THREE.MeshStandardMaterial({ color: darkenNumber(shellColor, 0.74), roughness: 0.58 });
  const legMat = new THREE.MeshStandardMaterial({ color: darkenNumber(shellColor, 0.62), roughness: 0.74 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.25 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const group = new THREE.Group();
  group.name = `crab-${agent.name}`;

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 12), shellMat);
  body.scale.set(1.28, 0.42, 0.9);
  body.position.y = 0.52;
  body.castShadow = true;
  group.add(body);

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 8), shellMat);
  face.scale.set(1.05, 0.28, 0.48);
  face.position.set(0, 0.62, 0.58);
  face.castShadow = true;
  group.add(face);

  const claws: THREE.Group[] = [];
  [-1, 1].forEach((side) => {
    const clawGroup = new THREE.Group();
    clawGroup.position.set(side * 1.0, 0.52, 0.52);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.72, 7), legMat);
    arm.rotation.z = Math.PI / 2.5 * -side;
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * 0.22, 0, 0.02);
    clawGroup.add(arm);

    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), clawMat);
    pad.scale.set(1.08, 0.62, 1.0);
    pad.position.set(side * 0.52, 0.03, 0.24);
    pad.castShadow = true;
    clawGroup.add(pad);

    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.36, 6), clawMat);
    upper.rotation.x = Math.PI / 2;
    upper.rotation.z = side * 0.5;
    upper.position.set(side * 0.64, 0.13, 0.43);
    clawGroup.add(upper);

    const lower = upper.clone();
    lower.position.y = -0.08;
    lower.rotation.z = side * -0.36;
    clawGroup.add(lower);

    claws.push(clawGroup);
    group.add(clawGroup);
  });

  const legs: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    [-1, 1].forEach((side) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.044, 0.78, 6), legMat);
      leg.rotation.z = Math.PI / 2;
      leg.rotation.y = side * (0.32 + i * 0.06);
      leg.position.set(side * 0.78, 0.3, -0.48 + i * 0.26);
      leg.castShadow = true;
      legs.push(leg);
      group.add(leg);
    });
  }

  [-1, 1].forEach((side) => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.033, 0.34, 6), legMat);
    stalk.position.set(side * 0.24, 0.95, 0.54);
    stalk.rotation.x = 0.25;
    stalk.rotation.z = side * 0.12;
    group.add(stalk);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), eyeMat);
    eye.position.set(side * 0.28, 1.1, 0.68);
    group.add(eye);

    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 4), whiteMat);
    sparkle.position.set(side * 0.25, 1.13, 0.75);
    group.add(sparkle);
  });

  const accessories = makeLobsterAccessories(agent);
  accessories.position.z = 0.08;
  group.add(accessories);

  const label = makeTextSprite(agent.name, AGENT_COLORS[agent.name] ?? "#ffffff", "rgba(6, 26, 35, 0.72)");
  label.position.set(0, 2.25, 0);
  group.add(label);

  const speech = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSpeechTexture(agent.name, "all", ""),
      transparent: true,
      depthWrite: false,
    })
  );
  speech.position.set(0, 4.25, 0);
  speech.scale.set(8.0, 3.0, 1);
  speech.visible = false;
  group.add(speech);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.02, 0.035, 8, 48),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  group.add(ring);

  const bubbles = makeBubbles(5);
  bubbles.visible = false;
  group.add(bubbles);

  group.traverse((obj) => {
    obj.userData.agentName = agent.name;
  });

  const start = agentTarget(agent);
  group.position.copy(start);

  return {
    group,
    body,
    claws,
    legs,
    bubbles,
    label,
    speech,
    speechKey: null,
    ring,
    target: start.clone(),
    roamTarget: start.clone(),
    nextRoamAt: 0,
    anchorKey: agentAnchorKey(agent),
    sandboxSettled: Boolean(sandboxRoomForAgent(agent)),
    visualKey: agentVisualKey(agent),
  };
}

export function makeLobster(agent: AgentInfo) {
  if (agent.species === "crab") return makeCrab(agent);

  const accent = AGENT_COLORS_HEX[agent.name] ?? 0x6ed7cf;
  const shellColor = lobsterShell(agent.name, agent.color);
  const shellMat = new THREE.MeshStandardMaterial({ color: shellColor, roughness: 0.58, metalness: 0.02 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: 0xffb19b, roughness: 0.7 });
  const clawMat = new THREE.MeshStandardMaterial({ color: darkenNumber(shellColor, 0.78), roughness: 0.55 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.25 });
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, emissive: accent, emissiveIntensity: 0.08 });
  const legMat = new THREE.MeshStandardMaterial({ color: darkenNumber(shellColor, 0.68), roughness: 0.7 });

  const group = new THREE.Group();
  group.name = `lobster-${agent.name}`;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.68, 18, 12), shellMat);
  body.scale.set(0.9, 0.45, 1.25);
  body.position.y = 0.54;
  body.castShadow = true;
  group.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 8), bellyMat);
  belly.scale.set(0.78, 0.22, 0.9);
  belly.position.set(0, 0.48, 0.25);
  belly.castShadow = true;
  group.add(belly);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.85, 5), shellMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.48, -1.02);
  tail.scale.set(1.0, 0.7, 0.6);
  tail.castShadow = true;
  group.add(tail);

  const claws: THREE.Group[] = [];
  [-1, 1].forEach((side) => {
    const clawGroup = new THREE.Group();
    clawGroup.position.set(side * 0.78, 0.58, 0.86);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.78, 7), legMat);
    arm.rotation.z = Math.PI / 2.8 * -side;
    arm.rotation.x = Math.PI / 2;
    arm.position.set(side * 0.25, 0, 0.05);
    clawGroup.add(arm);

    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8), clawMat);
    pad.scale.set(1.18, 0.66, 0.9);
    pad.position.set(side * 0.56, 0.05, 0.28);
    pad.castShadow = true;
    clawGroup.add(pad);

    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 6), clawMat);
    upper.rotation.x = Math.PI / 2;
    upper.rotation.z = side * 0.45;
    upper.position.set(side * 0.68, 0.16, 0.52);
    clawGroup.add(upper);

    const lower = upper.clone();
    lower.position.y = -0.08;
    lower.rotation.z = side * -0.35;
    clawGroup.add(lower);

    claws.push(clawGroup);
    group.add(clawGroup);
  });

  const legs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    [-1, 1].forEach((side) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.75, 6), legMat);
      leg.rotation.z = Math.PI / 2;
      leg.rotation.y = side * 0.18;
      leg.position.set(side * 0.68, 0.32, -0.42 + i * 0.34);
      leg.castShadow = true;
      legs.push(leg);
      group.add(leg);
    });
  }

  [-1, 1].forEach((side) => {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.45, 6), legMat);
    stalk.position.set(side * 0.25, 1.02, 0.62);
    stalk.rotation.x = 0.35;
    stalk.rotation.z = side * 0.18;
    group.add(stalk);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), eyeMat);
    eye.position.set(side * 0.33, 1.22, 0.78);
    group.add(eye);

    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 4), whiteMat);
    sparkle.position.set(side * 0.3, 1.25, 0.86);
    group.add(sparkle);

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.95, 5), accentMat);
    antenna.position.set(side * 0.52, 1.18, 0.82);
    antenna.rotation.x = 0.82;
    antenna.rotation.z = side * 0.52;
    group.add(antenna);
  });

  const accessories = makeLobsterAccessories(agent);
  group.add(accessories);

  const label = makeTextSprite(agent.name, AGENT_COLORS[agent.name] ?? "#ffffff", "rgba(6, 26, 35, 0.72)");
  label.position.set(0, 2.35, 0);
  group.add(label);

  const speech = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSpeechTexture(agent.name, "all", ""),
      transparent: true,
      depthWrite: false,
    })
  );
  // Match the 1280×480 canvas (~2.67:1) — text is now the only thing in the
  // bubble, so the sprite is bigger overall and lifted further above the
  // lobster's head to keep the tail clear of the body.
  speech.position.set(0, 4.4, 0);
  speech.scale.set(8.0, 3.0, 1);
  speech.visible = false;
  group.add(speech);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.035, 8, 48),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  group.add(ring);

  const bubbles = makeBubbles(5);
  bubbles.visible = false;
  group.add(bubbles);

  group.traverse((obj) => {
    obj.userData.agentName = agent.name;
  });

  const start = agentTarget(agent);
  group.position.copy(start);

  return {
    group,
    body,
    claws,
    legs,
    bubbles,
    label,
    speech,
    speechKey: null,
    ring,
    target: start.clone(),
    roamTarget: start.clone(),
    nextRoamAt: 0,
    anchorKey: agentAnchorKey(agent),
    sandboxSettled: Boolean(sandboxRoomForAgent(agent)),
    visualKey: agentVisualKey(agent),
  };
}

function lobsterShell(name: string, colorOverride?: string | null) {
  // User-picked color takes precedence; falls back to the name-keyed palette
  // so the 7 starter lobsters keep their established look.
  if (colorOverride) {
    const parsed = parseHexColor(colorOverride);
    if (parsed !== null) return parsed;
  }
  const colors: Record<string, number> = {
    Clawdia: 0xff6f61,
    Shelldon: 0xf05248,
    Coraline: 0xff8a5c,
    Reefus: 0xf4767f,
    Pearl: 0xff728f,
    Snips: 0xe85f4d,
    "Captain Claw": 0xe96b5c,
  };
  return colors[name] ?? 0xff6f61;
}

function parseHexColor(hex: string): number | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  return parseInt(m[1], 16);
}

function darkenNumber(color: number, factor: number) {
  const r = Math.round(((color >> 16) & 255) * factor);
  const g = Math.round(((color >> 8) & 255) * factor);
  const b = Math.round((color & 255) * factor);
  return (r << 16) | (g << 8) | b;
}

function latestSceneMessage(messages: ThreeUnderwaterMapProps["messages"]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === "speak" || msg.type === "announce") {
      return msg;
    }
  }
  return null;
}

function messageAgeMs(message: ThreeUnderwaterMapProps["messages"][number]) {
  if (!message.timestamp) return 0;
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? Date.now() - parsed : 0;
}

function updateActorSpeech(
  actor: AgentActor,
  message: ThreeUnderwaterMapProps["messages"][number] | null
) {
  if (!message || messageAgeMs(message) > SPEECH_BUBBLE_TTL_MS) {
    actor.speech.visible = false;
    return;
  }

  const key = `${message.id ?? ""}:${message.agent}:${message.target}:${message.message}`;
  if (actor.speechKey !== key) {
    const material = actor.speech.material as THREE.SpriteMaterial;
    material.map?.dispose();
    material.map = makeSpeechTexture(message.agent, message.target, message.message);
    material.needsUpdate = true;
    actor.speechKey = key;
  }
  actor.speech.visible = true;
}

function makeScene(runtime: Runtime, sandboxRooms: RoomDef[]) {
  const { scene } = runtime;
  scene.background = new THREE.Color(0x68cbd2);
  scene.fog = new THREE.Fog(0x68cbd2, 58, 105);

  const ambient = new THREE.HemisphereLight(0xcffcff, 0xb19973, 2.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-16, 30, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x3bd4e7, 0.65);
  fill.position.set(16, 16, -22);
  scene.add(fill);

  makeGround(scene);
  makeVillageCove(scene);
  sandboxRooms.forEach((room) => {
    const layout = VISUAL_ROOM_LAYOUT[room.id];
    if (layout && !STATIC_SANDBOX_ROOM_IDS.has(room.id)) {
      makeOrganicPad(
        scene,
        new THREE.Vector3(layout.x, 0, layout.z),
        layout.rx,
        layout.rz,
        layout.color,
        0.3,
        layout.phase,
      );
    }
    const sandbox = makeNemoSandbox(room);
    scene.add(sandbox);
    sandbox.traverse((obj) => {
      if (obj instanceof THREE.Mesh) runtime.clickable.push(obj);
    });
  });
  scene.add(makeTideTable());
  scene.add(makeShellLounge());
  scene.add(makeTidePool());
  scene.add(makeNoticeRock());
  makeCoralGarden(scene);
}

function resizeRuntime(runtime: Runtime, mount: HTMLDivElement) {
  const rect = mount.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  runtime.renderer.setSize(width, height, false);

  const aspect = width / height;
  const viewH = 52;
  runtime.camera.left = (-viewH * aspect) / 2;
  runtime.camera.right = (viewH * aspect) / 2;
  runtime.camera.top = viewH / 2;
  runtime.camera.bottom = -viewH / 2;
  runtime.camera.updateProjectionMatrix();
}

function disposeScene(runtime: Runtime) {
  runtime.resizeObserver.disconnect();
  cancelAnimationFrame(runtime.frame);
  runtime.scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
      obj.geometry?.dispose();
      const material = obj.material;
      if (Array.isArray(material)) {
        material.forEach((m) => {
          disposeMaterial(m);
        });
      } else if (material) {
        disposeMaterial(material);
      }
    }
  });
  runtime.renderer.dispose();
  runtime.renderer.forceContextLoss();
  runtime.renderer.domElement.remove();
}

function disposeMaterial(material: THREE.Material) {
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose();
  });
  material.dispose();
}

function disposeActor(runtime: Runtime, actor: AgentActor) {
  runtime.scene.remove(actor.group);

  const ownedObjects = new Set<THREE.Object3D>();
  actor.group.traverse((obj) => {
    ownedObjects.add(obj);
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m?.dispose());
      } else {
        mat?.dispose();
      }
    } else if (obj instanceof THREE.Sprite) {
      const mat = obj.material as THREE.SpriteMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    }
  });

  // Anything we added to the clickable list when this actor spawned must be
  // evicted, or raycasts can hit a phantom mesh whose material was disposed.
  runtime.clickable = runtime.clickable.filter((obj) => !ownedObjects.has(obj));
}

function setPointerFromClient(
  runtime: Runtime,
  element: HTMLElement,
  clientX: number,
  clientY: number
) {
  const rect = element.getBoundingClientRect();
  runtime.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  runtime.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function taggedHit(
  hits: THREE.Intersection<THREE.Object3D>[]
): { agentName?: string; sandboxName?: string } | null {
  for (const hit of hits) {
    const agentName = hit.object.userData.agentName;
    if (typeof agentName === "string") return { agentName };

    const sandboxName = hit.object.userData.sandboxName;
    if (typeof sandboxName === "string") return { sandboxName };
  }
  return null;
}

function taggedSandboxName(hits: THREE.Intersection<THREE.Object3D>[]): string | undefined {
  const sandboxHit = hits.find((hit) => typeof hit.object.userData.sandboxName === "string");
  return sandboxHit?.object.userData.sandboxName as string | undefined;
}

export default function ThreeUnderwaterMap({
  agents,
  sandboxes,
  selectedAgent,
  onSelectAgent,
  onAssignAgentToSandbox,
  onOpenSandbox,
  messages,
  hasActiveQuery,
}: ThreeUnderwaterMapProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const agentsRef = useRef(agents);
  const selectedRef = useRef(selectedAgent);
  const activeQueryRef = useRef(hasActiveQuery);
  const onSelectRef = useRef(onSelectAgent);
  const onAssignRef = useRef(onAssignAgentToSandbox);
  const onOpenSandboxRef = useRef(onOpenSandbox);
  const messagesRef = useRef(messages);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    selectedRef.current = selectedAgent;
  }, [selectedAgent]);

  useEffect(() => {
    activeQueryRef.current = hasActiveQuery;
  }, [hasActiveQuery]);

  useEffect(() => {
    onSelectRef.current = onSelectAgent;
  }, [onSelectAgent]);

  useEffect(() => {
    onAssignRef.current = onAssignAgentToSandbox;
  }, [onAssignAgentToSandbox]);

  useEffect(() => {
    onOpenSandboxRef.current = onOpenSandbox;
  }, [onOpenSandbox]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-35, 35, 28, -28, 0.1, 200);
    camera.position.set(26, 36, 43);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "block h-full w-full";
    mount.appendChild(renderer.domElement);

    const runtime: Runtime = {
      scene,
      camera,
      renderer,
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
      clickable: [],
      actors: new Map(),
      resizeObserver: new ResizeObserver(() => resizeRuntime(runtime, mount)),
      frame: 0,
    };
    const sandboxRooms = updateSandboxLookups(sandboxes);
    makeScene(runtime, sandboxRooms);

    const ensureActors = () => {
      const liveNames = new Set(agentsRef.current.map((a) => a.name));
      const addActor = (agent: AgentInfo) => {
        const actor = makeLobster(agent);
        runtime.actors.set(agent.name, actor);
        runtime.scene.add(actor.group);
        actor.group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) runtime.clickable.push(obj);
        });
        return actor;
      };

      // Spawn actors for any new lobsters.
      agentsRef.current.forEach((agent) => {
        let actor = runtime.actors.get(agent.name);
        if (actor && actor.visualKey !== agentVisualKey(agent)) {
          const position = actor.group.position.clone();
          const rotation = actor.group.rotation.clone();
          const roamTarget = actor.roamTarget.clone();
          const nextRoamAt = actor.nextRoamAt;
          const sandboxSettled = actor.sandboxSettled;
          disposeActor(runtime, actor);
          runtime.actors.delete(agent.name);
          actor = addActor(agent);
          actor.group.position.copy(position);
          actor.group.rotation.copy(rotation);
          actor.roamTarget.copy(roamTarget);
          actor.nextRoamAt = nextRoamAt;
          actor.sandboxSettled = sandboxSettled;
        } else if (!actor) {
          addActor(agent);
        }
      });

      // Remove actors for lobsters that disappeared (delete via the UI).
      // Free the Three.js resources or we leak GPU memory across deletes.
      for (const [name, actor] of runtime.actors) {
        if (liveNames.has(name)) continue;
        disposeActor(runtime, actor);
        runtime.actors.delete(name);
        if (selectedRef.current === name) {
          selectedRef.current = null;
          onSelectRef.current?.(null);
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      setPointerFromClient(runtime, renderer.domElement, event.clientX, event.clientY);
      runtime.raycaster.setFromCamera(runtime.pointer, camera);
      const hits = runtime.raycaster.intersectObjects(runtime.clickable, true);
      const hit = taggedHit(hits);

      if (hit?.agentName) {
        onSelectRef.current(selectedRef.current !== hit.agentName ? hit.agentName : null);
        return;
      }

      if (hit?.sandboxName) {
        if (selectedRef.current) {
          // Selected lobster + sandbox click → assign.
          onAssignRef.current?.(selectedRef.current, hit.sandboxName);
        } else {
          // Bare sandbox click with nothing selected → open the Task Monitor.
          onOpenSandboxRef.current?.(hit.sandboxName);
        }
        return;
      }

      onSelectRef.current(null);
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes("text/plain")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    };

    const onDrop = (event: DragEvent) => {
      const agentName = event.dataTransfer?.getData("text/plain");
      if (!agentName) return;

      event.preventDefault();
      setPointerFromClient(runtime, renderer.domElement, event.clientX, event.clientY);
      runtime.raycaster.setFromCamera(runtime.pointer, camera);
      const hits = runtime.raycaster.intersectObjects(runtime.clickable, true);
      const sandboxName = taggedSandboxName(hits);
      if (!sandboxName) return;

      onAssignRef.current?.(agentName, sandboxName);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("dragover", onDragOver);
    renderer.domElement.addEventListener("drop", onDrop);
    runtime.resizeObserver.observe(mount);
    resizeRuntime(runtime, mount);

    const startedAt = performance.now();
    let lastFrameAt = startedAt;
    const animate = () => {
      const now = performance.now();
      const elapsed = (now - startedAt) / 1000;
      const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      ensureActors();
      const sceneMessage = latestSceneMessage(messagesRef.current);

      runtime.actors.forEach((actor, name) => {
        const agent = agentsRef.current.find((a) => a.name === name);
        const focusedWork = isFocusedWorkState(agent);
        if (agent) {
          const sandboxRoom = sandboxRoomForAgent(agent);
          actor.target.copy(agentTarget(agent));
          const nextAnchorKey = agentAnchorKey(agent);
          if (actor.anchorKey !== nextAnchorKey) {
            actor.anchorKey = nextAnchorKey;
            actor.roamTarget.copy(actor.target);
            actor.nextRoamAt = elapsed + 4.5;
            actor.sandboxSettled = !sandboxRoom;
          }
        }
        const assignedToSandbox = Boolean(sandboxRoomForAgent(agent));
        const canRoam = !activeQueryRef.current && !focusedWork && !assignedToSandbox;
        if (canRoam && (elapsed > actor.nextRoamAt || actor.group.position.distanceTo(actor.roamTarget) < 0.55)) {
          actor.roamTarget = pickIdleRoamTarget(name, elapsed, actor.group.position, agent);
          actor.nextRoamAt = elapsed + 5.5 + Math.random() * 5.5;
        }

        const destination = canRoam ? actor.roamTarget : actor.target;
        const distanceToTarget = actor.group.position.distanceTo(actor.target);
        if (assignedToSandbox && !actor.sandboxSettled && distanceToTarget < 0.32) {
          actor.sandboxSettled = true;
        }
        if (assignedToSandbox && actor.sandboxSettled && distanceToTarget > 1.8) {
          actor.group.position.copy(actor.target);
        }
        const relocatingToSandbox = assignedToSandbox && !actor.sandboxSettled;
        const walkSpeed = activeQueryRef.current ? 6.2 : relocatingToSandbox ? 2.8 : canRoam ? 1.85 : 1.15;
        moveToward(actor.group.position, destination, walkSpeed * deltaSeconds);

        const delta = destination.clone().sub(actor.group.position);
        const isMoving = delta.lengthSq() > 0.018;
        if (delta.lengthSq() > 0.004) {
          actor.group.rotation.y = Math.atan2(delta.x, delta.z);
        }

        const selected = selectedRef.current === name;
        const animated = focusedWork || selected || isMoving;
        const bob = Math.sin(elapsed * (animated ? 4.2 : 2.2) + name.length) * (animated ? 0.08 : 0.04);
        actor.body.position.y = 0.54 + bob;
        actor.group.scale.setScalar(selected ? 1.28 : 1.12);
        actor.ring.visible = selected;
        actor.ring.rotation.z = elapsed * 1.4;

        actor.claws.forEach((claw, index) => {
          claw.rotation.y = Math.sin(elapsed * 5 + index * Math.PI + name.length) * (animated ? 0.32 : 0.14);
          claw.rotation.z = Math.sin(elapsed * 3.2 + index) * 0.08;
        });
        actor.legs.forEach((leg, index) => {
          leg.rotation.y = Math.sin(elapsed * 8 + index) * (animated ? 0.3 : 0.12);
        });

        actor.bubbles.visible = focusedWork || selected;
        actor.bubbles.children.forEach((bubble, index) => {
          const offset = (bubble.userData.offset as number) ?? 0;
          bubble.position.y = 1.0 + ((elapsed * 0.42 + offset + index * 0.27) % 2.0);
          bubble.position.x += Math.sin(elapsed + offset) * 0.0008;
        });

        actor.label.quaternion.copy(camera.quaternion);
        actor.label.visible = selected || focusedWork;
        actor.speech.quaternion.copy(camera.quaternion);
        updateActorSpeech(actor, sceneMessage?.agent === name ? sceneMessage : null);
      });

      const water = runtime.scene.getObjectByName("water-sheet") as THREE.Mesh | undefined;
      const waterMaterial = water?.material as THREE.MeshBasicMaterial | undefined;
      if (waterMaterial) {
        waterMaterial.opacity = 0.045 + Math.sin(elapsed * 1.25) * 0.012;
      }

      runtime.scene.traverse((obj) => {
        if (obj instanceof THREE.Sprite && !obj.parent?.name.startsWith("lobster-")) {
          obj.quaternion.copy(camera.quaternion);
        }
      });

      renderer.render(scene, camera);
      runtime.frame = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("dragover", onDragOver);
      renderer.domElement.removeEventListener("drop", onDrop);
      disposeScene(runtime);
    };
  }, []);

  return (
    <div ref={mountRef} className="relative h-full w-full overflow-hidden bg-[#8bd8dc]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(207, 252, 255, 0.12), rgba(20, 112, 132, 0.16)), radial-gradient(ellipse at 50% 48%, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.035) 38%, rgba(4, 54, 79, 0.22) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-35 mix-blend-screen"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 18% 18%, rgba(232, 255, 255, 0.18), transparent 28%), radial-gradient(ellipse at 78% 26%, rgba(160, 245, 255, 0.14), transparent 34%), radial-gradient(ellipse at 48% 74%, rgba(226, 255, 246, 0.12), transparent 30%)",
        }}
      />
    </div>
  );
}
