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

// Agent visual configs — hair color, skin, shirt color
const AGENT_VISUALS: Record<string, { hair: number; skin: number; shirt: number; pants: number; accessory?: string }> = {
  Maya:   { hair: 0x2c1810, skin: 0xc68642, shirt: 0x4ecdc4, pants: 0x2a2a4a },
  Raj:    { hair: 0x1a1a1a, skin: 0xb5651d, shirt: 0xff6b6b, pants: 0x2a2a4a, accessory: "glasses" },
  Sophie: { hair: 0xe6c84a, skin: 0xf5d6b8, shirt: 0xfeca57, pants: 0x2a2a4a },
  Alex:   { hair: 0x4a3728, skin: 0xdba97a, shirt: 0xa29bfe, pants: 0x2a2a4a },
  Jordan: { hair: 0x6b3a2a, skin: 0xf0c8a0, shirt: 0xfd79a8, pants: 0x2a2a4a },
  Dev:    { hair: 0x2c2c2c, skin: 0xc99e72, shirt: 0x00b894, pants: 0x333355, accessory: "hoodie" },
  Sam:    { hair: 0x3a2a1a, skin: 0xd4a574, shirt: 0x6c5ce7, pants: 0x222244 },
};

// ---------------------------------------------------------------------------
// Floor grid
// ---------------------------------------------------------------------------

function FloorGrid() {
  const draw = useCallback((g: PixiGraphics) => {
    g.clear();
    g.rect(0, 0, CANVAS_W, CANVAS_H);
    g.fill({ color: 0xd8d4cc });

    // Subtle grid pattern
    for (let x = 0; x <= 40; x++) {
      g.moveTo(x * TILE, 0);
      g.lineTo(x * TILE, CANVAS_H);
      g.stroke({ color: 0xccc8c0, width: 0.5 });
    }
    for (let y = 0; y <= 30; y++) {
      g.moveTo(0, y * TILE);
      g.lineTo(CANVAS_W, y * TILE);
      g.stroke({ color: 0xccc8c0, width: 0.5 });
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

      // Desk surface
      g.rect(cx - 20, cy - 6, 40, 14);
      g.fill({ color: 0x8b7355 });
      g.rect(cx - 20, cy - 6, 40, 14);
      g.stroke({ color: 0xa08868, width: 1 });

      // Desk top highlight
      g.rect(cx - 19, cy - 5, 38, 1);
      g.fill({ color: 0xa08868, alpha: 0.5 });

      // Monitor
      g.rect(cx - 7, cy - 18, 14, 10);
      g.fill({ color: 0x334455 });
      g.rect(cx - 7, cy - 18, 14, 10);
      g.stroke({ color: 0x556677, width: 1 });
      // Screen glow
      g.rect(cx - 5, cy - 16, 10, 6);
      g.fill({ color: 0x445566, alpha: 0.6 });
      // Monitor stand
      g.rect(cx - 2, cy - 8, 4, 3);
      g.fill({ color: 0x556677 });

      // Chair
      g.circle(cx, cy + 18, 6);
      g.fill({ color: 0x4a5568, alpha: 0.7 });
      g.circle(cx, cy + 18, 6);
      g.stroke({ color: 0x5a6578, width: 1, alpha: 0.5 });
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
  const vis = AGENT_VISUALS[agent.name] ?? { hair: 0x333333, skin: 0xddaa77, shirt: 0x888888, pants: 0x333333 };
  const agentColor = AGENT_COLORS_HEX[agent.name] ?? 0xcccccc;
  const stateIcon = STATE_ICONS[agent.state];

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
  // Character size: ~12 wide, ~20 tall
  const bx = Math.round(displayX) - 6;  // base x (left edge)
  const by = Math.round(displayY) - 20 + yOff; // base y (top of head)

  const draw = useCallback(
    (g: PixiGraphics) => {
      g.clear();

      // Shadow
      g.ellipse(displayX, displayY + 1, 7, 2);
      g.fill({ color: 0x000000, alpha: 0.3 });

      // === LEGS ===
      const legY = by + 16;
      if (isMoving) {
        // Walk animation — alternate legs
        if (walkFrame === 0 || walkFrame === 2) {
          // Both centered
          g.rect(bx + 3, legY, 2, 4); g.fill({ color: vis.pants });
          g.rect(bx + 7, legY, 2, 4); g.fill({ color: vis.pants });
        } else if (walkFrame === 1) {
          // Left forward
          g.rect(bx + 2, legY, 2, 4); g.fill({ color: vis.pants });
          g.rect(bx + 8, legY - 1, 2, 4); g.fill({ color: vis.pants });
        } else {
          // Right forward
          g.rect(bx + 2, legY - 1, 2, 4); g.fill({ color: vis.pants });
          g.rect(bx + 8, legY, 2, 4); g.fill({ color: vis.pants });
        }
      } else {
        g.rect(bx + 3, legY, 2, 4); g.fill({ color: vis.pants });
        g.rect(bx + 7, legY, 2, 4); g.fill({ color: vis.pants });
      }

      // Shoes
      const shoeY = legY + 3;
      if (isMoving && (walkFrame === 1 || walkFrame === 3)) {
        g.rect(bx + (walkFrame === 1 ? 1 : 1), shoeY + 1, 3, 1); g.fill({ color: 0x222222 });
        g.rect(bx + (walkFrame === 1 ? 7 : 7), shoeY, 3, 1); g.fill({ color: 0x222222 });
      } else {
        g.rect(bx + 2, shoeY + 1, 3, 1); g.fill({ color: 0x222222 });
        g.rect(bx + 7, shoeY + 1, 3, 1); g.fill({ color: 0x222222 });
      }

      // === BODY / SHIRT ===
      g.rect(bx + 2, by + 9, 8, 7);
      g.fill({ color: vis.shirt });
      // Shirt highlight
      g.rect(bx + 3, by + 9, 1, 6);
      g.fill({ color: 0xffffff, alpha: 0.15 });

      // Arms
      if (isMoving) {
        // Swinging arms
        const armSwing = walkFrame === 1 ? 1 : walkFrame === 3 ? -1 : 0;
        g.rect(bx + 0, by + 10 + armSwing, 2, 5); g.fill({ color: vis.shirt });
        g.rect(bx + 10, by + 10 - armSwing, 2, 5); g.fill({ color: vis.shirt });
      } else {
        g.rect(bx + 0, by + 10, 2, 5); g.fill({ color: vis.shirt });
        g.rect(bx + 10, by + 10, 2, 5); g.fill({ color: vis.shirt });
      }

      // Hoodie detail for Dev
      if (vis.accessory === "hoodie") {
        g.rect(bx + 4, by + 9, 4, 2);
        g.fill({ color: 0xffffff, alpha: 0.08 });
      }

      // === HEAD ===
      g.rect(bx + 2, by + 3, 8, 6);
      g.fill({ color: vis.skin });
      // Head highlight
      g.rect(bx + 2, by + 3, 8, 1);
      g.fill({ color: 0xffffff, alpha: 0.1 });

      // === HAIR ===
      g.rect(bx + 1, by, 10, 4);
      g.fill({ color: vis.hair });
      // Hair top highlight
      g.rect(bx + 2, by, 6, 1);
      g.fill({ color: 0xffffff, alpha: 0.1 });

      // === FACE ===
      if (facingUp) {
        // Back of head — just hair, no face
        g.rect(bx + 2, by + 3, 8, 3);
        g.fill({ color: vis.hair });
      } else {
        // Eyes
        const eyeY = by + 5;
        if (facingLeft) {
          px(g, bx + 3, eyeY, 0x222222);
          px(g, bx + 6, eyeY, 0x222222);
        } else if (facingRight) {
          px(g, bx + 5, eyeY, 0x222222);
          px(g, bx + 8, eyeY, 0x222222);
        } else {
          px(g, bx + 4, eyeY, 0x222222);
          px(g, bx + 7, eyeY, 0x222222);
        }

        // Glasses for Raj
        if (vis.accessory === "glasses") {
          const ey = by + 5;
          if (!facingLeft && !facingRight) {
            g.rect(bx + 3, ey - 1, 3, 3); g.stroke({ color: 0x888888, width: 0.5, alpha: 0.7 });
            g.rect(bx + 6, ey - 1, 3, 3); g.stroke({ color: 0x888888, width: 0.5, alpha: 0.7 });
          }
        }

        // Mouth (small line)
        g.rect(bx + 5, by + 7, 2, 1);
        g.fill({ color: 0x000000, alpha: 0.2 });
      }

      // === SELECTION ===
      if (isSelected) {
        g.rect(bx - 2, by - 2, 16, 26);
        g.stroke({ color: 0x333333, width: 1, alpha: 0.9 });
        g.rect(bx - 3, by - 3, 18, 28);
        g.stroke({ color: agentColor, width: 1, alpha: 0.6 });
      }
    },
    [displayX, displayY, bx, by, isMoving, walkFrame, facingLeft, facingRight, facingUp, vis, isSelected, agentColor]
  );

  // Hit area
  const drawHit = useCallback(
    (g: PixiGraphics) => {
      g.clear();
      g.rect(bx - 4, by - 4, 20, 32);
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
    <div ref={containerRef} className="w-full h-full flex items-center justify-center bg-[#d8d4cc] overflow-hidden">
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          width: CANVAS_W,
          height: CANVAS_H,
        }}
      >
        <Application width={CANVAS_W} height={CANVAS_H} background={0xd8d4cc} antialias={false} resolution={2} autoDensity>
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
