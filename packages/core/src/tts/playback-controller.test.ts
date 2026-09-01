import { describe, expect, it, vi } from "vitest";
import { TTSPlaybackController } from "./playback-controller";
import type { ITTSPlayer, TTSConfig } from "./types";

const config = { engine: "edge", rate: 1, pitch: 1 } as TTSConfig;

function makePlayer() {
  const player: ITTSPlayer = {
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
  return player;
}

describe("TTSPlaybackController", () => {
  it("owns queue progress and ignores callbacks from a stopped generation", () => {
    const player = makePlayer();
    const onSegmentChange = vi.fn();
    const controller = new TTSPlaybackController(() => player, { onSegmentChange });

    expect(controller.play(["one", "two"], config)).toBe(true);
    player.onChunkChange?.(1, 2);
    expect(controller.snapshot().currentIndex).toBe(1);
    expect(onSegmentChange).toHaveBeenLastCalledWith(1, 2, "two");

    const staleEnd = player.onEnd;
    controller.stop();
    staleEnd?.();
    expect(controller.snapshot().state).toBe("stopped");
    expect(onSegmentChange).toHaveBeenCalledTimes(1);
  });

  it("jumps without changing the absolute queue index", () => {
    const player = makePlayer();
    const controller = new TTSPlaybackController(() => player);
    controller.play(["one", "two", "three"], config);
    expect(controller.jumpTo(2, config)).toBe(true);
    expect(player.speak).toHaveBeenLastCalledWith(["three"], config);
    expect(controller.snapshot().currentIndex).toBe(2);
  });

  it("appends only through a player that supports queue extension", () => {
    const player = makePlayer();
    player.append = vi.fn();
    const controller = new TTSPlaybackController(() => player);
    controller.play("one. two.", config);
    expect(controller.append(["three"])).toBe(true);
    expect(player.append).toHaveBeenCalledWith(["three"]);
    expect(controller.snapshot().segments).toEqual(["one.", "two.", "three"]);
  });

  it("preloads without replacing the active queue", () => {
    const player = makePlayer();
    const preload = vi.fn();
    const controller = new TTSPlaybackController(() => player, {}, preload);
    controller.play(["current"], config);

    expect(controller.preload(["next one", "next two"], config)).toBe(true);
    expect(preload).toHaveBeenCalledWith(["next one", "next two"], config);
    expect(controller.snapshot().segments).toEqual(["current"]);
  });

  it("reports player construction failures without throwing from play", () => {
    const error = new Error("provider unavailable");
    const onError = vi.fn();
    const controller = new TTSPlaybackController(
      () => {
        throw error;
      },
      { onError },
    );

    expect(controller.play("one", config)).toBe(true);
    expect(controller.snapshot().state).toBe("stopped");
    expect(onError).toHaveBeenCalledWith(error);
  });
});
