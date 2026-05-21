/**
 * Multimodal feedback for barcode/QR scan events.
 *
 * Three signals fire together on a successful decode:
 *   - Visual: green flash + corner-marker pulse (rendered by the scanner
 *     component reading `justDecoded` state — not handled here).
 *   - Audio: a short 1.8kHz Web Audio tone with exponential decay.
 *   - Haptic: navigator.vibrate(80ms) — Android Chrome supports, iOS Safari
 *     no-ops safely (no error).
 *
 * Three signals because each device subset hits a different one:
 *   - Desktop with speakers: audio.
 *   - Mobile in pocket / muted: haptic.
 *   - Mobile in silent mode: visual.
 *
 * The trio eliminates the "beep-but-no-result confusion" anti-pattern where
 * the user re-scans because they didn't notice the first decode landed.
 *
 * Audio + haptic are gated by user preferences (see scan-settings.ts) so
 * users can mute either channel without giving up the other two signals.
 *
 * Web Audio caveat: AudioContext created outside a user gesture is
 * suspended on iOS Safari. We create it lazily inside the first
 * playScanBeep() call — that call sits inside the decode callback, which
 * itself sits inside a startScanning() chain that started from a touch
 * event. Safe.
 */

import { readScanSettings } from "./scan-settings";

let cachedContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  // Cross-browser AudioContext discovery. Older iOS Safari only had
  // webkitAudioContext; current versions expose the standard too.
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (cachedContext) {
    // iOS Safari may suspend the context if the page lost focus between
    // scans. Resume on demand. resume() is a no-op if already running.
    if (cachedContext.state === "suspended") {
      void cachedContext.resume().catch(() => {
        // ignore — beep just won't play this time
      });
    }
    return cachedContext;
  }
  try {
    cachedContext = new Ctor();
    return cachedContext;
  } catch {
    return null;
  }
}

/**
 * Short scan-confirm beep — 1800 Hz, ~150ms with exponential decay so it
 * cuts through ambient noise without being unpleasant on repeated scans.
 * No-op if AudioContext is unavailable or fails to start.
 */
export function playScanBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1800;
    // 0.3 starting gain → exponential decay to near-zero over 150ms. Avoid
    // setting to actual 0; exponentialRampToValueAtTime requires > 0.
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Web Audio can throw if the context was closed mid-call — ignore;
    // beep is purely confirmatory, not safety-critical.
  }
}

/**
 * Haptic confirm via the Vibration API. 80ms is the sweet spot — long
 * enough to feel through a pocket, short enough not to be annoying when
 * batch-scanning. iOS Safari ignores this silently (no permission prompt,
 * no error), which is the desired graceful-degrade behaviour.
 */
export function triggerHapticFeedback(): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(80);
  } catch {
    // Some browsers throw on insecure contexts — ignore.
  }
}

/**
 * Fire all three feedback signals at once. Call this in the same tick as
 * the scanner's decode event so the user gets immediate confirmation of
 * the capture before any API resolution takes place.
 *
 * Audio + haptic are gated by user prefs (read each call — see
 * readScanSettings doc for cost rationale). Callers don't need to know
 * about the prefs; they just call this and it does the right thing.
 */
export function triggerScanFeedback(): void {
  const prefs = readScanSettings();
  if (prefs.soundEnabled) playScanBeep();
  if (prefs.vibrateEnabled) triggerHapticFeedback();
}

// ── Screen Wake Lock ─────────────────────────────────────────────────
//
// During an audit walkthrough or batch scan the camera stays open for
// minutes. Without a wake lock the screen sleeps, the camera session is
// invalidated, and the user has to re-acquire. WakeLockSentinel is W3C
// standard (Chrome 84+, Edge 84+, Safari 16.4+). Browsers without the API
// just no-op — useful on desktop where the user can move the mouse.

// Narrow types — TS DOM lib doesn't expose WakeLockSentinel everywhere yet.
interface WakeLockSentinelLike {
  release: () => Promise<void>;
  released: boolean;
}
interface WakeLockApi {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

let activeLock: WakeLockSentinelLike | null = null;

function getWakeLockApi(): WakeLockApi | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as unknown as { wakeLock?: WakeLockApi })
    .wakeLock;
  return candidate ?? null;
}

/**
 * Acquire a screen wake lock for the duration of an active scan session.
 * Safe to call multiple times — re-acquires if the previous lock was
 * released (e.g. by the browser when the tab went to background).
 *
 * Returns true if a lock is currently held, false otherwise. Callers can
 * branch on the return value to surface a "screen may sleep" hint, but
 * the call is fire-and-forget by design.
 */
export async function acquireScreenWakeLock(): Promise<boolean> {
  const api = getWakeLockApi();
  if (!api) return false;
  // Already held — nothing to do.
  if (activeLock && !activeLock.released) return true;
  try {
    activeLock = await api.request("screen");
    return true;
  } catch {
    // NotAllowedError if the page isn't visible — ignore; we'll retry
    // when visibility returns via the visibility-change listener wired
    // up in the scanner component.
    return false;
  }
}

/** Release the wake lock if held. Idempotent. */
export async function releaseScreenWakeLock(): Promise<void> {
  if (!activeLock) return;
  try {
    await activeLock.release();
  } catch {
    // ignore
  }
  activeLock = null;
}
