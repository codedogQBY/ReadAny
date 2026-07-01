import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSummaryDocument } from "../../knowledge";
import type { AIConfig } from "../../types";

const llmMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createChatModel: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({
  getKnowledgeDocument: vi.fn(),
  updateKnowledgeDocumentSummary: vi.fn(),
}));

vi.mock("../llm-provider", () => ({
  createChatModel: llmMocks.createChatModel,
}));
vi.mock("../../db/database", () => dbMocks);

const {
  maybeCompressAndPersistKnowledgeSummary,
  maybeCompressKnowledgeDocumentsById,
  maybeCompressKnowledgeSummary,
} = await import("../knowledge-memory");

function aiConfig(): AIConfig {
  return {
    endpoints: [
      {
        id: "endpoint-1",
        name: "Test",
        provider: "custom",
        apiKey: "test-key",
        baseUrl: "https://example.com/v1",
        models: ["test-model"],
        modelsFetched: true,
      },
    ],
    activeEndpointId: "endpoint-1",
    activeModel: "test-model",
    temperature: 0.7,
    maxTokens: 4096,
    slidingWindowSize: 8,
  };
}

function document(overrides: Partial<KnowledgeSummaryDocument> = {}): KnowledgeSummaryDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "book_home",
    title: "Book Home",
    contentMd: "Short.",
    excerpt: "Short.",
    tags: ["reading"],
    sourceKind: "book",
    sourceId: "book-1",
    updatedAt: 100,
    ...overrides,
  };
}

function longMarkdown(): string {
  return Array.from(
    { length: 90 },
    (_, index) => `## Idea ${index + 1}\nReading note ${index + 1} with enough evidence.`,
  ).join("\n\n");
}

describe("knowledge memory compression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    llmMocks.createChatModel.mockResolvedValue({ invoke: llmMocks.invoke });
    llmMocks.invoke.mockResolvedValue({ content: "## Durable memory\n- Keep this idea." });
    dbMocks.updateKnowledgeDocumentSummary.mockResolvedValue(undefined);
  });

  it("skips short documents without calling the model", async () => {
    const result = await maybeCompressKnowledgeSummary(document(), aiConfig(), undefined, {
      minSourceChars: 100,
    });

    expect(result.status).toBe("skipped");
    expect(result.plan.reason).toBe("below_threshold");
    expect(llmMocks.createChatModel).not.toHaveBeenCalled();
  });

  it("compresses long documents into a state tied to the source fingerprint", async () => {
    const result = await maybeCompressKnowledgeSummary(
      document({ contentMd: longMarkdown(), updatedAt: 200 }),
      aiConfig(),
      undefined,
      { minSourceChars: 200, maxSummaryChars: 80 },
    );

    expect(result.status).toBe("compressed");
    expect(result.summaryMd).toBe("## Durable memory\n- Keep this idea.");
    expect(result.state).toMatchObject({
      summaryMd: "## Durable memory\n- Keep this idea.",
      sourceFingerprint: result.plan.sourceFingerprint,
      sourceUpdatedAt: 200,
    });
    expect(llmMocks.createChatModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ temperature: 0.2, streaming: false }),
    );
    expect(llmMocks.invoke).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Object)]));
  });

  it("returns failed status instead of throwing when the model fails", async () => {
    llmMocks.invoke.mockRejectedValue(new Error("model offline"));

    const result = await maybeCompressKnowledgeSummary(
      document({ contentMd: longMarkdown() }),
      aiConfig(),
      undefined,
      { minSourceChars: 200 },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBe("model offline");
    expect(result.plan.shouldCompress).toBe(true);
  });

  it("persists compressed summaries for long documents", async () => {
    const result = await maybeCompressAndPersistKnowledgeSummary(
      document({ contentMd: longMarkdown(), updatedAt: 200 }),
      aiConfig(),
      { minSourceChars: 200 },
    );

    expect(result.status).toBe("compressed");
    expect(result.persisted).toBe(true);
    expect(dbMocks.updateKnowledgeDocumentSummary).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({
        summaryMd: "## Durable memory\n- Keep this idea.",
        sourceFingerprint: result.plan.sourceFingerprint,
        sourceUpdatedAt: 200,
      }),
    );
  });

  it("uses persisted summary state to skip unchanged documents", async () => {
    const source = document({ contentMd: longMarkdown(), updatedAt: 200 });
    const first = await maybeCompressAndPersistKnowledgeSummary(source, aiConfig(), {
      minSourceChars: 200,
    });
    vi.clearAllMocks();

    const result = await maybeCompressAndPersistKnowledgeSummary(
      document({
        ...source,
        summaryMd: first.summaryMd,
        summarySourceFingerprint: first.plan.sourceFingerprint,
        summarySourceUpdatedAt: 200,
        summaryUpdatedAt: 300,
      }),
      aiConfig(),
      { minSourceChars: 200 },
    );

    expect(result.status).toBe("skipped");
    expect(result.plan.reason).toBe("unchanged");
    expect(result.persisted).toBe(false);
    expect(llmMocks.createChatModel).not.toHaveBeenCalled();
    expect(dbMocks.updateKnowledgeDocumentSummary).not.toHaveBeenCalled();
  });

  it("returns failed status when persisting the compressed summary fails", async () => {
    dbMocks.updateKnowledgeDocumentSummary.mockRejectedValue(new Error("database locked"));

    const result = await maybeCompressAndPersistKnowledgeSummary(
      document({ contentMd: longMarkdown() }),
      aiConfig(),
      { minSourceChars: 200 },
    );

    expect(result.status).toBe("failed");
    expect(result.persisted).toBe(false);
    expect(result.error).toBe("database locked");
  });

  it("maintains summaries for unique document ids", async () => {
    dbMocks.getKnowledgeDocument.mockImplementation(async (id: string) =>
      id === "doc-1" ? document({ id, contentMd: longMarkdown(), updatedAt: 200 }) : null,
    );

    const results = await maybeCompressKnowledgeDocumentsById(
      ["doc-1", "doc-1", "", "missing"],
      aiConfig(),
      { minSourceChars: 200 },
    );

    expect(results).toEqual([
      expect.objectContaining({
        documentId: "doc-1",
        status: "compressed",
        persisted: true,
        reason: "missing_summary",
      }),
      expect.objectContaining({
        documentId: "missing",
        status: "missing",
        persisted: false,
      }),
    ]);
    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledTimes(2);
    expect(dbMocks.updateKnowledgeDocumentSummary).toHaveBeenCalledTimes(1);
  });

  it("continues maintaining later documents when one lookup fails", async () => {
    dbMocks.getKnowledgeDocument.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("database busy");
      return document({ id, contentMd: "Short." });
    });

    const results = await maybeCompressKnowledgeDocumentsById(["bad", "doc-2"], aiConfig(), {
      minSourceChars: 200,
    });

    expect(results).toEqual([
      expect.objectContaining({
        documentId: "bad",
        status: "failed",
        persisted: false,
        error: "database busy",
      }),
      expect.objectContaining({
        documentId: "doc-2",
        status: "skipped",
        persisted: false,
        reason: "below_threshold",
      }),
    ]);
  });
});
