/** The part of `AudioContext` the ding uses, so tests can pass a fake. */
export type DingAudioContext = Pick<
  AudioContext,
  "state" | "currentTime" | "destination" | "resume" | "createGain" | "createOscillator"
>;

export type Ding = {
  /** Call from a click: browsers only let a page start audio after the user has interacted. */
  unlock(): void;
  /** Plays the ding, once per burst; does nothing until unlocked. */
  play(): void;
};

export type DingOptions = {
  createContext?: () => DingAudioContext | null;
  /** Milliseconds, for the burst check. */
  now?: () => number;
};

// Messages arriving together (a catch-up, a busy room) should ding once, not ring a chord.
export const DING_DEBOUNCE_MS = 150;

// A bright, short bell: G6 and its octave, a near-instant attack, then a fade of under a second.
// Our own tone, meant to evoke a phone's ding without copying anyone's sound.
const BASE_HZ = 1568;
const PARTIALS = [
  { ratio: 1, level: 1 },
  { ratio: 2, level: 1 / 3 },
] as const;
const PEAK_GAIN = 0.25;
const ATTACK_S = 0.005;
const FADE_S = 0.9;

function defaultContext(): DingAudioContext | null {
  return typeof AudioContext === "undefined" ? null : new AudioContext();
}

export function createDing({ createContext = defaultContext, now = () => performance.now() }: DingOptions = {}): Ding {
  let context: DingAudioContext | null | undefined;
  let lastPlayed = -Infinity;

  return {
    unlock() {
      if (context === undefined) context = createContext();
      if (context?.state === "suspended") void context.resume();
    },
    play() {
      if (!context) return;
      const at = now();
      if (at - lastPlayed < DING_DEBOUNCE_MS) return;
      lastPlayed = at;

      const start = context.currentTime;
      const envelope = context.createGain();
      envelope.connect(context.destination);
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_S);
      // An exponential ramp cannot reach 0, so it fades to inaudible instead.
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + FADE_S);
      for (const { ratio, level } of PARTIALS) {
        const oscillator = context.createOscillator();
        const partial = context.createGain();
        oscillator.frequency.value = BASE_HZ * ratio;
        partial.gain.value = level;
        oscillator.connect(partial).connect(envelope);
        oscillator.start(start);
        oscillator.stop(start + FADE_S + 0.05);
      }
    },
  };
}

let shared: Ding | undefined;

/** The app's one ding: one audio context for the tab, unlocked once by the bell toggle. */
export function getDing(): Ding {
  return (shared ??= createDing());
}
