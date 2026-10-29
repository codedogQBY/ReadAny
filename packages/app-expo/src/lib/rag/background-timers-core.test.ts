import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundAwareTimers } from "./background-timers-core";

function makeSource(initiallyActive = true) {
  let active = initiallyActive;
  const listeners = new Set<(active: boolean) => void>();
  return {
    source: {
      isActive: () => active,
      subscribe: (listener: (active: boolean) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    setActive(next: boolean) {
      active = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe("createBackgroundAwareTimers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the delay while the app is active", async () => {
    const { source } = makeSource(true);
    const { wait } = createBackgroundAwareTimers(source);
    let resolved = false;
    void wait(800).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(799);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("resolves immediately, without creating a timer, while the app is not active", async () => {
    const { source } = makeSource(false);
    const { wait, yieldToUi } = createBackgroundAwareTimers(source);

    await wait(5000);
    await yieldToUi();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a wait that is pending when the screen turns off", async () => {
    const { source, setActive } = makeSource(true);
    const { wait } = createBackgroundAwareTimers(source);
    let resolved = false;
    void wait(60_000).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    setActive(false);
    await Promise.resolve();

    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not release waits when the app becomes active", async () => {
    const { source, setActive } = makeSource(false);
    const { wait } = createBackgroundAwareTimers(source);
    setActive(true);
    let resolved = false;
    void wait(1000).then(() => {
      resolved = true;
    });

    setActive(true);
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(true);
  });

  it("lets a loop of yields run to the end with the screen off", async () => {
    const { source, setActive } = makeSource(true);
    const { yieldToUi } = createBackgroundAwareTimers(source);
    setActive(false);

    let steps = 0;
    for (let i = 0; i < 1000; i++) {
      await yieldToUi();
      steps++;
    }

    expect(steps).toBe(1000);
  });
});
