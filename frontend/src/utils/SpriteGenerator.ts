// ============================================================================
// SpriteGenerator.ts — Procedural pixel art sprite generation for Office Agents
// All assets are drawn via Canvas2D and converted to data URLs for PixiJS.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentVisual {
  shellColor: string;
  bellyColor: string;
  clawColor: string;
  accentColor: string;
}

type AnimDirection = 'idle' | 'walk_down' | 'walk_up' | 'walk_left' | 'walk_right';

// ---------------------------------------------------------------------------
// Agent visual configs
// ---------------------------------------------------------------------------

const AGENT_VISUALS: Record<string, AgentVisual> = {
  Clawdia: {
    shellColor: '#ff6f61',
    bellyColor: '#ffb09a',
    clawColor: '#e84c3d',
    accentColor: '#4ecdc4',
  },
  Shelldon: {
    shellColor: '#f05248',
    bellyColor: '#ff9d7d',
    clawColor: '#c9352d',
    accentColor: '#ffcf6e',
  },
  Coraline: {
    shellColor: '#ff8a5c',
    bellyColor: '#ffd29a',
    clawColor: '#f05a3e',
    accentColor: '#feca57',
  },
  Reefus: {
    shellColor: '#f4767f',
    bellyColor: '#ffc2b0',
    clawColor: '#d94e61',
    accentColor: '#a29bfe',
  },
  Pearl: {
    shellColor: '#ff728f',
    bellyColor: '#ffc0c9',
    clawColor: '#e24569',
    accentColor: '#fd79a8',
  },
  Snips: {
    shellColor: '#e85f4d',
    bellyColor: '#ffad8f',
    clawColor: '#c94335',
    accentColor: '#00b894',
  },
  "Captain Claw": {
    shellColor: '#e96b5c',
    bellyColor: '#ffc1a8',
    clawColor: '#ce4d42',
    accentColor: '#6c5ce7',
  },
};

// ---------------------------------------------------------------------------
// Low-level pixel helpers
// ---------------------------------------------------------------------------

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

/** Set a single pixel on the context */
function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

/** Fill a rectangular area */
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Darken a hex color by a factor (0..1, where 0=black, 1=unchanged) */
function darken(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r * factor);
  const ng = Math.round(g * factor);
  const nb = Math.round(b * factor);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

/** Lighten a hex color toward white */
function lighten(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * factor));
  const ng = Math.min(255, Math.round(g + (255 - g) * factor));
  const nb = Math.min(255, Math.round(b + (255 - b) * factor));
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Character drawing functions
// ---------------------------------------------------------------------------

/**
 * Draw a single character frame at (ox, oy) on the given context.
 *
 * Frame size: 16x24 pixels.
 * Direction determines facing; walkPhase (0-3) determines leg position.
 * idle uses a vertical offset bob.
 */
function drawCharacterFrame(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  vis: AgentVisual,
  direction: AnimDirection,
  walkPhase: number,
) {
  const shell = vis.shellColor;
  const belly = vis.bellyColor;
  const claw = vis.clawColor;
  const accent = vis.accentColor;
  const shellDark = darken(shell, 0.72);
  const shellDeep = darken(shell, 0.55);
  const shellLight = lighten(shell, 0.28);
  const clawDark = darken(claw, 0.65);
  const clawLight = lighten(claw, 0.22);
  const bellyDark = darken(belly, 0.82);
  const eye = '#171214';

  const bob = direction === 'idle' && walkPhase === 1 ? 1 : 0;
  const y = oy + bob;

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(ox + 8, oy + 22, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const isBack = direction === 'walk_up';
  const look = direction === 'walk_left' ? -1 : direction === 'walk_right' ? 1 : 0;
  const legStride = direction === 'idle' ? 0 : walkPhase % 2;
  const clawLift = direction === 'idle'
    ? (walkPhase === 1 ? -1 : 0)
    : (walkPhase === 1 ? -1 : walkPhase === 3 ? 1 : 0);

  // Side legs behind the body.
  for (let i = 0; i < 3; i++) {
    const ly = y + 10 + i * 3;
    const stride = legStride && i !== 1 ? 1 : 0;
    px(ctx, ox + 4 - stride, ly, shellDeep);
    px(ctx, ox + 3 - stride, ly + 1, shellDark);
    px(ctx, ox + 11 + stride, ly, shellDeep);
    px(ctx, ox + 12 + stride, ly + 1, shellDark);
  }

  // Tail fan and segmented belly.
  rect(ctx, ox + 6, y + 17, 4, 2, shellDark);
  rect(ctx, ox + 5, y + 18, 6, 2, shell);
  px(ctx, ox + 4, y + 20, shell);
  rect(ctx, ox + 6, y + 20, 4, 1, shellLight);
  px(ctx, ox + 11, y + 20, shell);

  rect(ctx, ox + 5, y + 11, 6, 7, belly);
  rect(ctx, ox + 4, y + 12, 1, 5, shellDark);
  rect(ctx, ox + 11, y + 12, 1, 5, shellDark);
  rect(ctx, ox + 6, y + 13, 4, 1, bellyDark);
  rect(ctx, ox + 6, y + 15, 4, 1, bellyDark);

  // Claws and little jointed arms.
  const leftBase = direction === 'walk_left' ? 0 : 1;
  const rightBase = direction === 'walk_right' ? 12 : 11;
  const clawY = y + 7 + clawLift;

  rect(ctx, ox + 3, clawY + 4, 3, 2, shellDark);
  rect(ctx, ox + leftBase, clawY + 1, 4, 4, claw);
  rect(ctx, ox + leftBase - 1, clawY + 2, 2, 2, claw);
  px(ctx, ox + leftBase + 1, clawY, clawLight);
  px(ctx, ox + leftBase + 2, clawY + 3, clawDark);

  rect(ctx, ox + 10, clawY + 4, 3, 2, shellDark);
  rect(ctx, ox + rightBase, clawY + 1, 4, 4, claw);
  rect(ctx, ox + rightBase + 3, clawY + 2, 2, 2, claw);
  px(ctx, ox + rightBase + 2, clawY, clawLight);
  px(ctx, ox + rightBase + 1, clawY + 3, clawDark);

  // Carapace and head.
  rect(ctx, ox + 4, y + 5, 8, 7, shell);
  rect(ctx, ox + 5, y + 4, 6, 2, shellLight);
  rect(ctx, ox + 4, y + 10, 8, 2, shellDark);
  px(ctx, ox + 7, y + 6, accent);
  px(ctx, ox + 8, y + 6, accent);

  if (isBack) {
    rect(ctx, ox + 5, y + 3, 6, 3, shellDark);
    rect(ctx, ox + 6, y + 2, 4, 1, shellLight);
    px(ctx, ox + 6, y + 8, shellDeep);
    px(ctx, ox + 9, y + 8, shellDeep);
    px(ctx, ox + 4, y + 2, accent);
    px(ctx, ox + 11, y + 2, accent);
  } else {
    // Eye stalks, antennae, and soft cheeks.
    px(ctx, ox + 5 + look, y + 3, shellDark);
    px(ctx, ox + 5 + look, y + 4, shellDark);
    px(ctx, ox + 10 + look, y + 3, shellDark);
    px(ctx, ox + 10 + look, y + 4, shellDark);
    px(ctx, ox + 4 + look, y + 2, eye);
    px(ctx, ox + 5 + look, y + 2, eye);
    px(ctx, ox + 10 + look, y + 2, eye);
    px(ctx, ox + 11 + look, y + 2, eye);
    px(ctx, ox + 5 + look, y + 2, '#ffffff');
    px(ctx, ox + 11 + look, y + 2, '#ffffff');
    px(ctx, ox + 6, y + 8, accent);
    px(ctx, ox + 9, y + 8, accent);
    px(ctx, ox + 7, y + 9, shellDeep);
    px(ctx, ox + 8, y + 9, shellDeep);

    px(ctx, ox + 4 + look, y + 1, accent);
    px(ctx, ox + 3 + look, y + 1, accent);
    px(ctx, ox + 2 + look, y + 2, accent);
    px(ctx, ox + 11 + look, y + 1, accent);
    px(ctx, ox + 12 + look, y + 1, accent);
    px(ctx, ox + 13 + look, y + 2, accent);
  }
}

// ---------------------------------------------------------------------------
// Sprite sheet generation
// ---------------------------------------------------------------------------

const FRAME_W = 16;
const FRAME_H = 24;

// Frame order: idle(2) + walk_down(4) + walk_up(4) + walk_left(4) + walk_right(4) = 18 frames
const ANIM_SEQUENCE: { dir: AnimDirection; phase: number }[] = [
  // Idle
  { dir: 'idle', phase: 0 },
  { dir: 'idle', phase: 1 },
  // Walk down
  { dir: 'walk_down', phase: 0 },
  { dir: 'walk_down', phase: 1 },
  { dir: 'walk_down', phase: 2 },
  { dir: 'walk_down', phase: 3 },
  // Walk up
  { dir: 'walk_up', phase: 0 },
  { dir: 'walk_up', phase: 1 },
  { dir: 'walk_up', phase: 2 },
  { dir: 'walk_up', phase: 3 },
  // Walk left
  { dir: 'walk_left', phase: 0 },
  { dir: 'walk_left', phase: 1 },
  { dir: 'walk_left', phase: 2 },
  { dir: 'walk_left', phase: 3 },
  // Walk right
  { dir: 'walk_right', phase: 0 },
  { dir: 'walk_right', phase: 1 },
  { dir: 'walk_right', phase: 2 },
  { dir: 'walk_right', phase: 3 },
];

const TOTAL_FRAMES = ANIM_SEQUENCE.length; // 18

/**
 * Generate a full sprite sheet for one agent character.
 * Returns a canvas of size (18 * 16) x 24 = 288 x 24.
 */
export function generateCharacterSheet(agentName: string): HTMLCanvasElement {
  const vis = AGENT_VISUALS[agentName];
  if (!vis) {
    throw new Error(`Unknown agent: ${agentName}`);
  }

  const [canvas, ctx] = createCanvas(TOTAL_FRAMES * FRAME_W, FRAME_H);

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const { dir, phase } = ANIM_SEQUENCE[i];
    drawCharacterFrame(ctx, i * FRAME_W, 0, vis, dir, phase);
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Frame index helpers (exported for use in OfficeCanvas)
// ---------------------------------------------------------------------------

export const SPRITE_FRAME_WIDTH = FRAME_W;
export const SPRITE_FRAME_HEIGHT = FRAME_H;

/** Starting frame index and count for each animation */
export const ANIM_RANGES: Record<AnimDirection, { start: number; count: number }> = {
  idle: { start: 0, count: 2 },
  walk_down: { start: 2, count: 4 },
  walk_up: { start: 6, count: 4 },
  walk_left: { start: 10, count: 4 },
  walk_right: { start: 14, count: 4 },
};

// ---------------------------------------------------------------------------
// Tile / texture generation
// ---------------------------------------------------------------------------

/** Dark floor tile (16x16) with subtle grid */
export function generateFloorTile(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(16, 16);
  // Base
  rect(ctx, 0, 0, 16, 16, '#1e1e32');
  // Subtle grid lines
  rect(ctx, 0, 0, 16, 1, '#252540');
  rect(ctx, 0, 0, 1, 16, '#252540');
  // Corner accent
  px(ctx, 0, 0, '#2a2a48');
  // Tiny specks for texture
  px(ctx, 4, 6, '#222238');
  px(ctx, 10, 3, '#222238');
  px(ctx, 7, 11, '#222238');
  px(ctx, 13, 9, '#222238');
  return canvas;
}

/** Wall tile (16x16) */
export function generateWallTile(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(16, 16);
  rect(ctx, 0, 0, 16, 16, '#2a2a48');
  // Top edge highlight
  rect(ctx, 0, 0, 16, 1, '#3a3a5e');
  // Bottom edge shadow
  rect(ctx, 0, 15, 16, 1, '#1a1a30');
  // Brick pattern
  rect(ctx, 0, 4, 16, 1, '#262642');
  rect(ctx, 0, 9, 16, 1, '#262642');
  rect(ctx, 7, 0, 1, 4, '#262642');
  rect(ctx, 3, 5, 1, 4, '#262642');
  rect(ctx, 11, 5, 1, 4, '#262642');
  rect(ctx, 7, 10, 1, 6, '#262642');
  return canvas;
}

/** Carpet tile for break room (16x16) */
export function generateCarpetTile(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(16, 16);
  rect(ctx, 0, 0, 16, 16, '#1f3d2b');
  // Soft texture pattern (dithered)
  for (let ty = 0; ty < 16; ty += 2) {
    for (let tx = 0; tx < 16; tx += 2) {
      if ((tx + ty) % 4 === 0) {
        px(ctx, tx, ty, '#224830');
      }
    }
  }
  // Subtle border
  rect(ctx, 0, 0, 16, 1, '#1a3425');
  rect(ctx, 0, 0, 1, 16, '#1a3425');
  return canvas;
}

/** Wood floor tile for war room (16x16) */
export function generateWoodTile(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(16, 16);
  rect(ctx, 0, 0, 16, 16, '#2a2040');
  // Plank lines
  rect(ctx, 0, 0, 16, 1, '#221a35');
  rect(ctx, 0, 5, 16, 1, '#221a35');
  rect(ctx, 0, 10, 16, 1, '#221a35');
  rect(ctx, 0, 15, 16, 1, '#221a35');
  // Wood grain
  px(ctx, 3, 2, '#2e2448');
  px(ctx, 8, 3, '#2e2448');
  px(ctx, 12, 7, '#2e2448');
  px(ctx, 5, 8, '#2e2448');
  px(ctx, 10, 12, '#2e2448');
  px(ctx, 2, 13, '#2e2448');
  // Highlight streaks
  px(ctx, 6, 2, '#332850');
  px(ctx, 11, 8, '#332850');
  px(ctx, 4, 13, '#332850');
  return canvas;
}

/** Desk sprite (32x16) — top-down view of a desk with monitor */
export function generateDeskSprite(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(32, 16);
  // Desk surface
  rect(ctx, 0, 2, 32, 12, '#3d2b1f');
  rect(ctx, 1, 3, 30, 10, '#4a3528');
  // Edge highlight
  rect(ctx, 0, 2, 32, 1, '#5a4535');
  // Monitor
  rect(ctx, 10, 0, 12, 8, '#2a2a44');
  rect(ctx, 11, 1, 10, 6, '#334455');
  // Screen glow
  rect(ctx, 12, 2, 8, 4, '#445566');
  // Monitor stand
  rect(ctx, 15, 8, 2, 2, '#556677');
  // Keyboard
  rect(ctx, 10, 10, 12, 3, '#222233');
  rect(ctx, 11, 11, 10, 1, '#333344');
  // Coffee mug
  rect(ctx, 25, 4, 4, 4, '#665544');
  rect(ctx, 26, 5, 2, 2, '#443322');
  // Papers
  rect(ctx, 2, 4, 6, 8, '#ddd8cc');
  rect(ctx, 3, 5, 4, 6, '#ccc8bc');
  return canvas;
}

/** Conference table for war room (80x32) */
export function generateConferenceTable(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(80, 32);
  // Table surface
  rect(ctx, 2, 2, 76, 28, '#2a2540');
  rect(ctx, 3, 3, 74, 26, '#332e4c');
  // Edge highlight
  rect(ctx, 2, 2, 76, 1, '#3d3860');
  rect(ctx, 2, 2, 1, 28, '#3d3860');
  // Edge shadow
  rect(ctx, 2, 29, 76, 1, '#1e1a30');
  rect(ctx, 77, 2, 1, 28, '#1e1a30');
  // Center decoration line
  rect(ctx, 20, 15, 40, 1, '#3d3860');
  rect(ctx, 20, 16, 40, 1, '#1e1a30');
  return canvas;
}

/** Couch for break room (24x12) */
export function generateCouch(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(24, 12);
  // Couch body
  rect(ctx, 0, 3, 24, 9, '#443366');
  // Back rest
  rect(ctx, 0, 0, 24, 5, '#554477');
  rect(ctx, 1, 1, 22, 3, '#665588');
  // Seat cushions
  rect(ctx, 1, 5, 10, 5, '#4a3a66');
  rect(ctx, 13, 5, 10, 5, '#4a3a66');
  // Arm rests
  rect(ctx, 0, 3, 2, 9, '#3a2a55');
  rect(ctx, 22, 3, 2, 9, '#3a2a55');
  return canvas;
}

/** Coffee machine (12x16) */
export function generateCoffeeMachine(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(12, 16);
  // Body
  rect(ctx, 1, 2, 10, 14, '#443322');
  rect(ctx, 2, 3, 8, 12, '#554433');
  // Top cap
  rect(ctx, 0, 0, 12, 3, '#332211');
  // Display
  rect(ctx, 3, 4, 6, 3, '#66aa66');
  // Nozzle
  rect(ctx, 5, 8, 2, 2, '#666666');
  // Cup area
  rect(ctx, 3, 10, 6, 4, '#222222');
  // Cup
  rect(ctx, 4, 11, 4, 3, '#dddddd');
  return canvas;
}

/** Cork bulletin board (48x32) */
export function generateCorkBoard(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(48, 32);
  // Board frame
  rect(ctx, 0, 0, 48, 32, '#5a4a30');
  rect(ctx, 2, 2, 44, 28, '#7a6a50');

  // Cork texture (dithered)
  for (let ty = 2; ty < 30; ty++) {
    for (let tx = 2; tx < 46; tx++) {
      if ((tx * 7 + ty * 13) % 5 === 0) {
        px(ctx, tx, ty, '#8a7a5a');
      }
      if ((tx * 11 + ty * 3) % 7 === 0) {
        px(ctx, tx, ty, '#6a5a40');
      }
    }
  }

  // Sticky notes
  const notes: [number, number, string][] = [
    [5, 5, '#feca57'],
    [20, 4, '#ff6b6b'],
    [35, 6, '#4ecdc4'],
    [8, 17, '#a29bfe'],
    [25, 18, '#fd79a8'],
  ];
  for (const [nx, ny, color] of notes) {
    rect(ctx, nx, ny, 10, 8, color);
    // Pin
    px(ctx, nx + 4, ny, '#cc3333');
    px(ctx, nx + 5, ny, '#cc3333');
    // Text lines on note
    rect(ctx, nx + 1, ny + 3, 8, 1, darken(color, 0.7));
    rect(ctx, nx + 1, ny + 5, 6, 1, darken(color, 0.7));
  }

  return canvas;
}

/** Whiteboard (48x20) */
export function generateWhiteboard(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(48, 20);
  // Frame
  rect(ctx, 0, 0, 48, 20, '#6666aa');
  // White surface
  rect(ctx, 2, 2, 44, 16, '#dddddd');
  rect(ctx, 3, 3, 42, 14, '#eeeeee');
  // Marker tray
  rect(ctx, 10, 17, 28, 2, '#888888');
  // Markers
  rect(ctx, 14, 17, 4, 2, '#ff3333');
  rect(ctx, 20, 17, 4, 2, '#3333ff');
  rect(ctx, 26, 17, 4, 2, '#33aa33');
  // Some scribbles on the board
  rect(ctx, 5, 5, 15, 1, '#4444aa');
  rect(ctx, 5, 8, 12, 1, '#4444aa');
  rect(ctx, 25, 6, 18, 1, '#aa4444');
  rect(ctx, 25, 9, 14, 1, '#aa4444');
  return canvas;
}

/** Plant decoration (8x12) */
export function generatePlant(): HTMLCanvasElement {
  const [canvas, ctx] = createCanvas(8, 12);
  // Pot
  rect(ctx, 1, 7, 6, 5, '#8b4513');
  rect(ctx, 2, 7, 4, 1, '#a0522d');
  // Dirt
  rect(ctx, 2, 7, 4, 1, '#3d2b1f');
  // Leaves
  px(ctx, 3, 3, '#2d8b2d');
  px(ctx, 4, 2, '#2d8b2d');
  px(ctx, 4, 4, '#2d8b2d');
  px(ctx, 5, 3, '#2d8b2d');
  px(ctx, 3, 5, '#228822');
  px(ctx, 5, 5, '#228822');
  px(ctx, 2, 4, '#228822');
  px(ctx, 6, 4, '#228822');
  // Stem
  px(ctx, 4, 5, '#1a661a');
  px(ctx, 4, 6, '#1a661a');
  return canvas;
}

// ---------------------------------------------------------------------------
// Master generation: all sprites as data URLs
// ---------------------------------------------------------------------------

let _cachedSprites: Record<string, string> | null = null;

/**
 * Generate all sprites and return as a map of data URLs.
 * Results are cached after first call.
 */
export function generateAllSprites(): Record<string, string> {
  if (_cachedSprites) return _cachedSprites;

  const sprites: Record<string, string> = {};

  // Character sheets
  const agentNames = ['Clawdia', 'Shelldon', 'Coraline', 'Reefus', 'Pearl', 'Snips', 'Captain Claw'];
  for (const name of agentNames) {
    const sheet = generateCharacterSheet(name);
    sprites[`char_${name}`] = sheet.toDataURL();
  }

  // Tiles
  sprites['tile_floor'] = generateFloorTile().toDataURL();
  sprites['tile_wall'] = generateWallTile().toDataURL();
  sprites['tile_carpet'] = generateCarpetTile().toDataURL();
  sprites['tile_wood'] = generateWoodTile().toDataURL();

  // Furniture
  sprites['furniture_desk'] = generateDeskSprite().toDataURL();
  sprites['furniture_conference_table'] = generateConferenceTable().toDataURL();
  sprites['furniture_couch'] = generateCouch().toDataURL();
  sprites['furniture_coffee_machine'] = generateCoffeeMachine().toDataURL();
  sprites['furniture_cork_board'] = generateCorkBoard().toDataURL();
  sprites['furniture_whiteboard'] = generateWhiteboard().toDataURL();
  sprites['furniture_plant'] = generatePlant().toDataURL();

  _cachedSprites = sprites;
  return sprites;
}

/**
 * Get the visual config for an agent (useful for drawing portraits, etc.)
 */
export function getAgentVisual(agentName: string): AgentVisual | undefined {
  return AGENT_VISUALS[agentName];
}

/**
 * Generate a single idle portrait frame for an agent, returned as data URL.
 * Useful for scaled-up portrait display in detail panels.
 */
export function generateAgentPortrait(agentName: string): string {
  const vis = AGENT_VISUALS[agentName];
  if (!vis) return '';
  const [canvas, ctx] = createCanvas(FRAME_W, FRAME_H);
  drawCharacterFrame(ctx, 0, 0, vis, 'idle', 0);
  return canvas.toDataURL();
}
