import { describe, expect, it } from "vitest";
import { createDing, DING_DEBOUNCE_MS, type DingAudioContext } from "./ding";

type Ramp = { kind: "set" | "linear" | "exponential"; value: number; time: number };

class FakeParam {
  value = 1;
  readonly ramps: Ramp[] = [];
  setValueAtTime(value: number, time: number) {
    this.ramps.push({ kind: "set", value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.ramps.push({ kind: "linear", value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.ramps.push({ kind: "exponential", value, time });
  }
}

class FakeNode {
  readonly targets: unknown[] = [];
  connect<T>(target: T): T {
    this.targets.push(target);
    return target;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  readonly frequency = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(time: number) {
    this.startedAt = time;
  }
  stop(time: number) {
    this.stoppedAt = time;
  }
}

class FakeContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 10;
  readonly destination = { name: "speakers" };
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

function setup() {
  const contexts: FakeContext[] = [];
  let now = 0;
  const ding = createDing({
    createContext: () => {
      const context = new FakeContext();
      contexts.push(context);
      return context as unknown as DingAudioContext;
    },
    now: () => now,
  });
  return { ding, contexts, advance: (ms: number) => (now += ms) };
}

describe("createDing", () => {
  it("makes no audio context until unlocked, and plays nothing before", () => {
    const { ding, contexts } = setup();
    ding.play();
    expect(contexts).toHaveLength(0);
  });

  it("resumes its one context on unlock", () => {
    const { ding, contexts } = setup();
    ding.unlock();
    ding.unlock();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.state).toBe("running");
  });

  it("plays a base tone and its octave through one envelope that rises fast and fades out", () => {
    const { ding, contexts } = setup();
    ding.unlock();
    ding.play();
    const context = contexts[0]!;

    const [envelope] = context.gains;
    expect(envelope!.targets).toEqual([context.destination]);
    const [start, peak, fade] = envelope!.gain.ramps;
    expect(start).toEqual({ kind: "set", value: 0, time: 10 });
    expect(peak!.kind).toBe("linear");
    expect(peak!.time - 10).toBeCloseTo(0.005, 4);
    expect(fade!.kind).toBe("exponential");
    expect(fade!.value).toBeLessThan(0.001);
    expect(fade!.time - 10).toBeCloseTo(0.9, 1);

    const [base, overtone] = context.oscillators.map((o) => o.frequency.value);
    expect(overtone).toBe(base! * 2);
    for (const oscillator of context.oscillators) {
      expect(oscillator.startedAt).toBe(10);
      expect(oscillator.stoppedAt).toBeGreaterThan(fade!.time);
    }
  });

  it("plays once for a burst of messages", () => {
    const { ding, contexts, advance } = setup();
    ding.unlock();
    ding.play();
    advance(DING_DEBOUNCE_MS - 1);
    ding.play();
    expect(contexts[0]!.oscillators).toHaveLength(2);

    advance(1);
    ding.play();
    expect(contexts[0]!.oscillators).toHaveLength(4);
  });

  it("plays nothing where the browser has no Web Audio", () => {
    const ding = createDing({ createContext: () => null, now: () => 0 });
    ding.unlock();
    expect(() => ding.play()).not.toThrow();
  });
});
