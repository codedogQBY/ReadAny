import { describe, expect, it, vi } from "vitest";
import { LegacyPlayerProvider, TTSCoordinator } from "./coordinator";
import { DEFAULT_TTS_CONFIG, type ITTSPlayer } from "./types";

function fakePlayer() {
  let end: (() => void) | undefined;
  const player: ITTSPlayer = {
    speak: vi.fn(async () => undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    set onEnd(value: (() => void) | undefined) {
      end = value;
    },
    get onEnd() {
      return end;
    },
  };
  return { player, finish: () => end?.() };
}

describe("TTSCoordinator", () => {
  it("transitions through loading and advances segments", async () => {
    const fake = fakePlayer();
    const states: string[] = [];
    const coordinator = new TTSCoordinator(DEFAULT_TTS_CONFIG, undefined, {
      onStateChange: (s) => states.push(s.status),
    });
    coordinator.play(["one", "two"], new LegacyPlayerProvider(fake.player, "system"));
    expect(coordinator.getState().status).toBe("loading");
    fake.player.onStateChange?.("playing");
    expect(coordinator.getState().status).toBe("playing");
    fake.finish();
    expect((fake.player.speak as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(states).toContain("loading");
  });

  it("ignores callbacks from a cancelled session", () => {
    const first = fakePlayer();
    const second = fakePlayer();
    const coordinator = new TTSCoordinator(DEFAULT_TTS_CONFIG);
    coordinator.play("first", new LegacyPlayerProvider(first.player, "system"));
    coordinator.play("second", new LegacyPlayerProvider(second.player, "system"));
    first.finish();
    expect((second.player.speak as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
