import React, { useCallback, useEffect, useRef, useState } from "react";
import { Application, extend } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import type { Graphics as PixiGraphics, TextStyleOptions } from "pixi.js";
import type { AgentInfo } from "../types";
import { ROOMS, AGENT_COLORS_HEX, STATE_ICONS, type RoomDef } from "../utils/sprites";

extend({ Container, Graphics, Text });

const TILE = 16;
const CANVAS_W = 640;
const CANVAS_H = 480;

function useContainerScale(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const sx = rect.width / CANVAS_W;
      const sy = rect.height / CANVAS_H;
      setScale(Math.min(sx, sy, 3)); // cap at 3x
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return scale;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpeechBubble {
  agent: string;
  target: string;
  text: string;
  x: number;
  y: number;
  expiry: number;
}

interface OfficeCanvasProps {
  agents: AgentInfo[];
  selectedAgent: string | null;
  onSelectAgent: (name: string | null) => void;
  messages: { agent: string; target: string; message: string; type: string }[];
  hasActiveQuery?: boolean;
}

// ---------------------------------------------------------------------------
// Pixel helper
// ---------------------------------------------------------------------------

function px(g: PixiGraphics, x: number, y: number, color: number, alpha = 1) {
  g.rect(x, y, 1, 1);
  g.fill({ color, alpha });
}

function shadeColor(color: number, factor: number) {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 255) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 255) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((color & 255) * factor)));
  return (r << 16) | (g << 8) | b;
}

function lightenColor(color: number, factor: number) {
  const r = Math.min(255, Math.round(((color >> 16) & 255) + (255 - ((color >> 16) & 255)) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 255) + (255 - ((color >> 8) & 255)) * factor));
  const b = Math.min(255, Math.round((color & 255) + (255 - (color & 255)) * factor));
  return (r << 16) | (g << 8) | b;
}

const LOBSTER_VISUALS: Record<string, { shell: number; belly: number; claw: number; accent: number }> = {
  Clawdia:   { shell: 0xff6f61, belly: 0xffb09a, claw: 0xe84c3d, accent: 0x4ecdc4 },
  Shelldon:    { shell: 0xf05248, belly: 0xff9d7d, claw: 0xc9352d, accent: 0xffcf6e },
  Coraline: { shell: 0xff8a5c, belly: 0xffd29a, claw: 0xf05a3e, accent: 0xfeca57 },
  Reefus:   { shell: 0xf4767f, belly: 0xffc2b0, claw: 0xd94e61, accent: 0xa29bfe },
  Pearl: { shell: 0xff728f, belly: 0xffc0c9, claw: 0xe24569, accent: 0xfd79a8 },
  Snips:    { shell: 0xe85f4d, belly: 0xffad8f, claw: 0xc94335, accent: 0x00b894 },
  "Captain Claw":    { shell: 0xe96b5c, belly: 0xffc1a8, claw: 0xce4d42, accent: 0x6c5ce7 },
};

const HUT_ACCENTS: Record<string, number> = {
  desk_researcher: AGENT_COLORS_HEX.Clawdia,
  desk_analyst: AGENT_COLORS_HEX.Shelldon,
  desk_critic: AGENT_COLORS_HEX.Coraline,
  desk_planner: AGENT_COLORS_HEX.Reefus,
  desk_writer: AGENT_COLORS_HEX.Pearl,
  desk_coder: AGENT_COLORS_HEX.Snips,
  desk_lead: AGENT_COLORS_HEX["Captain Claw"],
};

// ---------------------------------------------------------------------------
// Floor grid
// ---------------------------------------------------------------------------

function FloorGrid() {
  const draw = useCallback((g: PixiGraphics) => {
    g.clear();
    g.rect(0, 0, CANVAS_W, CANVAS_H);
    g.fill({ color: 0xded2b9 });

    // Subtle grid pattern
    for (let x = 0; x <= 40; x++) {
      g.moveTo(x * TILE, 0);
      g.lineTo(x * TILE, CANVAS_H);
      g.stroke({ color: 0xcfc3aa, width: 0.5, alpha: 0.75 });
    }
    for (let y = 0; y <= 30; y++) {
      g.moveTo(0, y * TILE);
      g.lineTo(CANVAS_W, y * TILE);
      g.stroke({ color: 0xcfc3aa, width: 0.5, alpha: 0.75 });
    }
  }, []);

  return <pixiGraphics draw={draw} />;
}

// ---------------------------------------------------------------------------
// Room backgrounds
// ---------------------------------------------------------------------------

function RoomBackground({ room }: { room: RoomDef }) {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      const rx = room.x * TILE;
      const ry = room.y * TILE;
      const rw = room.w * TILE;
      const rh = room.h * TILE;

      // Room fill
      g.rect(rx, ry, rw, rh);
      g.fill({ color: room.color, alpha: 0.8 });

      // Subtle inner texture — dithering pattern
      for (let ty = 0; ty < room.h; ty++) {
        for (let tx = 0; tx < room.w; tx++) {
          if ((tx + ty) % 2 === 0) {
            g.rect(rx + tx * TILE + 6, ry + ty * TILE + 6, 4, 4);
            g.fill({ color: 0xffffff, alpha: 0.04 });
          }
        }
      }

      // Border
      g.rect(rx, ry, rw, rh);
      g.stroke({ color: 0xb0a898, width: 2, alpha: 0.8 });

      // Inner highlight (top + left)
      g.moveTo(rx + 2, ry + 2);
      g.lineTo(rx + rw - 2, ry + 2);
      g.stroke({ color: 0xf0ece4, width: 1, alpha: 0.4 });
      g.moveTo(rx + 2, ry + 2);
      g.lineTo(rx + 2, ry + rh - 2);
      g.stroke({ color: 0xf0ece4, width: 1, alpha: 0.4 });
    },
    [room]
  );

  return <pixiGraphics draw={draw} />;
}

// ---------------------------------------------------------------------------
// Room labels
// ---------------------------------------------------------------------------

function RoomLabel({ room }: { room: RoomDef }) {
  return (
    <pixiText
      text={room.label}
      x={room.x * TILE + 4}
      y={room.y * TILE + 3}
      style={{ fontSize: 9, fill: 0x887766, fontFamily: "monospace" } satisfies TextStyleOptions}
    />
  );
}

// ---------------------------------------------------------------------------
// Furniture — all drawn with Graphics
// ---------------------------------------------------------------------------

function DeskFurniture({ room }: { room: RoomDef }) {
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      if (!room.id.startsWith("desk_")) return;

      const cx = (room.x + room.w / 2) * TILE;
      const cy = (room.y + room.h / 2) * TILE + 8;
      const accent = HUT_ACCENTS[room.id] ?? 0x8fb3b9;
      const stone = 0x7a786f;
      const stoneLight = 0x969287;
      const stoneDark = 0x5b5952;

      // Ground shadow.
      g.ellipse(cx, cy + 24, 42, 7);
      g.fill({ color: 0x000000, alpha: 0.16 });

      // Small rock hut body.
      g.roundRect(cx - 38, cy - 20, 76, 44, 15);
      g.fill({ color: stone });
      g.roundRect(cx - 38, cy - 20, 76, 44, 15);
      g.stroke({ color: stoneDark, width: 1.5, alpha: 0.85 });

      // Stacked stones make the hut read as hand-built.
      const stones: [number, number, number, number][] = [
        [-26, -17, 13, stoneLight],
        [-9, -21, 15, 0x868278],
        [11, -17, 14, stoneLight],
        [27, -8, 12, 0x6e6b63],
        [-33, -4, 10, 0x8b877d],
        [-20, 7, 12, 0x6d6a62],
        [23, 10, 11, 0x8f8a80],
      ];
      for (const [sx, sy, r, color] of stones) {
        g.circle(cx + sx, cy + sy, r);
        g.fill({ color, alpha: 0.8 });
        g.circle(cx + sx, cy + sy, r);
        g.stroke({ color: stoneDark, width: 0.75, alpha: 0.35 });
      }

      // Accent shells around the roof line.
      for (let i = 0; i < 5; i++) {
        const sx = cx - 22 + i * 11;
        g.roundRect(sx, cy - 26 + (i % 2), 8, 7, 3);
        g.fill({ color: accent, alpha: 0.78 });
        g.rect(sx + 2, cy - 25 + (i % 2), 4, 1);
        g.fill({ color: 0xffffff, alpha: 0.25 });
      }

      // Doorway, sized so each lobster appears to be standing in front of it.
      g.roundRect(cx - 12, cy - 2, 24, 28, 10);
      g.fill({ color: 0x2a2624, alpha: 0.92 });
      g.rect(cx - 12, cy + 11, 24, 15);
      g.fill({ color: 0x2a2624, alpha: 0.92 });
      g.roundRect(cx - 12, cy - 2, 24, 28, 10);
      g.stroke({ color: accent, width: 1, alpha: 0.8 });
      g.circle(cx + 7, cy + 11, 1.5);
      g.fill({ color: accent, alpha: 0.9 });

      // Tiny glowing tide-pool terminal beside the doorway.
      g.roundRect(cx + 19, cy + 3, 13, 10, 2);
      g.fill({ color: 0x24434a });
      g.rect(cx + 21, cy + 5, 9, 5);
      g.fill({ color: accent, alpha: 0.48 });
    },
    [room]
  );

  return <pixiGraphics draw={draw} />;
}

function WarRoomFurniture() {
  const warRoom = ROOMS.find((r) => r.id === "war_room")!;
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      const cx = (warRoom.x + warRoom.w / 2) * TILE;
      const cy = (warRoom.y + warRoom.h / 2) * TILE;

      // Conference table (larger)
      g.roundRect(cx - 70, cy - 20, 140, 40, 5);
      g.fill({ color: 0x7a6548 });
      g.roundRect(cx - 70, cy - 20, 140, 40, 5);
      g.stroke({ color: 0x8b7558, width: 1.5 });
      // Table highlight
      g.rect(cx - 68, cy - 18, 136, 2);
      g.fill({ color: 0x9a8568, alpha: 0.5 });

      // Whiteboard on wall
      const wx = warRoom.x * TILE + 12;
      const wy = warRoom.y * TILE + 14;
      g.rect(wx, wy, 60, 24);
      g.fill({ color: 0xf8f8f8 });
      g.rect(wx, wy, 60, 24);
      g.stroke({ color: 0xcccccc, width: 1.5 });
      // Whiteboard text lines
      for (let i = 0; i < 3; i++) {
        g.rect(wx + 4, wy + 5 + i * 7, 30 - i * 6, 2);
        g.fill({ color: 0x888888, alpha: 0.3 });
      }
    },
    [warRoom]
  );

  return <pixiGraphics draw={draw} />;
}

function BreakRoomFurniture() {
  const brk = ROOMS.find((r) => r.id === "break_room")!;
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      const bx = brk.x * TILE;
      const by = brk.y * TILE;

      // Coffee machine
      g.rect(bx + 10, by + 20, 14, 18);
      g.fill({ color: 0x555555 });
      g.rect(bx + 10, by + 20, 14, 18);
      g.stroke({ color: 0x666666, width: 1 });
      // Coffee light
      g.rect(bx + 14, by + 24, 4, 3);
      g.fill({ color: 0xff6633, alpha: 0.6 });

      // Small table
      g.circle(bx + (brk.w * TILE) / 2, by + (brk.h * TILE) / 2 + 8, 10);
      g.fill({ color: 0x8b7355, alpha: 0.7 });
      g.circle(bx + (brk.w * TILE) / 2, by + (brk.h * TILE) / 2 + 8, 10);
      g.stroke({ color: 0xa08868, width: 1 });

      // Plant
      g.circle(bx + brk.w * TILE - 18, by + 25, 7);
      g.fill({ color: 0x4a9b4a, alpha: 0.8 });
      g.circle(bx + brk.w * TILE - 20, by + 22, 5);
      g.fill({ color: 0x5aab5a, alpha: 0.6 });
      g.rect(bx + brk.w * TILE - 20, by + 31, 4, 8);
      g.fill({ color: 0x5a3d1f });
    },
    [brk]
  );

  return <pixiGraphics draw={draw} />;
}

function BulletinBoardFurniture() {
  const bb = ROOMS.find((r) => r.id === "bulletin_board")!;
  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      const bx = bb.x * TILE;
      const by = bb.y * TILE;

      // Cork board
      g.rect(bx + 8, by + 14, bb.w * TILE - 16, 40);
      g.fill({ color: 0xc4a862, alpha: 0.8 });
      g.rect(bx + 8, by + 14, bb.w * TILE - 16, 40);
      g.stroke({ color: 0xb09850, width: 1.5 });

      // Sticky notes
      const colors = [0xfeca57, 0xff6b6b, 0x4ecdc4, 0xa29bfe, 0xfd79a8, 0x00b894];
      for (let i = 0; i < 6; i++) {
        const nx = bx + 14 + (i % 3) * 28;
        const ny = by + 19 + Math.floor(i / 3) * 16;
        g.rect(nx, ny, 16, 12);
        g.fill({ color: colors[i], alpha: 0.7 });
        // "Text" lines on sticky
        g.rect(nx + 2, ny + 3, 10, 1);
        g.fill({ color: 0x000000, alpha: 0.15 });
        g.rect(nx + 2, ny + 6, 8, 1);
        g.fill({ color: 0x000000, alpha: 0.15 });
      }
    },
    [bb]
  );

  return <pixiGraphics draw={draw} />;
}

// ---------------------------------------------------------------------------
// Pixel art character — drawn entirely with Graphics
// ---------------------------------------------------------------------------

interface AgentCharacterProps {
  agent: AgentInfo;
  isSelected: boolean;
  displayX: number;
  displayY: number;
  prevX: number;
  prevY: number;
  onClick: () => void;
  animTick: number;
}

function AgentCharacter({
  agent,
  isSelected,
  displayX,
  displayY,
  prevX,
  prevY,
  onClick,
  animTick,
}: AgentCharacterProps) {
  const vis = LOBSTER_VISUALS[agent.name] ?? { shell: 0xff6f61, belly: 0xffb09a, claw: 0xe84c3d, accent: 0x4ecdc4 };
  const agentColor = AGENT_COLORS_HEX[agent.name] ?? 0xcccccc;
  const stateIcon = STATE_ICONS[agent.state];
  const shellDark = shadeColor(vis.shell, 0.72);
  const shellDeep = shadeColor(vis.shell, 0.55);
  const shellLight = lightenColor(vis.shell, 0.28);
  const clawDark = shadeColor(vis.claw, 0.65);
  const clawLight = lightenColor(vis.claw, 0.22);
  const bellyDark = shadeColor(vis.belly, 0.82);

  // Detect movement direction
  const dx = displayX - prevX;
  const dy = displayY - prevY;
  const isMoving = Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3;
  const facingLeft = dx < -0.3;
  const facingRight = dx > 0.3;
  const facingUp = !facingLeft && !facingRight && dy < -0.3;

  // Walk cycle: 4 frames
  const walkFrame = isMoving ? Math.floor(animTick / 8) % 4 : 0;
  // Idle bob
  const idleBob = Math.floor(animTick / 30) % 2 === 0 ? 0 : -1;
  const yOff = isMoving ? 0 : idleBob;

  // Character is drawn centered at (displayX, displayY) which is the feet
  // Character size: ~20 wide, ~24 tall
  const bx = Math.round(displayX) - 8;  // base x (left edge)
  const by = Math.round(displayY) - 22 + yOff; // base y (top of antennae)

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();

      // Shadow
      g.ellipse(displayX, displayY + 1, 9, 2.5);
      g.fill({ color: 0x000000, alpha: 0.26 });

      const look = facingLeft ? -1 : facingRight ? 1 : 0;
      const legStride = isMoving ? walkFrame % 2 : 0;
      const clawLift = isMoving
        ? (walkFrame === 1 ? -1 : walkFrame === 3 ? 1 : 0)
        : (Math.floor(animTick / 36) % 2 === 0 ? 0 : -1);

      // Side legs.
      for (let i = 0; i < 3; i++) {
        const ly = by + 11 + i * 3;
        const stride = legStride && i !== 1 ? 1 : 0;
        px(g, bx + 5 - stride, ly, shellDeep);
        px(g, bx + 4 - stride, ly + 1, shellDark);
        px(g, bx + 14 + stride, ly, shellDeep);
        px(g, bx + 15 + stride, ly + 1, shellDark);
      }

      // Tail fan and segmented belly.
      g.rect(bx + 7, by + 18, 6, 2);
      g.fill({ color: shellDark });
      g.rect(bx + 6, by + 20, 8, 2);
      g.fill({ color: vis.shell });
      px(g, bx + 5, by + 22, vis.shell);
      g.rect(bx + 8, by + 22, 4, 1);
      g.fill({ color: shellLight });
      px(g, bx + 14, by + 22, vis.shell);

      g.rect(bx + 6, by + 12, 8, 7);
      g.fill({ color: vis.belly });
      g.rect(bx + 5, by + 13, 1, 5);
      g.fill({ color: shellDark });
      g.rect(bx + 14, by + 13, 1, 5);
      g.fill({ color: shellDark });
      g.rect(bx + 7, by + 14, 6, 1);
      g.fill({ color: bellyDark });
      g.rect(bx + 7, by + 16, 6, 1);
      g.fill({ color: bellyDark });

      // Claws and jointed arms.
      const leftBase = facingLeft ? 0 : 1;
      const rightBase = facingRight ? 16 : 15;
      const clawY = by + 8 + clawLift;

      g.rect(bx + 4, clawY + 4, 4, 2);
      g.fill({ color: shellDark });
      g.roundRect(bx + leftBase, clawY + 1, 5, 5, 2);
      g.fill({ color: vis.claw });
      g.rect(bx + leftBase - 1, clawY + 3, 3, 2);
      g.fill({ color: vis.claw });
      px(g, bx + leftBase + 2, clawY, clawLight);
      px(g, bx + leftBase + 3, clawY + 4, clawDark);

      g.rect(bx + 12, clawY + 4, 4, 2);
      g.fill({ color: shellDark });
      g.roundRect(bx + rightBase, clawY + 1, 5, 5, 2);
      g.fill({ color: vis.claw });
      g.rect(bx + rightBase + 3, clawY + 3, 3, 2);
      g.fill({ color: vis.claw });
      px(g, bx + rightBase + 2, clawY, clawLight);
      px(g, bx + rightBase + 1, clawY + 4, clawDark);

      // Carapace.
      g.roundRect(bx + 5, by + 5, 10, 8, 4);
      g.fill({ color: vis.shell });
      g.roundRect(bx + 6, by + 4, 8, 3, 2);
      g.fill({ color: shellLight });
      g.rect(bx + 5, by + 11, 10, 2);
      g.fill({ color: shellDark });
      px(g, bx + 9, by + 7, vis.accent);
      px(g, bx + 10, by + 7, vis.accent);

      if (facingUp) {
        g.rect(bx + 7, by + 3, 6, 3);
        g.fill({ color: shellDark });
        g.rect(bx + 8, by + 2, 4, 1);
        g.fill({ color: shellLight });
        px(g, bx + 7, by + 9, shellDeep);
        px(g, bx + 12, by + 9, shellDeep);
        px(g, bx + 5, by + 3, vis.accent);
        px(g, bx + 14, by + 3, vis.accent);
      } else {
        // Antennae.
        g.moveTo(bx + 7 + look, by + 4);
        g.lineTo(bx + 3 + look, by + 1);
        g.stroke({ color: vis.accent, width: 1, alpha: 0.85 });
        g.moveTo(bx + 12 + look, by + 4);
        g.lineTo(bx + 16 + look, by + 1);
        g.stroke({ color: vis.accent, width: 1, alpha: 0.85 });

        // Eye stalks and wide glossy eyes.
        px(g, bx + 7 + look, by + 3, shellDark);
        px(g, bx + 7 + look, by + 4, shellDark);
        px(g, bx + 12 + look, by + 3, shellDark);
        px(g, bx + 12 + look, by + 4, shellDark);
        g.rect(bx + 6 + look, by + 2, 3, 3);
        g.fill({ color: 0x171214 });
        g.rect(bx + 11 + look, by + 2, 3, 3);
        g.fill({ color: 0x171214 });
        px(g, bx + 8 + look, by + 2, 0xffffff);
        px(g, bx + 13 + look, by + 2, 0xffffff);
        px(g, bx + 8, by + 9, vis.accent);
        px(g, bx + 11, by + 9, vis.accent);
        g.rect(bx + 9, by + 10, 2, 1);
        g.fill({ color: shellDeep });
      }

      if (isSelected) {
        g.roundRect(bx - 3, by - 2, 26, 28, 4);
        g.stroke({ color: 0x333333, width: 1, alpha: 0.9 });
        g.roundRect(bx - 4, by - 3, 28, 30, 4);
        g.stroke({ color: agentColor, width: 1, alpha: 0.6 });
      }
    },
    [
      displayX,
      displayY,
      bx,
      by,
      isMoving,
      walkFrame,
      facingLeft,
      facingRight,
      facingUp,
      animTick,
      vis,
      shellDark,
      shellDeep,
      shellLight,
      clawDark,
      clawLight,
      bellyDark,
      isSelected,
      agentColor,
    ]
  );

  // Hit area
  const drawHit = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      g.rect(bx - 6, by - 5, 32, 34);
      g.fill({ color: 0x000000, alpha: 0.01 });
    },
    [bx, by]
  );

  return (
    <pixiContainer>
      <pixiGraphics draw={draw} />
      <pixiGraphics draw={drawHit} eventMode="static" cursor="pointer" onClick={onClick} />
      {/* Name label */}
      <pixiText
        text={agent.name}
        x={displayX - agent.name.length * 2.5}
        y={Math.round(displayY) + 4}
        style={{ fontSize: 7, fill: 0x444444, fontFamily: "monospace", fontWeight: "bold" } satisfies TextStyleOptions}
      />
      {/* State icon */}
      {stateIcon ? (
        <pixiText
          text={stateIcon}
          x={displayX + 10}
          y={by}
          style={{ fontSize: 7, fill: agentColor, fontFamily: "monospace" } satisfies TextStyleOptions}
        />
      ) : null}
    </pixiContainer>
  );
}

// ---------------------------------------------------------------------------
// Speech bubble (pixel art style)
// ---------------------------------------------------------------------------

/**
 * Pokemon/RPG-style dialogue box — fixed at the bottom of the canvas.
 * Shows the latest message with agent name + full text.
 */
function DialogueBox({ bubble }: { bubble: SpeechBubble | null }) {
  // Word-wrap text to fit the box
  const maxCharsPerLine = 65;
  const wrapText = (text: string): string[] => {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      if ((current + " " + word).trim().length > maxCharsPerLine) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = current ? current + " " + word : word;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 4); // max 4 lines
  };

  const lines = bubble ? wrapText(bubble.text) : [];
  const boxW = CANVAS_W - 32;
  const boxH = 60;
  const boxX = 16;
  const boxY = CANVAS_H - boxH - 8;

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      if (!bubble) return;

      // Outer border (pixel art style: double border)
      g.rect(boxX - 2, boxY - 2, boxW + 4, boxH + 4);
      g.fill({ color: 0x222222, alpha: 0.95 });
      // Inner border
      g.rect(boxX, boxY, boxW, boxH);
      g.fill({ color: 0x1a1a2e, alpha: 0.95 });
      // Inner highlight
      g.rect(boxX + 2, boxY + 2, boxW - 4, boxH - 4);
      g.fill({ color: 0x16213e, alpha: 0.95 });
      // Top highlight line
      g.rect(boxX + 2, boxY + 2, boxW - 4, 1);
      g.fill({ color: 0x334466, alpha: 0.5 });

      // Name tag background
      const hasTarget = bubble.target && bubble.target !== "all" && bubble.target !== "self";
      const nameLabel = hasTarget
        ? `${bubble.agent} > ${bubble.target}`
        : bubble.agent;
      const nameW = nameLabel.length * 6.5 + 16;
      g.rect(boxX + 8, boxY - 7, nameW, 14);
      g.fill({ color: 0x222222, alpha: 0.95 });
      g.rect(boxX + 9, boxY - 6, nameW - 2, 12);
      g.fill({ color: 0xe94560, alpha: 0.9 });
    },
    [bubble, boxX, boxY, boxW, boxH]
  );

  if (!bubble) return null;

  const hasTarget = bubble.target && bubble.target !== "all" && bubble.target !== "self";
  const nameLabel = hasTarget
    ? `${bubble.agent} > ${bubble.target}`
    : bubble.agent;

  return (
    <pixiContainer>
      <pixiGraphics draw={draw} />
      {/* Agent name + target */}
      <pixiText
        text={nameLabel}
        x={boxX + 16}
        y={boxY - 5}
        style={{ fontSize: 9, fill: 0xffffff, fontFamily: "monospace", fontWeight: "bold" } satisfies TextStyleOptions}
      />
      {/* Message text — line by line */}
      {lines.map((line, i) => (
        <pixiText
          key={i}
          text={line}
          x={boxX + 10}
          y={boxY + 8 + i * 12}
          style={{ fontSize: 9, fill: 0xe0e0e0, fontFamily: "monospace" } satisfies TextStyleOptions}
        />
      ))}
    </pixiContainer>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function ActiveRoomGlow({ agents, animTick }: { agents: AgentInfo[]; animTick: number }) {
  const warRoom = ROOMS.find((r) => r.id === "war_room")!;
  const agentsInWarRoom = agents.filter((a) => a.location === "war_room").length;

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      if (agentsInWarRoom < 2) return;

      const rx = warRoom.x * TILE;
      const ry = warRoom.y * TILE;
      const rw = warRoom.w * TILE;
      const rh = warRoom.h * TILE;
      const pulse = 0.15 + Math.sin(animTick * 0.05) * 0.08;

      // Outer glow
      g.rect(rx - 2, ry - 2, rw + 4, rh + 4);
      g.stroke({ color: 0xe94560, width: 2, alpha: pulse });

      // Inner glow fill
      g.rect(rx, ry, rw, rh);
      g.fill({ color: 0xe94560, alpha: pulse * 0.15 });
    },
    [agentsInWarRoom, animTick, warRoom]
  );

  return <pixiGraphics draw={draw} />;
}

export default function OfficeCanvas({
  agents,
  selectedAgent,
  onSelectAgent,
  messages,
  hasActiveQuery,
}: OfficeCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scale = useContainerScale(containerRef);
  const targetPositions = useRef<Record<string, { x: number; y: number }>>({});
  const [displayPositions, setDisplayPositions] = useState<Record<string, { x: number; y: number }>>({});
  const prevPositions = useRef<Record<string, { x: number; y: number }>>({});
  const [animTick, setAnimTick] = useState(0);
  const [bubbles, setBubbles] = useState<SpeechBubble[]>([]);
  const lastMessageCount = useRef(0);

  // Update targets on agent data change
  useEffect(() => {
    const targets: Record<string, { x: number; y: number }> = {};
    agents.forEach((a) => { targets[a.name] = { x: a.position.x, y: a.position.y }; });
    targetPositions.current = targets;

    setDisplayPositions((prev) => {
      const next = { ...prev };
      agents.forEach((a) => {
        if (!next[a.name]) next[a.name] = { x: a.position.x, y: a.position.y };
      });
      return next;
    });
  }, [agents]);

  // Animation + interpolation loop
  useEffect(() => {
    let frameId: number;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = () => {
      setAnimTick((t) => (t + 1) % 3600);

      setDisplayPositions((prev) => {
        prevPositions.current = { ...prev };
        const next = { ...prev };
        let changed = false;
        for (const name in targetPositions.current) {
          const target = targetPositions.current[name];
          const current = next[name] || target;
          const nx = lerp(current.x, target.x, 0.08);
          const ny = lerp(current.y, target.y, 0.08);
          if (Math.abs(nx - current.x) > 0.1 || Math.abs(ny - current.y) > 0.1) {
            next[name] = { x: nx, y: ny };
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Speech bubbles from new messages — each new message replaces the previous
  useEffect(() => {
    if (messages.length > lastMessageCount.current) {
      const newMsgs = messages.slice(lastMessageCount.current);
      const now = Date.now();
      const newBubbles = newMsgs
        .filter((m) => m.type === "speak" || m.type === "announce")
        .map((m) => ({
          agent: m.agent,
          target: m.target ?? "all",
          text: m.message,
          x: targetPositions.current[m.agent]?.x ?? 320,
          y: targetPositions.current[m.agent]?.y ?? 240,
          expiry: now + 30000, // persist for 30s — gets replaced by next msg anyway
        }));
      if (newBubbles.length > 0) {
        // Keep only the latest bubble (RPG style: one dialogue at a time)
        setBubbles(newBubbles.slice(-1));
      }
    }
    lastMessageCount.current = messages.length;
  }, [messages]);

  const handleClick = useCallback(
    (name: string) => onSelectAgent(selectedAgent === name ? null : name),
    [selectedAgent, onSelectAgent]
  );

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-[#ded2b9] overflow-hidden">
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          width: CANVAS_W,
          height: CANVAS_H,
        }}
      >
        <Application width={CANVAS_W} height={CANVAS_H} background={0xded2b9} antialias={false} resolution={2} autoDensity>
          {/* Floor */}
          <FloorGrid />

          {/* Rooms */}
          <pixiContainer>
            {ROOMS.map((r) => <RoomBackground key={r.id} room={r} />)}
          </pixiContainer>

          {/* Active room glow */}
          {hasActiveQuery && <ActiveRoomGlow agents={agents} animTick={animTick} />}

          {/* Furniture */}
          <pixiContainer>
            {ROOMS.map((r) => r.id.startsWith("desk_") ? <DeskFurniture key={`f-${r.id}`} room={r} /> : null)}
            <WarRoomFurniture />
            <BreakRoomFurniture />
            <BulletinBoardFurniture />
          </pixiContainer>

          {/* Room labels */}
          <pixiContainer>
            {ROOMS.map((r) => <RoomLabel key={`l-${r.id}`} room={r} />)}
          </pixiContainer>

          {/* Agents */}
          <pixiContainer>
            {agents.map((agent) => {
              const pos = displayPositions[agent.name] || agent.position;
              const prev = prevPositions.current[agent.name] || pos;
              return (
                <AgentCharacter
                  key={agent.name}
                  agent={agent}
                  isSelected={selectedAgent === agent.name}
                  displayX={pos.x}
                  displayY={pos.y}
                  prevX={prev.x}
                  prevY={prev.y}
                  onClick={() => handleClick(agent.name)}
                  animTick={animTick}
                />
              );
            })}
          </pixiContainer>

          {/* RPG dialogue box — shows latest message */}
          <DialogueBox bubble={bubbles.length > 0 ? bubbles[bubbles.length - 1] : null} />
        </Application>
      </div>
    </div>
  );
}
