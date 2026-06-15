import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TTS_CONFIG, type TTSConfig } from "./types";

// fetchEdgeTTSAudio 始终立即 resolve，使消费循环快速抵达 decodeAndSchedule；
// 时序闸门改由下面的 decodeAudioData mock 控制。
vi.mock("./edge-tts", () => ({
  fetchEdgeTTSAudio: vi.fn(async () => new ArrayBuffer(8)),
}));

const { EdgeTTSPlayer } = await import("./tts-players");

// 每次 decodeAudioData 调用都把 resolver 收集起来，便于手动控制某个 run 的解码完成时机。
let decodeResolvers: Array<(buf: unknown) => void>;

function installAudioMock() {
  decodeResolvers = [];
  class MockAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createGain() {
      return { connect: vi.fn(), gain: { value: 1 } };
    }
    createBufferSource() {
      return { buffer: null, connect: vi.fn(), start: vi.fn() };
    }
    decodeAudioData() {
      return new Promise((resolve) => {
        decodeResolvers.push(resolve);
      });
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
}

// 反复让出微任务队列，推动被 await 暂停的消费循环前进到下一个闸门。
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const cfg: TTSConfig = { ...DEFAULT_TTS_CONFIG, engine: "edge" };

describe("EdgeTTSPlayer — per-run runId isolation (#372 reentrancy slice)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installAudioMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("被取代的旧 run 解码完成后不再触发 onChunkChange", async () => {
    const player = new EdgeTTSPlayer();
    const onChunk = vi.fn();
    player.onChunkChange = onChunk;

    // Run A：停在 decodeAudioData（resolver[0]）。
    player.speak(["a0"], cfg);
    await flush();
    expect(decodeResolvers.length).toBe(1);

    // Run B 在同一单例上取代 run A；其解码（resolver[1]）保持 pending，故 run B 不会触发 onChunkChange。
    player.speak(["b0"], cfg);
    await flush();
    expect(decodeResolvers.length).toBe(2);

    // 在 run A 已被取代之后，才让它的解码完成。
    decodeResolvers[0]({ duration: 1 });
    await flush();

    // 旧 run 必须完全失活——不得有进度回调泄漏。
    expect(onChunk).not.toHaveBeenCalled();
  });
});
