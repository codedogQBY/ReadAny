import { afterEach, describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "../services/platform";
import { setPlatformService } from "../services/platform";
import { requestRemoteEmbeddingBatch } from "./remote-embedding";

function createPlatform(fetchImpl: IPlatformService["fetch"]): IPlatformService {
  return {
    platformType: "desktop",
    isMobile: false,
    isDesktop: true,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeTextFile: vi.fn(),
    readTextFile: vi.fn(),
    mkdir: vi.fn(),
    exists: vi.fn(),
    deleteFile: vi.fn(),
    getAppDataDir: vi.fn(),
    getDataDir: vi.fn(),
    joinPath: vi.fn(),
    convertFileSrc: vi.fn(),
    pickFile: vi.fn(),
    loadDatabase: vi.fn(),
    fetch: fetchImpl,
    createWebSocket: vi.fn(),
    getAppVersion: vi.fn(),
    kvGetItem: vi.fn(),
    kvSetItem: vi.fn(),
    kvRemoveItem: vi.fn(),
    kvGetAllKeys: vi.fn(),
    copyToClipboard: vi.fn(),
    shareOrDownloadFile: vi.fn(),
  };
}

describe("requestRemoteEmbeddingBatch", () => {
  afterEach(() => {
    setPlatformService(null as unknown as IPlatformService);
    vi.restoreAllMocks();
  });

  it("uses the platform fetch implementation for OpenAI-compatible embeddings", async () => {
    const fetchMock = vi.fn<IPlatformService["fetch"]>(async () =>
      Response.json({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    );
    setPlatformService(createPlatform(fetchMock));

    const result = await requestRemoteEmbeddingBatch(
      {
        url: "http://localhost:11434/v1/embeddings",
        modelId: "bge-m3",
        apiKey: "ollama",
      },
      ["a", "b"],
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ollama",
        },
      }),
    );
    expect(result).toEqual({
      ok: true,
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });
  });

  it("builds Ollama /api/embed requests and omits blank authorization", async () => {
    const fetchMock = vi.fn<IPlatformService["fetch"]>(async () =>
      Response.json({
        embeddings: [[0.1, 0.2]],
      }),
    );
    setPlatformService(createPlatform(fetchMock));

    const result = await requestRemoteEmbeddingBatch(
      {
        url: "http://localhost:11434/api/embed",
        modelId: "bge-m3",
        apiKey: " ",
      },
      ["hello".repeat(10)],
      { maxCharsPerInput: 8 },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "bge-m3",
      input: ["hellohel"],
    });
    expect(result).toEqual({ ok: true, embeddings: [[0.1, 0.2]] });
  });

  it("returns status and response text for API errors", async () => {
    const fetchMock = vi.fn<IPlatformService["fetch"]>(
      async () => new Response("bad model", { status: 404 }),
    );
    setPlatformService(createPlatform(fetchMock));

    const result = await requestRemoteEmbeddingBatch(
      {
        url: "http://localhost:11434/v1/embeddings",
        modelId: "missing",
        apiKey: "",
      },
      ["test"],
    );

    expect(result).toEqual({ ok: false, status: 404, errorText: "bad model" });
  });
});
