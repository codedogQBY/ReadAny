import { describe, expect, it } from "vitest";
import type { KnowledgeSummaryDocument } from "./compact-summary";
import {
  createKnowledgeSummaryCompressionState,
  createKnowledgeSummaryCompressionStateFromDocument,
  createKnowledgeSummarySourceFingerprint,
  prepareKnowledgeSummaryCompression,
} from "./compact-summary";

function document(overrides: Partial<KnowledgeSummaryDocument> = {}): KnowledgeSummaryDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "book_home",
    title: "Reading Notes",
    contentMd: "Short note.",
    excerpt: "Short note.",
    tags: ["memory", "reading"],
    sourceKind: "book",
    sourceId: "book-1",
    updatedAt: 100,
    ...overrides,
  };
}

function longMarkdown(seed = "slow reading builds durable memory"): string {
  return Array.from(
    { length: 120 },
    (_, index) => `## Point ${index + 1}\n${seed} ${index + 1}. Evidence and reflection.`,
  ).join("\n\n");
}

describe("knowledge summary compression planning", () => {
  it("skips empty and short documents", () => {
    expect(prepareKnowledgeSummaryCompression(document({ contentMd: "" })).reason).toBe("empty");

    const short = prepareKnowledgeSummaryCompression(document(), undefined, { minSourceChars: 100 });

    expect(short).toMatchObject({
      shouldCompress: false,
      reason: "below_threshold",
      sourceChars: "Short note.".length,
    });
  });

  it("builds prompts for long documents without an existing summary", () => {
    const plan = prepareKnowledgeSummaryCompression(
      document({ contentMd: longMarkdown() }),
      undefined,
      { minSourceChars: 200, maxSourceChars: 900, maxSummaryChars: 700 },
    );

    expect(plan.shouldCompress).toBe(true);
    expect(plan.reason).toBe("missing_summary");
    expect(plan.systemPrompt).toContain("under 700 characters");
    expect(plan.userPrompt).toContain("## Document");
    expect(plan.userPrompt).toContain("Title: Reading Notes");
    expect(plan.userPrompt).toContain("## Current Document Markdown");
    expect(plan.userPrompt).toContain("[Truncated]");
  });

  it("skips documents already covered by the current compressed summary", () => {
    const sourceDocument = document({ contentMd: longMarkdown() });
    const fingerprint = createKnowledgeSummarySourceFingerprint(sourceDocument);

    const plan = prepareKnowledgeSummaryCompression(
      sourceDocument,
      { summaryMd: "- Existing summary", sourceFingerprint: fingerprint, compressedAt: 200 },
      { minSourceChars: 200 },
    );

    expect(plan).toMatchObject({
      shouldCompress: false,
      reason: "unchanged",
      sourceFingerprint: fingerprint,
    });
  });

  it("rolls an existing summary into the next compression input when content changes", () => {
    const original = document({ contentMd: longMarkdown("first version") });
    const originalPlan = prepareKnowledgeSummaryCompression(original, undefined, {
      minSourceChars: 200,
    });
    const state = createKnowledgeSummaryCompressionState("- First compressed memory", originalPlan);
    const changed = document({ contentMd: longMarkdown("second version") });

    const nextPlan = prepareKnowledgeSummaryCompression(changed, state, { minSourceChars: 200 });

    expect(nextPlan.shouldCompress).toBe(true);
    expect(nextPlan.reason).toBe("stale_summary");
    expect(nextPlan.source).toContain("## Existing Compressed Summary");
    expect(nextPlan.source).toContain("- First compressed memory");
    expect(nextPlan.sourceFingerprint).not.toBe(originalPlan.sourceFingerprint);
  });

  it("restores persisted compact summary state from a knowledge document", () => {
    expect(
      createKnowledgeSummaryCompressionStateFromDocument(
        document({
          summaryMd: "  - Existing durable memory  ",
          summarySourceFingerprint: " fnv1a32:feedface ",
          summarySourceUpdatedAt: 500,
          summaryUpdatedAt: 600,
        }),
      ),
    ).toEqual({
      summaryMd: "- Existing durable memory",
      sourceFingerprint: "fnv1a32:feedface",
      sourceUpdatedAt: 500,
      compressedAt: 600,
    });

    expect(
      createKnowledgeSummaryCompressionStateFromDocument(
        document({
          summaryMd: "- Missing fingerprint",
          summarySourceFingerprint: undefined,
        }),
      ),
    ).toBeUndefined();
  });
});
