/**
 * Pokemon-style sound effects using Web Audio API.
 * No audio files needed — all synthesized.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Unlock audio context on first user interaction (browser requirement) */
export function unlockAudio() {
  const c = getCtx();
  if (c.state === "suspended") c.resume();
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = "square",
  volume = 0.08,
  rampDown = true,
) {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    if (rampDown) {
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    }
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration);
  } catch {
    // Audio not available — fail silently
  }
}

/** Agent speaks — short Pokemon "blip" */
export function playSpeak() {
  playTone(600, 0.06, "square", 0.05);
  setTimeout(() => playTone(800, 0.06, "square", 0.05), 70);
}

/** Search started — ascending "boop boop boop" */
export function playSearch() {
  playTone(400, 0.08, "square", 0.04);
  setTimeout(() => playTone(500, 0.08, "square", 0.04), 100);
  setTimeout(() => playTone(650, 0.08, "square", 0.04), 200);
}

/** Whiteboard written / answer ready — Pokemon "level up" jingle */
export function playAnswerReady() {
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.15, "square", 0.06, true), i * 120);
  });
}

/** Query submitted — descending "whoosh" */
export function playQuerySubmit() {
  playTone(800, 0.1, "triangle", 0.06);
  setTimeout(() => playTone(600, 0.1, "triangle", 0.06), 80);
  setTimeout(() => playTone(500, 0.15, "triangle", 0.05), 160);
}

/** Thinking indicator — very subtle low pulse */
export function playThinking() {
  playTone(200, 0.15, "sine", 0.02, true);
}

/** New water cooler chat — soft blip */
export function playChatBlip() {
  playTone(440, 0.05, "sine", 0.03);
}
