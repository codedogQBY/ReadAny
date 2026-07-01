import { describe, expect, it } from "vitest";
import type { JSONValue } from "../types";
import {
  createCustomReadAnyCardTemplate,
  createDefaultReadAnyCardAttrs,
  createReadAnyCardAttrsFromTemplate,
  createReadAnyCardReadOnlyModel,
  createReadAnyCardTemplateFieldDefaults,
  formatReadAnyCardDataForEditor,
  getReadAnyCardDefinition,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateFieldGroups,
  getReadAnyCardTemplateFields,
  getReadAnyCardTemplateInsertLabel,
  getVisibleReadAnyCardTemplateFields,
  isReadAnyCardTemplateFieldVisible,
  isReadAnyCardTemplateRequiredValueMissing,
  normalizeReadAnyCardAttrs,
  normalizeReadAnyCardTemplateFields,
  parseReadAnyCardDataFromEditor,
  renderReadAnyCardMarkdownFallback,
  renderReadAnyCardStructuredFieldsMarkdown,
  updateCustomReadAnyCardTemplate,
  upgradeReadAnyCardAttrs,
  upgradeReadAnyCardAttrsWithTemplates,
} from "./card-registry";

describe("ReadAny card registry", () => {
  it("creates exportable default attrs for built-in cards", () => {
    expect(createDefaultReadAnyCardAttrs("callout", { title: "Idea" })).toEqual({
      cardType: "callout",
      version: 1,
      title: "Idea",
      markdown: "",
    });

    expect(createDefaultReadAnyCardAttrs("qa", { title: "Question" })).toMatchObject({
      cardType: "qa",
      title: "Question",
      markdown: "Q:\nA:",
    });

    expect(createDefaultReadAnyCardAttrs("mindmap")).toMatchObject({
      cardType: "mindmap",
      title: getReadAnyCardDefinition("mindmap")?.insertLabel,
      markdown: "# Topic\n## Branch",
    });

    expect(createDefaultReadAnyCardAttrs("aiToolFailure")).toMatchObject({
      cardType: "aiToolFailure",
      title: getReadAnyCardDefinition("aiToolFailure")?.insertLabel,
      markdown: "Tool:\nError:\nReason:",
    });
  });

  it("keeps unknown cards readable with ReadAny metadata in the fallback", () => {
    const model = createReadAnyCardReadOnlyModel({
      cardType: "customMetric",
      version: 3,
      title: "Reading score",
      text: "Focus: 92%",
      sourceTitle: "Chapter 4",
      cfi: "epubcfi(/6/4)",
    });

    expect(model).toMatchObject({
      cardType: "customMetric",
      version: 3,
      title: "Reading score",
      body: "Focus: 92%",
      state: "unsupported",
      stateLabel: "fallback",
      isFallback: true,
      isFutureVersion: false,
      isCustomCard: false,
      isKnownBuiltIn: false,
      sourceTitle: "Chapter 4",
      cfi: "epubcfi(/6/4)",
    });
    expect(model.metadata).toEqual([
      { key: "cardType", label: "Card", value: "customMetric" },
      { key: "version", label: "Version", value: "v3" },
      { key: "source", label: "Source", value: "Chapter 4" },
      { key: "cfi", label: "CFI", value: "epubcfi(/6/4)" },
    ]);

    expect(
      renderReadAnyCardMarkdownFallback(
        {
          cardType: "customMetric",
          version: 3,
          title: "Reading score",
          text: "Focus: 92%",
          sourceTitle: "Chapter 4",
          cfi: "epubcfi(/6/4)",
        },
        { body: "" },
      ),
    ).toBe(
      [
        "> [!note] Reading score",
        "> Focus: 92%",
        "> ReadAny card: customMetric v3",
        "> Source: Chapter 4",
        "> CFI: epubcfi(/6/4)",
      ].join("\n"),
    );
  });

  it("does not silently pretend future built-in card versions are fully supported", () => {
    expect(
      createReadAnyCardReadOnlyModel({
        cardType: "aiSummary",
        version: 99,
        title: "Future summary",
        markdown: "Readable fallback body.",
      }),
    ).toMatchObject({
      cardType: "aiSummary",
      version: 99,
      title: "Future summary",
      body: "Readable fallback body.",
      state: "future",
      stateLabel: "v99 newer",
      isFallback: true,
      isFutureVersion: true,
      isCustomCard: false,
      isKnownBuiltIn: true,
    });

    expect(
      renderReadAnyCardMarkdownFallback(
        {
          cardType: "aiSummary",
          version: 99,
          title: "Future summary",
          markdown: "Readable fallback body.",
        },
        { body: "" },
      ),
    ).toBe(
      [
        "> [!note] Future summary",
        "> Readable fallback body.",
        "> ReadAny card: aiSummary v99",
      ].join("\n"),
    );
  });

  it("normalizes legacy card aliases and unsafe versions", () => {
    expect(
      normalizeReadAnyCardAttrs({
        type: "legacyTimeline",
        version: "3",
        title: "Reading timeline",
        source: "highlight-1",
        "source-title": "Chapter 2",
        markdown: "A -> B",
      }),
    ).toEqual({
      cardType: "legacyTimeline",
      version: 3,
      title: "Reading timeline",
      sourceId: "highlight-1",
      sourceTitle: "Chapter 2",
      markdown: "A -> B",
    });

    expect(normalizeReadAnyCardAttrs({ cardType: "callout", version: 0 })).toEqual({
      cardType: "callout",
      version: 1,
    });
  });

  it("upgrades legacy built-in card payloads before rendering or editing", () => {
    expect(
      upgradeReadAnyCardAttrs({
        cardType: "bookQuote",
        data: {
          quote: "Reading is thinking.",
          chapterTitle: "Chapter 1",
          highlightId: "hl-1",
          rangeCfi: "epubcfi(/6/2)",
        },
      }),
    ).toEqual({
      cardType: "bookQuote",
      version: 1,
      markdown: "Reading is thinking.",
      text: "Reading is thinking.",
      sourceTitle: "Chapter 1",
      sourceId: "hl-1",
      cfi: "epubcfi(/6/2)",
      data: {
        quote: "Reading is thinking.",
        chapterTitle: "Chapter 1",
        highlightId: "hl-1",
        rangeCfi: "epubcfi(/6/2)",
      },
    });

    expect(
      normalizeReadAnyCardAttrs({
        cardType: "qa",
        data: {
          question: "What changed?",
          answer: "The card can migrate itself.",
        },
      }),
    ).toMatchObject({
      cardType: "qa",
      version: 1,
      markdown: "Q: What changed?\nA: The card can migrate itself.",
      text: "Q: What changed?\nA: The card can migrate itself.",
    });
  });

  it("keeps AI/tool failure cards visible and exportable", () => {
    const attrs = normalizeReadAnyCardAttrs({
      cardType: "aiToolFailure",
      data: {
        toolName: "searchKnowledgeBase",
        status: "failed",
        error: "Knowledge index unavailable",
        reason: "missing_index",
        documentId: "doc-1",
      },
    });

    expect(attrs).toEqual({
      cardType: "aiToolFailure",
      version: 1,
      title: "searchKnowledgeBase",
      markdown:
        "Tool: searchKnowledgeBase\nStatus: failed\nError: Knowledge index unavailable\nReason: missing_index\nDocument: doc-1",
      text: "Tool: searchKnowledgeBase\nStatus: failed\nError: Knowledge index unavailable\nReason: missing_index\nDocument: doc-1",
      sourceId: "doc-1",
      data: {
        toolName: "searchKnowledgeBase",
        status: "failed",
        error: "Knowledge index unavailable",
        reason: "missing_index",
        documentId: "doc-1",
      },
    });

    expect(renderReadAnyCardMarkdownFallback(attrs, { body: "" })).toBe(
      [
        "> [!failure] searchKnowledgeBase",
        "> Tool: searchKnowledgeBase",
        "> Status: failed",
        "> Error: Knowledge index unavailable",
        "> Reason: missing_index",
        "> Document: doc-1",
      ].join("\n"),
    );
  });

  it("creates insertable attrs from synced card templates", () => {
    const template = {
      id: "template-concept",
      name: "Concept Card",
      version: 2,
      schemaJson: {
        cardType: "concept",
        insertLabel: "Concept",
        description: "Capture a reusable concept.",
        title: "New concept",
        markdown: "Definition:\nEvidence:",
        attrs: {
          data: { kind: "concept" },
        },
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(getReadAnyCardTemplateInsertLabel(template)).toBe("Concept");
    expect(getReadAnyCardTemplateDescription(template)).toBe("Capture a reusable concept.");
    expect(createReadAnyCardAttrsFromTemplate(template)).toEqual({
      cardType: "concept",
      version: 2,
      title: "New concept",
      markdown: "Definition:\nEvidence:",
      data: { kind: "concept" },
    });
  });

  it("creates synced custom card templates for user-authored structures", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-reading-question",
      name: "Reading Question",
      description: "Track a question and answer.",
      markdown: "Question:\nAnswer:",
      now: 123,
    });

    expect(template).toEqual({
      id: "template-reading-question",
      name: "Reading Question",
      version: 1,
      schemaJson: {
        cardType: "custom:template-reading-question",
        insertLabel: "Reading Question",
        description: "Track a question and answer.",
        title: "Reading Question",
        markdown: "Question:\nAnswer:",
      },
      builtIn: false,
      enabled: true,
      createdAt: 123,
      updatedAt: 123,
    });
    expect(createReadAnyCardAttrsFromTemplate(template)).toEqual({
      cardType: "custom:template-reading-question",
      version: 1,
      title: "Reading Question",
      markdown: "Question:\nAnswer:",
    });

    expect(
      createReadAnyCardReadOnlyModel(
        {
          cardType: "custom:template-reading-question",
          version: 1,
        },
        {
          body: "",
          cardTemplates: [template],
        },
      ),
    ).toMatchObject({
      cardType: "custom:template-reading-question",
      version: 1,
      title: "Reading Question",
      body: "Question:\nAnswer:",
      state: "custom",
      stateLabel: "v1",
      insertLabel: "Reading Question",
      isFallback: false,
      isCustomCard: true,
    });
  });

  it("normalizes visual custom card fields and creates data defaults", () => {
    const fields = normalizeReadAnyCardTemplateFields([
      {
        label: "Core Idea",
        type: "text",
        group: "Core",
        width: "wide",
        placeholder: "What changed?",
        defaultValue: "Untitled idea",
      },
      {
        key: "core idea",
        label: "Duplicate label",
        type: "multiline",
        section: "Evidence",
        layout: { width: "1/2" },
        visibleWhen: { fieldKey: "Reviewed", operator: "equals", value: true },
        defaultValue: "Evidence:",
      },
      {
        label: "Confidence",
        type: "number",
        groupLabel: "Scoring",
        span: 4,
        defaultValue: "0.8",
      },
      {
        label: "Reviewed",
        type: "checkbox",
        defaultValue: "true",
      },
      {
        label: "Priority",
        type: "select",
        helpText: "Pick one urgency level.",
        required: true,
        options: ["High", { label: "Low", value: "low" }],
        defaultValue: "Low",
      },
      {
        label: "Themes",
        type: "multiselect",
        options: [
          { label: "Identity", value: "identity" },
          { label: "Power", value: "power" },
        ],
        defaultValue: ["identity", "Power"],
      },
      {
        label: "Ignored",
        type: "unsupported",
        defaultValue: { nested: true },
      },
    ]);

    expect(fields).toEqual([
      {
        key: "core_idea",
        label: "Core Idea",
        type: "text",
        group: "Core",
        width: "full",
        placeholder: "What changed?",
        defaultValue: "Untitled idea",
      },
      {
        key: "core_idea_2",
        label: "Duplicate label",
        type: "multiline",
        group: "Evidence",
        width: "half",
        visibleWhen: { fieldKey: "reviewed", operator: "equals", value: true },
        defaultValue: "Evidence:",
      },
      {
        key: "confidence",
        label: "Confidence",
        type: "number",
        group: "Scoring",
        width: "third",
        defaultValue: 0.8,
      },
      {
        key: "reviewed",
        label: "Reviewed",
        type: "checkbox",
        defaultValue: true,
      },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        helpText: "Pick one urgency level.",
        required: true,
        options: [
          { label: "High", value: "High" },
          { label: "Low", value: "low" },
        ],
        defaultValue: "low",
      },
      {
        key: "themes",
        label: "Themes",
        type: "multiselect",
        options: [
          { label: "Identity", value: "identity" },
          { label: "Power", value: "power" },
        ],
        defaultValue: ["identity", "power"],
      },
      {
        key: "ignored",
        label: "Ignored",
        type: "text",
      },
    ]);
    expect(createReadAnyCardTemplateFieldDefaults(fields)).toEqual({
      core_idea: "Untitled idea",
      core_idea_2: "Evidence:",
      confidence: 0.8,
      reviewed: true,
      priority: "low",
      themes: ["identity", "power"],
    });
  });

  it("evaluates conditional custom card field visibility", () => {
    const fields = normalizeReadAnyCardTemplateFields([
      { key: "has evidence", label: "Has evidence", type: "checkbox", defaultValue: false },
      {
        key: "evidence",
        label: "Evidence",
        type: "multiline",
        visibleWhen: { fieldKey: "has evidence", operator: "equals", value: true },
      },
      {
        key: "themes",
        label: "Themes",
        type: "multiselect",
        options: [
          { label: "Ritual", value: "ritual" },
          { label: "Power", value: "power" },
        ],
      },
      {
        key: "ritual note",
        label: "Ritual note",
        type: "text",
        visibleWhen: { fieldKey: "themes", operator: "contains", value: "ritual" },
      },
    ]);

    expect(fields[1].visibleWhen).toEqual({
      fieldKey: "has_evidence",
      operator: "equals",
      value: true,
    });
    expect(
      isReadAnyCardTemplateFieldVisible(fields[1], {
        has_evidence: false,
      }),
    ).toBe(false);
    expect(
      isReadAnyCardTemplateFieldVisible(fields[1], {
        has_evidence: true,
      }),
    ).toBe(true);
    expect(
      isReadAnyCardTemplateFieldVisible(fields[3], {
        themes: ["ritual", "power"],
      }),
    ).toBe(true);
    expect(
      isReadAnyCardTemplateFieldVisible(fields[3], {
        themes: ["power"],
      }),
    ).toBe(false);

    const template = createCustomReadAnyCardTemplate({
      id: "template-conditional",
      name: "Conditional",
      fields,
      now: 123,
    });

    expect(
      getVisibleReadAnyCardTemplateFields(template, {
        has_evidence: false,
        themes: ["power"],
      }).map((field) => field.key),
    ).toEqual(["has_evidence", "themes"]);
    expect(
      getVisibleReadAnyCardTemplateFields(template, {
        has_evidence: true,
        themes: ["ritual"],
      }).map((field) => field.key),
    ).toEqual(["has_evidence", "evidence", "themes", "ritual_note"]);
  });

  it("applies custom card group visibility before field visibility", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-grouped-claim",
      name: "Grouped Claim",
      fields: [
        { key: "has_evidence", label: "Has evidence", type: "checkbox", defaultValue: false },
        {
          key: "quote",
          label: "Quote",
          type: "multiline",
          group: "Evidence",
          groupVisibleWhen: { fieldKey: "has evidence", operator: "equals", value: true },
        },
        {
          key: "commentary",
          label: "Commentary",
          type: "text",
          group: "Evidence",
          visibleWhen: { fieldKey: "quote", operator: "notEmpty" },
        },
        { key: "summary", label: "Summary", type: "text", group: "Core" },
      ],
      now: 123,
    });

    expect(template.schemaJson).toMatchObject({
      fields: [
        { key: "has_evidence", label: "Has evidence", type: "checkbox", defaultValue: false },
        { key: "quote", label: "Quote", type: "multiline", group: "Evidence" },
        {
          key: "commentary",
          label: "Commentary",
          type: "text",
          group: "Evidence",
          visibleWhen: { fieldKey: "quote", operator: "notEmpty" },
        },
        { key: "summary", label: "Summary", type: "text", group: "Core" },
      ],
      groups: [
        {
          key: "evidence",
          label: "Evidence",
          visibleWhen: { fieldKey: "has_evidence", operator: "equals", value: true },
        },
      ],
    });
    expect(getReadAnyCardTemplateFieldGroups(template)).toEqual([
      {
        key: "evidence",
        label: "Evidence",
        visibleWhen: { fieldKey: "has_evidence", operator: "equals", value: true },
      },
      { key: "core", label: "Core" },
    ]);
    expect(getReadAnyCardTemplateFields(template)[1].groupVisibleWhen).toEqual({
      fieldKey: "has_evidence",
      operator: "equals",
      value: true,
    });

    expect(
      getVisibleReadAnyCardTemplateFields(template, {
        has_evidence: false,
        quote: "Hidden quote",
        commentary: "Hidden commentary",
      }).map((field) => field.key),
    ).toEqual(["has_evidence", "summary"]);
    expect(
      getVisibleReadAnyCardTemplateFields(template, {
        has_evidence: true,
        quote: "",
        summary: "Visible",
      }).map((field) => field.key),
    ).toEqual(["has_evidence", "quote", "summary"]);

    const hiddenModel = createReadAnyCardReadOnlyModel(
      {
        cardType: "custom:template-grouped-claim",
        data: {
          has_evidence: false,
          quote: "Hidden quote",
          commentary: "Hidden commentary",
          summary: "Visible summary",
        },
      },
      { body: "", cardTemplates: [template] },
    );
    expect(hiddenModel.structuredFields.map((field) => field.key)).toEqual([
      "has_evidence",
      "summary",
    ]);
    expect(renderReadAnyCardStructuredFieldsMarkdown(hiddenModel.structuredFields)).not.toContain(
      "Hidden quote",
    );
  });

  it("matches imported custom card groups by label when explicit group keys differ", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-imported-claim",
      name: "Imported Claim",
      fields: [
        { key: "has_evidence", label: "Has evidence", type: "checkbox", defaultValue: false },
        { key: "quote", label: "Quote", type: "multiline", group: "Evidence" },
        { key: "summary", label: "Summary", type: "text", group: "Core" },
      ],
      now: 123,
    });
    const importedTemplate = {
      ...template,
      schemaJson: {
        ...(template.schemaJson as Record<string, unknown>),
        groups: [
          {
            key: "ev",
            label: "Evidence",
            visibleWhen: { fieldKey: "has evidence", operator: "equals", value: true },
          },
        ],
      },
    };

    expect(getReadAnyCardTemplateFieldGroups(importedTemplate)).toEqual([
      {
        key: "evidence",
        label: "Evidence",
        visibleWhen: { fieldKey: "has_evidence", operator: "equals", value: true },
      },
      { key: "core", label: "Core" },
    ]);
    expect(getReadAnyCardTemplateFields(importedTemplate)[1].groupVisibleWhen).toEqual({
      fieldKey: "has_evidence",
      operator: "equals",
      value: true,
    });
    expect(
      getVisibleReadAnyCardTemplateFields(importedTemplate, {
        has_evidence: false,
        quote: "Should be hidden",
        summary: "Visible",
      }).map((field) => field.key),
    ).toEqual(["has_evidence", "summary"]);

    const hiddenModel = createReadAnyCardReadOnlyModel(
      {
        cardType: "custom:template-imported-claim",
        data: {
          has_evidence: false,
          quote: "Should be hidden",
          summary: "Visible",
        },
      },
      { body: "", cardTemplates: [importedTemplate] },
    );
    expect(renderReadAnyCardStructuredFieldsMarkdown(hiddenModel.structuredFields)).not.toContain(
      "Should be hidden",
    );
  });

  it("stores visual custom card fields in synced templates and insert attrs", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-concept",
      name: "Concept",
      description: "Track a concept with evidence.",
      markdown: "Definition:\nEvidence:",
      fields: [
        { key: "term", label: "Term", type: "text", defaultValue: "New concept" },
        { key: "evidence", label: "Evidence", type: "multiline" },
        { key: "confidence", label: "Confidence", type: "number", defaultValue: 1 },
      ],
      now: 123,
    });

    expect(template.schemaJson).toMatchObject({
      fields: [
        { key: "term", label: "Term", type: "text", defaultValue: "New concept" },
        { key: "evidence", label: "Evidence", type: "multiline" },
        { key: "confidence", label: "Confidence", type: "number", defaultValue: 1 },
      ],
      attrs: {
        data: {
          term: "New concept",
          confidence: 1,
        },
      },
    });
    expect(createReadAnyCardAttrsFromTemplate(template)).toEqual({
      cardType: "custom:template-concept",
      version: 1,
      title: "Concept",
      markdown: "Definition:\nEvidence:",
      data: {
        term: "New concept",
        confidence: 1,
      },
    });
  });

  it("keeps structured custom card fields readable in fallback Markdown", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-concept",
      name: "Concept",
      markdown: "Definition:",
      fields: [
        { key: "term", label: "Term", type: "text" },
        { key: "evidence", label: "Evidence", type: "multiline" },
        { key: "confidence", label: "Confidence", type: "number" },
        { key: "reviewed", label: "Reviewed", type: "checkbox" },
        {
          key: "priority",
          label: "Priority",
          type: "select",
          options: [
            { label: "High", value: "high" },
            { label: "Low", value: "low" },
          ],
        },
        {
          key: "themes",
          label: "Themes",
          type: "multiselect",
          options: [
            { label: "Attention", value: "attention" },
            { label: "Ritual", value: "ritual" },
          ],
        },
        {
          key: "private",
          label: "Private note",
          type: "text",
          visibleWhen: { fieldKey: "priority", operator: "equals", value: "low" },
        },
      ],
      now: 123,
    });
    const model = createReadAnyCardReadOnlyModel(
      {
        cardType: "custom:template-concept",
        version: 1,
        title: "Attention",
        markdown: "Definition: directed perception",
        data: {
          term: "Attention",
          evidence: "Repeated ritual practice\nShared reading notes",
          confidence: 0.92,
          reviewed: false,
          priority: "high",
          themes: ["attention", "ritual"],
          private: "Should stay hidden",
        },
      },
      { body: "", cardTemplates: [template] },
    );

    expect(model.structuredFields).toEqual([
      { key: "term", label: "Term", value: "Attention" },
      {
        key: "evidence",
        label: "Evidence",
        value: "Repeated ritual practice\nShared reading notes",
      },
      { key: "confidence", label: "Confidence", value: "0.92" },
      { key: "reviewed", label: "Reviewed", value: "No" },
      { key: "priority", label: "Priority", value: "High" },
      { key: "themes", label: "Themes", value: "Attention, Ritual" },
    ]);
    expect(model.structuredFields.map((field) => field.key)).not.toContain("private");
    expect(renderReadAnyCardStructuredFieldsMarkdown(model.structuredFields)).toBe(
      [
        "Fields:",
        "- Term: Attention",
        "- Evidence: Repeated ritual practice",
        "  Shared reading notes",
        "- Confidence: 0.92",
        "- Reviewed: No",
        "- Priority: High",
        "- Themes: Attention, Ritual",
      ].join("\n"),
    );
    const fallbackMarkdown = renderReadAnyCardMarkdownFallback(
      {
        cardType: "custom:template-concept",
        version: 1,
        title: "Attention",
        markdown: "Definition: directed perception",
        data: {
          term: "Attention",
          evidence: "Repeated ritual practice\nShared reading notes",
          confidence: 0.92,
          reviewed: false,
          priority: "high",
          themes: ["attention", "ritual"],
          private: "Should stay hidden",
        },
      },
      { body: "", cardTemplates: [template] },
    );
    expect(fallbackMarkdown).toContain("> - Confidence: 0.92");
    expect(fallbackMarkdown).not.toContain("Should stay hidden");
  });

  it("keeps grouped custom card fields readable in models and Markdown", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-reading-claim",
      name: "Reading Claim",
      markdown: "Claim:",
      fields: [
        { key: "claim", label: "Claim", type: "text", group: "Core", width: "full" },
        { key: "confidence", label: "Confidence", type: "number", group: "Core", width: "third" },
        { key: "evidence", label: "Evidence", type: "multiline", group: "Evidence", width: "half" },
        { key: "reviewed", label: "Reviewed", type: "checkbox" },
      ],
      now: 123,
    });
    const model = createReadAnyCardReadOnlyModel(
      {
        cardType: "custom:template-reading-claim",
        version: 1,
        title: "Attention",
        markdown: "Claim: attention is trained",
        data: {
          claim: "Attention is trained.",
          confidence: 0.82,
          evidence: "Chapter 2 example\nChapter 4 contrast",
          reviewed: true,
        },
      },
      { body: "", cardTemplates: [template] },
    );

    expect(model.structuredFields).toEqual([
      {
        key: "claim",
        label: "Claim",
        value: "Attention is trained.",
        group: "Core",
        width: "full",
      },
      { key: "confidence", label: "Confidence", value: "0.82", group: "Core", width: "third" },
      {
        key: "evidence",
        label: "Evidence",
        value: "Chapter 2 example\nChapter 4 contrast",
        group: "Evidence",
        width: "half",
      },
      { key: "reviewed", label: "Reviewed", value: "Yes" },
    ]);
    expect(renderReadAnyCardStructuredFieldsMarkdown(model.structuredFields)).toBe(
      [
        "Fields:",
        "Core:",
        "  - Claim: Attention is trained.",
        "  - Confidence: 0.82",
        "Evidence:",
        "  - Evidence: Chapter 2 example",
        "    Chapter 4 contrast",
        "- Reviewed: Yes",
      ].join("\n"),
    );
  });

  it("keeps disabled custom card templates usable for existing card rendering", () => {
    const template = {
      ...createCustomReadAnyCardTemplate({
        id: "template-archive",
        name: "Archived Prompt",
        fields: [
          { key: "question", label: "Question", type: "text" },
          { key: "answer", label: "Answer", type: "multiline" },
        ],
        now: 123,
      }),
      enabled: false,
    };

    const model = createReadAnyCardReadOnlyModel(
      {
        cardType: "custom:template-archive",
        version: 1,
        title: "Old prompt",
        markdown: "Archived prompt body.",
        data: {
          question: "What survived sync?",
          answer: "The old card still has field labels.",
        },
      },
      { body: "", cardTemplates: [template] },
    );

    expect(model).toMatchObject({
      state: "custom",
      isCustomCard: true,
      insertLabel: "Archived Prompt",
    });
    expect(model.structuredFields).toEqual([
      { key: "question", label: "Question", value: "What survived sync?" },
      { key: "answer", label: "Answer", value: "The old card still has field labels." },
    ]);
  });

  it("keeps visible missing required custom card fields readable", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-concept",
      name: "Concept",
      markdown: "Definition:",
      fields: [
        { key: "term", label: "Term", type: "text", required: true },
        { key: "evidence", label: "Evidence", type: "multiline" },
        { key: "reviewed", label: "Reviewed", type: "checkbox", required: true },
        {
          key: "private",
          label: "Private note",
          type: "text",
          required: true,
          visibleWhen: { fieldKey: "reviewed", operator: "equals", value: true },
        },
      ],
      now: 123,
    });
    const model = createReadAnyCardReadOnlyModel(
      {
        cardType: "custom:template-concept",
        version: 1,
        title: "Incomplete concept",
        markdown: "Definition:",
        data: {
          term: "",
        },
      },
      { body: "", cardTemplates: [template] },
    );

    expect(model.structuredFields).toEqual([
      { key: "term", label: "Term", value: "Missing required value", missing: true },
      { key: "reviewed", label: "Reviewed", value: "Missing required value", missing: true },
    ]);
    expect(model.structuredFields.map((field) => field.key)).not.toContain("evidence");
    expect(model.structuredFields.map((field) => field.key)).not.toContain("private");
    expect(renderReadAnyCardStructuredFieldsMarkdown(model.structuredFields)).toBe(
      ["Fields:", "- Term: Missing required value", "- Reviewed: Missing required value"].join(
        "\n",
      ),
    );
    const fallbackMarkdown = renderReadAnyCardMarkdownFallback(
      {
        cardType: "custom:template-concept",
        version: 1,
        title: "Incomplete concept",
        markdown: "Definition:",
      },
      { body: "", cardTemplates: [template] },
    );
    expect(fallbackMarkdown).toContain("> - Term: Missing required value");
    expect(fallbackMarkdown).toContain("> - Reviewed: Missing required value");
    expect(fallbackMarkdown).not.toContain("Private note");
  });

  it("detects missing required custom card values without treating falsey values as empty", () => {
    expect(
      isReadAnyCardTemplateRequiredValueMissing(
        { key: "term", label: "Term", type: "text", required: true },
        "  ",
      ),
    ).toBe(true);
    expect(
      isReadAnyCardTemplateRequiredValueMissing(
        { key: "confidence", label: "Confidence", type: "number", required: true },
        0,
      ),
    ).toBe(false);
    expect(
      isReadAnyCardTemplateRequiredValueMissing(
        { key: "reviewed", label: "Reviewed", type: "checkbox", required: true },
        false,
      ),
    ).toBe(false);
    expect(
      isReadAnyCardTemplateRequiredValueMissing(
        {
          key: "priority",
          label: "Priority",
          type: "select",
          required: true,
          options: [{ label: "High", value: "high" }],
        },
        "",
      ),
    ).toBe(true);
    expect(
      isReadAnyCardTemplateRequiredValueMissing(
        {
          key: "themes",
          label: "Themes",
          type: "multiselect",
          required: true,
          options: [{ label: "Attention", value: "attention" }],
        },
        [],
      ),
    ).toBe(true);
  });

  it("updates custom card templates without changing their stable card type", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-reading-question",
      name: "Reading Question",
      description: "Track a question and answer.",
      markdown: "Question:\nAnswer:",
      now: 123,
    });

    const updated = updateCustomReadAnyCardTemplate({
      template: {
        ...template,
        schemaJson: {
          ...(template.schemaJson as Record<string, unknown>),
          attrs: {
            data: { tone: "short" },
          },
        },
      },
      name: "Reading Prompt",
      description: "",
      markdown: "Prompt:\nResponse:",
      now: 456,
    });

    expect(updated).toMatchObject({
      id: "template-reading-question",
      name: "Reading Prompt",
      version: 2,
      builtIn: false,
      enabled: true,
      createdAt: 123,
      updatedAt: 456,
      schemaJson: {
        cardType: "custom:template-reading-question",
        insertLabel: "Reading Prompt",
        title: "Reading Prompt",
        markdown: "Prompt:\nResponse:",
        attrs: {
          data: { tone: "short" },
        },
      },
    });
    expect((updated.schemaJson as Record<string, unknown>).description).toBeUndefined();
    expect(createReadAnyCardAttrsFromTemplate(updated)).toEqual({
      cardType: "custom:template-reading-question",
      version: 2,
      title: "Reading Prompt",
      markdown: "Prompt:\nResponse:",
      data: { tone: "short" },
    });
  });

  it("updates visual custom card fields without dropping existing data defaults", () => {
    const template = {
      ...createCustomReadAnyCardTemplate({
        id: "template-reading-question",
        name: "Reading Question",
        markdown: "Question:\nAnswer:",
        fields: [{ key: "question", label: "Question", type: "text", defaultValue: "Why?" }],
        now: 123,
      }),
      schemaJson: {
        cardType: "custom:template-reading-question",
        title: "Reading Question",
        markdown: "Question:\nAnswer:",
        fields: [{ key: "question", label: "Question", type: "text", defaultValue: "Why?" }],
        attrs: {
          data: {
            question: "User default question",
            tone: "short",
          },
        },
      },
    };

    const updated = updateCustomReadAnyCardTemplate({
      template,
      name: "Reading Prompt",
      markdown: "Prompt:\nResponse:",
      fields: [
        { key: "question", label: "Question", type: "text", defaultValue: "Why?" },
        { key: "answer", label: "Answer", type: "multiline", defaultValue: "Because..." },
      ],
      now: 456,
    });

    expect(updated.schemaJson).toMatchObject({
      fields: [
        { key: "question", label: "Question", type: "text", defaultValue: "Why?" },
        { key: "answer", label: "Answer", type: "multiline", defaultValue: "Because..." },
      ],
      attrs: {
        data: {
          question: "User default question",
          answer: "Because...",
          tone: "short",
        },
      },
    });
    expect(createReadAnyCardAttrsFromTemplate(updated).data).toEqual({
      question: "User default question",
      answer: "Because...",
      tone: "short",
    });
  });

  it("adds custom card field rename migrations when template field keys change", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-reading-question",
      name: "Reading Question",
      markdown: "Question:\nAnswer:",
      fields: [
        { key: "question", label: "Question", type: "text" },
        {
          key: "answer",
          label: "Answer",
          type: "multiline",
          visibleWhen: { fieldKey: "question", operator: "notEmpty" },
        },
      ],
      now: 123,
    });

    const updated = updateCustomReadAnyCardTemplate({
      template,
      name: "Reading Prompt",
      markdown: "Prompt:\nAnswer:",
      fields: [
        { key: "prompt", label: "Prompt", type: "text" },
        {
          key: "answer",
          label: "Answer",
          type: "multiline",
          visibleWhen: { fieldKey: "question", operator: "notEmpty" },
        },
      ],
      now: 456,
    });

    expect(updated.schemaJson).toMatchObject({
      fields: [
        { key: "prompt", label: "Prompt", type: "text" },
        {
          key: "answer",
          label: "Answer",
          type: "multiline",
          visibleWhen: { fieldKey: "prompt", operator: "notEmpty" },
        },
      ],
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          dataRenames: { question: "prompt" },
        },
      ],
    });

    const migrated = upgradeReadAnyCardAttrsWithTemplates(
      {
        cardType: "custom:template-reading-question",
        version: 1,
        title: "Old prompt card",
        data: {
          question: "What changed?",
          answer: "The template field key changed.",
        },
      },
      [updated],
    );

    expect(migrated).toMatchObject({
      version: 2,
      data: {
        prompt: "What changed?",
        answer: "The template field key changed.",
      },
    });
    const model = createReadAnyCardReadOnlyModel(migrated, {
      body: "",
      cardTemplates: [updated],
    });
    expect(model.structuredFields).toEqual([
      { key: "prompt", label: "Prompt", value: "What changed?" },
      { key: "answer", label: "Answer", value: "The template field key changed." },
    ]);
  });

  it("migrates custom card attrs to newer synced templates without overwriting user content", () => {
    const template = updateCustomReadAnyCardTemplate({
      template: {
        ...createCustomReadAnyCardTemplate({
          id: "template-reading-question",
          name: "Reading Question",
          markdown: "Question:\nAnswer:",
          now: 123,
        }),
        schemaJson: {
          cardType: "custom:template-reading-question",
          title: "Reading Question",
          markdown: "Question:\nAnswer:",
          attrs: {
            data: {
              kind: "prompt",
              layout: {
                tone: "short",
                density: "compact",
              },
            },
          },
        },
      },
      name: "Reading Prompt",
      markdown: "Prompt:\nResponse:",
      now: 456,
    });

    const migrated = upgradeReadAnyCardAttrsWithTemplates(
      {
        cardType: "custom:template-reading-question",
        version: 1,
        title: "My own prompt",
        markdown: "Question: What changed?\nAnswer: The ending.",
        data: {
          layout: {
            density: "detailed",
          },
        },
      },
      [template],
    );

    expect(migrated).toEqual({
      cardType: "custom:template-reading-question",
      version: 2,
      title: "My own prompt",
      markdown: "Question: What changed?\nAnswer: The ending.",
      text: "Question: What changed?\nAnswer: The ending.",
      data: {
        kind: "prompt",
        layout: {
          tone: "short",
          density: "detailed",
        },
      },
    });

    expect(
      upgradeReadAnyCardAttrsWithTemplates(
        {
          cardType: "custom:template-reading-question",
          version: 1,
          data: "legacy-data",
        },
        [template],
      ).data,
    ).toBe("legacy-data");
  });

  it("applies synced custom card schema migrations across versions", () => {
    const migrations: JSONValue[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        dataRenames: {
          "meta.oldSource": "source.title",
          summary: "body.summary",
        },
        dataDefaults: {
          source: {
            kind: "book",
          },
          layout: {
            tone: "calm",
          },
        },
        removeData: ["meta.legacyFlag"],
      },
      {
        fromVersion: 2,
        toVersion: 3,
        dataRenames: {
          "body.summary": "body.abstract",
        },
        dataDefaults: {
          body: {
            format: "markdown",
          },
        },
      },
    ];
    const template = {
      id: "template-concept",
      name: "Concept",
      version: 3,
      schemaJson: {
        cardType: "custom:template-concept",
        title: "Concept",
        markdown: "Definition:\nEvidence:",
        attrs: {
          data: {
            schema: "concept-v3",
            layout: {
              density: "compact",
            },
          },
        },
        migrations,
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    const migrated = upgradeReadAnyCardAttrsWithTemplates(
      {
        cardType: "custom:template-concept",
        version: 1,
        title: "My concept",
        markdown: "User-authored body",
        data: {
          summary: "A reusable idea.",
          meta: {
            oldSource: "Chapter 4",
            legacyFlag: true,
          },
          layout: {
            density: "detailed",
          },
        },
      },
      [template],
    );

    expect(migrated).toEqual({
      cardType: "custom:template-concept",
      version: 3,
      title: "My concept",
      markdown: "User-authored body",
      text: "User-authored body",
      data: {
        schema: "concept-v3",
        source: {
          kind: "book",
          title: "Chapter 4",
        },
        body: {
          format: "markdown",
          abstract: "A reusable idea.",
        },
        layout: {
          tone: "calm",
          density: "detailed",
        },
        meta: {},
      },
    });
  });

  it("does not force custom migrations onto explicit non-object card data", () => {
    const template = {
      id: "template-legacy",
      name: "Legacy",
      version: 2,
      schemaJson: {
        cardType: "custom:template-legacy",
        title: "Legacy",
        markdown: "Fallback",
        attrs: {
          data: {
            kind: "default",
          },
        },
        migrations: [
          {
            toVersion: 2,
            dataDefaults: {
              kind: "migrated",
            },
          },
        ],
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(
      upgradeReadAnyCardAttrsWithTemplates(
        {
          cardType: "custom:template-legacy",
          version: 1,
          data: "legacy-serialized-data",
        },
        [template],
      ),
    ).toMatchObject({
      version: 2,
      data: "legacy-serialized-data",
    });

    expect(
      upgradeReadAnyCardAttrsWithTemplates(
        {
          cardType: "custom:template-legacy",
          version: 1,
        },
        [template],
      ).data,
    ).toEqual({ kind: "migrated" });
  });

  it("formats and parses custom card data safely for editor controls", () => {
    expect(formatReadAnyCardDataForEditor(undefined)).toBe("");
    expect(formatReadAnyCardDataForEditor(null)).toBe("");
    expect(
      formatReadAnyCardDataForEditor({
        source: "ai",
        layout: { density: "compact" },
        steps: ["read", "review"],
      }),
    ).toBe(
      [
        "{",
        '  "source": "ai",',
        '  "layout": {',
        '    "density": "compact"',
        "  },",
        '  "steps": [',
        '    "read",',
        '    "review"',
        "  ]",
        "}",
      ].join("\n"),
    );

    expect(parseReadAnyCardDataFromEditor("")).toEqual({ ok: true, data: null });
    expect(parseReadAnyCardDataFromEditor('{"source":"ai","count":2}')).toEqual({
      ok: true,
      data: { source: "ai", count: 2 },
    });
    expect(parseReadAnyCardDataFromEditor("[NaN]").ok).toBe(false);
    expect(parseReadAnyCardDataFromEditor("{broken").ok).toBe(false);
  });

  it("rejects edits to built-in card templates", () => {
    expect(() =>
      updateCustomReadAnyCardTemplate({
        template: {
          id: "callout",
          name: "Callout",
          version: 1,
          schemaJson: {},
          builtIn: true,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        name: "Edited",
      }),
    ).toThrow("Built-in card templates cannot be edited.");
  });
});
