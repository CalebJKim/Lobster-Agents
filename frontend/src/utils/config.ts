// Frontend tunables. Centralized so they're easy to spot and adjust without
// hunting through component files. Names match what they tune.

/** Base WebSocket reconnect delay (ms). Doubled each retry up to MAX. */
export const RECONNECT_BASE_DELAY_MS = 1000;

/** Cap for the exponential WebSocket reconnect backoff (ms). */
export const RECONNECT_MAX_DELAY_MS = 30000;

/** How long ago a "speak" message can be before the 3D scene drops its
 *  speech bubble. Shorter feels chattier; longer keeps text on screen. */
export const SPEECH_BUBBLE_TTL_MS = 9000;

/** Per-request timeout for sandbox REST calls (ms). The dock falls back to
 *  the next URL in fetchJson's retry list when one URL exceeds this. */
export const SANDBOX_API_TIMEOUT_MS = 8000;

/** How far back to look when deduplicating identical chat messages. The
 *  backend occasionally re-broadcasts during reconnect, so a small window
 *  is enough to swallow duplicates without losing legitimate repeats. */
export const MESSAGE_DEDUP_WINDOW = 12;

/** SandboxOrchestrator's fallback poll interval (ms). See its useEffect for
 *  why this can't be dropped: WS sandbox_task_* events don't carry the full
 *  run_status payload yet, so the dock still needs a periodic refresh. */
export const SANDBOX_POLL_INTERVAL_MS = 30000;
