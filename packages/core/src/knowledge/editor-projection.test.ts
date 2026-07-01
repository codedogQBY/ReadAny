import { describe, expect, it } from "vitest";
import type { JSONValue, KnowledgeCardTemplate } from "../types";
import {
  createReadAnyCardTiptapContent,
  markdownToBasicTiptap,
  normalizeTiptapDocument,
  renderKnowledgeJsonToMarkdown,
  renderKnowledgeJsonToReadOnlyHtml,
} from "./editor-projection";

describe("editor projection", () => {
  it("renders common Tiptap nodes to Markdown", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Chapter Notes" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "deeply", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "slowly", marks: [{ type: "italic" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "A quote" }] }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Review" }] }],
            },
          ],
        },
        { type: "horizontalRule" },
        { type: "image", attrs: { src: "cover.png", alt: "Cover" } },
        { type: "image", attrs: { attachmentId: "att-1", src: "asset://cover.png", alt: "Local" } },
        { type: "image", attrs: { src: "Assets/Cover (final).png", alt: "Cover [draft]" } },
      ],
    });

    expect(markdown).toBe(
      [
        "## Chapter Notes",
        "Read **deeply** and *slowly*.",
        "> A quote",
        "- One\n- Two",
        "- [x] Review",
        "---",
        "![Cover](cover.png)",
        "![Local](readany-attachment://att-1)",
        "![Cover \\[draft\\]](<Assets/Cover (final).png>)",
      ].join("\n\n"),
    );
  });

  it("allows export callers to resolve image attachment targets", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { attachmentId: "att-1", src: "asset://cover.png", alt: "Cover" },
          },
        ],
      },
      {
        resolveImageSrc: (attrs) =>
          attrs.attachmentId === "att-1" ? "../Assets/cover.png" : undefined,
      },
    );

    expect(markdown).toBe("![Cover](../Assets/cover.png)");
  });

  it("renders ReadAny cards as Obsidian-friendly callouts by default", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            title: "Important Quote",
            text: "Reading is thinking.",
            sourceTitle: "Chapter 1",
          },
        },
      ],
    });

    expect(markdown).toBe(
      "> [!quote] Important Quote\n> Reading is thinking.\n> Source: Chapter 1",
    );
  });

  it("renders Tiptap JSON to static read-only HTML without exposing unsafe markup", () => {
    const html = renderKnowledgeJsonToReadOnlyHtml({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Chapter <Notes>" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "deeply", marks: [{ type: "bold" }] },
            { type: "text", text: " and ignore " },
            {
              type: "text",
              text: "bad links",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: "doc-1",
                label: "Linked Note",
              },
            },
            { type: "text", text: " " },
            {
              type: "readanySourceReference",
              attrs: {
                label: "Chapter 1",
                sourceId: "hl-1",
                cfi: "epubcfi(/6/2)",
              },
            },
          ],
        },
        {
          type: "image",
          attrs: {
            attachmentId: "att-1",
            src: "asset://cover.png",
            alt: "Cover",
          },
        },
      ],
    });

    expect(html).toBe(
      [
        "<h2>Chapter &lt;Notes&gt;</h2>",
        "<p>Read <strong>deeply</strong> and ignore bad links.</p>",
        '<p><span class="readany-internal-link" data-document-id="doc-1" data-target="doc-1">Linked Note</span> <span class="readany-source-reference" data-cfi="epubcfi(/6/2)" data-source-id="hl-1">Chapter 1</span></p>',
        '<figure class="readany-image"><img src="readany-attachment://att-1" alt="Cover"><figcaption>Cover</figcaption></figure>',
      ].join(""),
    );
    expect(html).not.toContain("javascript:");
  });

  it("renders unsupported and future ReadAny cards as safe static fallback cards", () => {
    const html = renderKnowledgeJsonToReadOnlyHtml({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "customMetric",
            version: 3,
            title: "Reading score",
            text: "Focus: 92%",
            sourceTitle: "Chapter 4",
            cfi: "epubcfi(/6/4)",
            data: { private: "<json>" },
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            version: 99,
            title: "Future summary",
            markdown: "Readable fallback body.",
          },
        },
      ],
    });

    expect(html).toContain('data-readany-card-type="customMetric"');
    expect(html).toContain('data-readany-card-state="unsupported"');
    expect(html).toContain("<h4>Reading score</h4>");
    expect(html).toContain("<p>Focus: 92%</p>");
    expect(html).toContain("<dt>Source</dt><dd>Chapter 4</dd>");
    expect(html).toContain("<dt>CFI</dt><dd>epubcfi(/6/4)</dd>");
    expect(html).toContain('data-readany-card-type="aiSummary"');
    expect(html).toContain('data-readany-card-state="future"');
    expect(html).toContain("v99 newer");
    expect(html).not.toContain("private");
    expect(html).not.toContain("&lt;json&gt;");
  });

  it("renders missing required custom card fields in Markdown and static HTML", () => {
    const cardTemplates: KnowledgeCardTemplate[] = [
      {
        id: "template-concept",
        name: "Concept",
        version: 1,
        schemaJson: {
          cardType: "custom:template-concept",
          title: "Concept",
          fields: [
            { key: "term", label: "Term", type: "text", required: true, width: "half" },
            { key: "evidence", label: "Evidence", type: "multiline" },
          ],
        },
        builtIn: false,
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const content = {
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-concept",
            version: 1,
            title: "Incomplete concept",
            markdown: "Definition:",
          },
        },
      ],
    };

    const markdown = renderKnowledgeJsonToMarkdown(content, { cardTemplates });
    const html = renderKnowledgeJsonToReadOnlyHtml(content, { cardTemplates });

    expect(markdown).toContain("- Term: Missing required value");
    expect(markdown).not.toContain("- Evidence:");
    expect(html).toContain('data-readany-card-field-state="missing"');
    expect(html).toContain('data-readany-card-field-width="half"');
    expect(html).toContain("readany-card-field-width-half");
    expect(html).toContain("<dt>Term</dt><dd>Missing required value</dd>");
    expect(html).not.toContain("<dt>Evidence</dt>");
  });

  it("uses card registry fallbacks for built-in ReadAny card types", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            title: "AI Summary",
            markdown: "A compact summary.",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "mermaid",
            title: "Flow",
            markdown: "graph TD\n  A --> B",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiToolFailure",
            data: {
              toolName: "searchKnowledgeBase",
              error: "Index unavailable",
            },
          },
        },
      ],
    });

    expect(markdown).toBe(
      [
        "> [!summary] AI Summary\n> A compact summary.",
        "> [!abstract] Flow\n```mermaid\ngraph TD\n  A --> B\n```",
        "> [!failure] searchKnowledgeBase\n> Tool: searchKnowledgeBase\n> Error: Index unavailable",
      ].join("\n\n"),
    );
  });

  it("normalizes legacy card attrs into readable fallbacks", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            type: "legacyTimeline",
            version: "2",
            title: "Reading timeline",
            source: "highlight-1",
            "source-title": "Chapter 2",
            text: "A -> B",
          },
        },
      ],
    });

    expect(markdown).toBe(
      [
        "> [!note] Reading timeline",
        "> A -> B",
        "> ReadAny card: legacyTimeline v2",
        "> Source: Chapter 2",
      ].join("\n"),
    );
  });

  it("upgrades card attrs while normalizing Tiptap documents", () => {
    expect(
      normalizeTiptapDocument({
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              type: "bookQuote",
              data: {
                quote: "A precise quote.",
                chapterTitle: "Chapter 3",
                highlightId: "hl-3",
              },
            },
          },
        ],
      }),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            version: 1,
            markdown: "A precise quote.",
            text: "A precise quote.",
            sourceTitle: "Chapter 3",
            sourceId: "hl-3",
            data: {
              quote: "A precise quote.",
              chapterTitle: "Chapter 3",
              highlightId: "hl-3",
            },
          },
        },
      ],
    });
  });

  it("uses synced custom card templates while normalizing active editor documents", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before card" }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-reading-question",
            version: 1,
            title: "My own prompt",
            markdown: "Question: What changed?",
            data: {
              layout: {
                density: "detailed",
              },
            },
          },
        },
      ],
    };

    const normalized = normalizeTiptapDocument(content as unknown as JSONValue, {
      cardTemplates: [
        {
          id: "template-reading-question",
          name: "Reading Prompt",
          version: 3,
          schemaJson: {
            cardType: "custom:template-reading-question",
            title: "Reading Prompt",
            markdown: "Prompt:\nResponse:",
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
          builtIn: false,
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    expect(normalized).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before card" }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-reading-question",
            version: 3,
            title: "My own prompt",
            markdown: "Question: What changed?",
            text: "Question: What changed?",
            data: {
              kind: "prompt",
              layout: {
                tone: "short",
                density: "detailed",
              },
            },
          },
        },
      ],
    });
    expect((content.content[1] as { attrs: { version: number } }).attrs.version).toBe(1);
  });

  it("projects migrated custom card templates to Markdown and read-only HTML", () => {
    const migrations: JSONValue[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        dataRenames: {
          summary: "body.abstract",
        },
        dataDefaults: {
          body: {
            format: "markdown",
          },
        },
      },
    ];
    const cardTemplates: KnowledgeCardTemplate[] = [
      {
        id: "template-concept",
        name: "Concept",
        version: 2,
        schemaJson: {
          cardType: "custom:template-concept",
          title: "Concept",
          markdown: "Definition:\nEvidence:",
          attrs: {
            data: {
              schema: "concept-v2",
            },
          },
          migrations,
        },
        builtIn: false,
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const content = {
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-concept",
            version: 1,
            title: "Attention",
            markdown: "User body",
            data: {
              summary: "Ritual attention",
            },
          },
        },
      ],
    };

    const markdown = renderKnowledgeJsonToMarkdown(content as unknown as JSONValue, {
      cardTemplates,
      includeReadAnyCardMetadata: true,
    });
    const html = renderKnowledgeJsonToReadOnlyHtml(content as unknown as JSONValue, {
      cardTemplates,
    });

    expect(markdown).toContain('version="2"');
    expect(markdown).toContain("User body");
    expect(markdown).toContain(encodeURIComponent('"abstract":"Ritual attention"'));
    expect(html).toContain('data-readany-card-version="2"');
    expect(html).toContain('data-readany-card-state="custom"');
    expect(html).toContain("Attention");
    expect(html).toContain("User body");
  });

  it("converts ReadAny cards into normal editable Tiptap content", () => {
    expect(
      createReadAnyCardTiptapContent({
        cardType: "aiSummary",
        version: 1,
        title: "AI summary",
        markdown: "The chapter connects memory and ritual.",
        sourceTitle: "Chapter 4",
        sourceId: "doc-4",
        cfi: "epubcfi(/6/4)",
      }),
    ).toEqual([
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "AI summary" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "The chapter connects memory and ritual." }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Source: " },
          {
            type: "readanySourceReference",
            attrs: {
              label: "Chapter 4",
              sourceTitle: "Chapter 4",
              sourceId: "doc-4",
              cfi: "epubcfi(/6/4)",
            },
          },
        ],
      },
    ]);
  });

  it("round-trips editable source references with document source ids", () => {
    const content = createReadAnyCardTiptapContent({
      cardType: "aiSummary",
      version: 1,
      title: "Document-linked summary",
      markdown: "A concise synthesis.",
      sourceTitle: "Book Home",
      sourceId: "doc-home",
    });

    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: content as unknown as JSONValue[],
    });
    const roundTrippedContent = markdownToBasicTiptap(markdown).content ?? [];

    expect(markdown).toContain("Source: [Book Home](readany://source/doc-home)");
    expect(roundTrippedContent[roundTrippedContent.length - 1]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "Source: " },
        {
          type: "readanySourceReference",
          attrs: {
            label: "Book Home",
            sourceTitle: "Book Home",
            sourceId: "doc-home",
          },
        },
      ],
    });
  });

  it("round-trips editable source references with encoded CFI links", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Cite " },
            {
              type: "readanySourceReference",
              attrs: {
                label: "Chapter 2",
                sourceTitle: "Chapter 2",
                sourceId: "hl-2",
                cfi: "epubcfi(/6/2!/4/8)",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).toBe(
      "Cite [Chapter 2](readany://cfi/epubcfi%28%2F6%2F2!%2F4%2F8%29?sourceId=hl-2)",
    );
    expect(markdownToBasicTiptap(markdown)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Cite " },
            {
              type: "readanySourceReference",
              attrs: { label: "Chapter 2", cfi: "epubcfi(/6/2!/4/8)", sourceId: "hl-2" },
            },
          ],
        },
      ],
    });
  });

  it("exports upgraded card metadata for round-tripping", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              type: "bookQuote",
              data: {
                quote: "A precise quote.",
                chapterTitle: "Chapter 3",
                highlightId: "hl-3",
              },
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="bookQuote" version="1" source="hl-3" source-title="Chapter 3" data="%7B%22quote%22%3A%22A%20precise%20quote.%22%2C%22chapterTitle%22%3A%22Chapter%203%22%2C%22highlightId%22%3A%22hl-3%22%7D"\nA precise quote.\n:::',
    );
  });

  it("can preserve ReadAny card metadata for round-tripping", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "bookQuote",
              id: "card-1",
              version: 2,
              sourceId: "hl-1",
              markdown: "> Quote",
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="bookQuote" id="card-1" version="2" source="hl-1"\n> Quote\n:::',
    );
  });

  it("uses synced custom card templates to migrate exported card metadata safely", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "custom:template-reading-question",
              version: 1,
              title: "My reading prompt",
              markdown: "Question: What changed?",
            },
          },
        ],
      },
      {
        includeReadAnyCardMetadata: true,
        cardTemplates: [
          {
            id: "template-reading-question",
            name: "Reading Prompt",
            version: 3,
            schemaJson: {
              cardType: "custom:template-reading-question",
              title: "Reading Prompt",
              markdown: "Prompt:\nResponse:",
              attrs: {
                data: { kind: "prompt" },
              },
            },
            builtIn: false,
            enabled: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    );

    expect(markdown).toBe(
      ':::readany-card type="custom:template-reading-question" version="3" title="My reading prompt" data="%7B%22kind%22%3A%22prompt%22%7D"\nQuestion: What changed?\n:::',
    );
  });

  it("projects custom card structured fields into readable Markdown and HTML", () => {
    const cardTemplates = [
      {
        id: "template-concept",
        name: "Concept",
        version: 1,
        schemaJson: {
          cardType: "custom:template-concept",
          title: "Concept",
          markdown: "Definition:",
          fields: [
            { key: "term", label: "Term", type: "text" },
            { key: "evidence", label: "Evidence", type: "multiline" },
            { key: "confidence", label: "Confidence", type: "number" },
          ],
        },
        builtIn: false,
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const content = {
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-concept",
            version: 1,
            title: "Attention",
            markdown: "Definition: directed perception",
            data: {
              term: "Attention",
              evidence: "Ritual practice",
              confidence: 0.92,
            },
          },
        },
      ],
    };

    const markdown = renderKnowledgeJsonToMarkdown(content as unknown as JSONValue, {
      cardTemplates,
      includeReadAnyCardMetadata: true,
    });
    const fallbackMarkdown = renderKnowledgeJsonToMarkdown(content as unknown as JSONValue, {
      cardTemplates,
    });
    const html = renderKnowledgeJsonToReadOnlyHtml(content as unknown as JSONValue, {
      cardTemplates,
    });

    expect(markdown).toContain("Definition: directed perception\n\nFields:");
    expect(markdown).toContain("- Term: Attention");
    expect(markdown).toContain("- Confidence: 0.92");
    expect(fallbackMarkdown).toContain("> Fields:");
    expect(fallbackMarkdown).toContain("> - Evidence: Ritual practice");
    expect(html).toContain('class="readany-card-fields"');
    expect(html).toContain("<dt>Confidence</dt><dd>0.92</dd>");
  });

  it("projects grouped custom card structured fields into readable Markdown and HTML sections", () => {
    const cardTemplates = [
      {
        id: "template-claim",
        name: "Claim",
        version: 1,
        schemaJson: {
          cardType: "custom:template-claim",
          title: "Claim",
          markdown: "Claim:",
          fields: [
            { key: "claim", label: "Claim", type: "text", group: "Core" },
            { key: "evidence", label: "Evidence", type: "multiline", group: "Evidence" },
            { key: "reviewed", label: "Reviewed", type: "checkbox" },
          ],
        } as JSONValue,
        builtIn: false,
        enabled: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    const content = {
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "custom:template-claim",
            version: 1,
            title: "Attention",
            markdown: "Claim: attention is trained",
            data: {
              claim: "Attention is trained.",
              evidence: "Chapter 2 example",
              reviewed: true,
            },
          },
        },
      ],
    };

    const markdown = renderKnowledgeJsonToMarkdown(content as unknown as JSONValue, {
      cardTemplates,
      includeReadAnyCardMetadata: true,
    });
    const fallbackMarkdown = renderKnowledgeJsonToMarkdown(content as unknown as JSONValue, {
      cardTemplates,
    });
    const html = renderKnowledgeJsonToReadOnlyHtml(content as unknown as JSONValue, {
      cardTemplates,
    });

    expect(markdown).toContain("Fields:\nCore:\n  - Claim: Attention is trained.");
    expect(markdown).toContain("Evidence:\n  - Evidence: Chapter 2 example");
    expect(markdown).toContain("- Reviewed: Yes");
    expect(fallbackMarkdown).toContain("> Core:");
    expect(fallbackMarkdown).toContain(">   - Evidence: Chapter 2 example");
    expect(html).toContain('class="readany-card-fields readany-card-fields-grouped"');
    expect(html).toContain('class="readany-card-field-group-title">Core</div>');
    expect(html).toContain("<dt>Evidence</dt><dd>Chapter 2 example</dd>");
  });

  it("preserves normalized legacy card metadata when requested", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              type: "legacyTimeline",
              version: "2",
              title: "Reading timeline",
              source: "highlight-1",
              "source-title": "Chapter 2",
              cfi: "epubcfi(/6/8)",
              markdown: "A -> B",
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="legacyTimeline" version="2" title="Reading timeline" source="highlight-1" source-title="Chapter 2" cfi="epubcfi(/6/8)"\nA -> B\n:::',
    );
  });

  it("preserves ReadAny card title and CFI metadata when requested", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "bookQuote",
              id: "card-1",
              version: 2,
              title: 'Quoted "Idea"',
              sourceId: "hl-1",
              cfi: "epubcfi(/6/2)",
              markdown: "Reading is thinking.",
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="bookQuote" id="card-1" version="2" title="Quoted \\"Idea\\"" source="hl-1" cfi="epubcfi(/6/2)"\nReading is thinking.\n:::',
    );
  });

  it("preserves card source titles and structured data metadata when requested", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "aiSummary",
              id: "card-ai-1",
              version: 3,
              title: "AI memory",
              sourceId: "doc-1",
              sourceTitle: "Chapter 1",
              markdown: "A compact answer.",
              data: {
                citations: [{ cfi: "epubcfi(/6/4)", text: "Evidence" }],
                toolState: "confirmed",
              },
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      [
        ':::readany-card type="aiSummary" id="card-ai-1" version="3" title="AI memory" source="doc-1" source-title="Chapter 1" data="%7B%22citations%22%3A%5B%7B%22cfi%22%3A%22epubcfi(%2F6%2F4)%22%2C%22text%22%3A%22Evidence%22%7D%5D%2C%22toolState%22%3A%22confirmed%22%7D"',
        "A compact answer.",
        ":::",
      ].join("\n"),
    );

    expect(markdownToBasicTiptap(markdown)).toEqual({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            id: "card-ai-1",
            version: 3,
            title: "AI memory",
            sourceId: "doc-1",
            sourceTitle: "Chapter 1",
            markdown: "A compact answer.",
            data: {
              citations: [{ cfi: "epubcfi(/6/4)", text: "Evidence" }],
              toolState: "confirmed",
            },
          },
        },
      ],
    });
  });

  it("imports ReadAny card metadata blocks without losing card attrs or body spacing", () => {
    const json = markdownToBasicTiptap(
      [
        ':::readany-card type="bookQuote" id="card-1" version="2" title="Quoted \\"Idea\\"" source="hl-1" cfi="epubcfi(/6/2)"',
        "Line 1",
        "",
        "Line 2",
        ":::",
      ].join("\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            id: "card-1",
            version: 2,
            title: 'Quoted "Idea"',
            sourceId: "hl-1",
            cfi: "epubcfi(/6/2)",
            markdown: "Line 1\n\nLine 2",
          },
        },
      ],
    });
  });

  it("migrates imported custom card metadata with synced templates", () => {
    const json = markdownToBasicTiptap(
      [
        ':::readany-card type="custom:template-reading-question" version="1" title="My prompt" data="%7B%22layout%22%3A%7B%22density%22%3A%22detailed%22%7D%7D"',
        "Question: What changed?",
        ":::",
      ].join("\n"),
      {
        cardTemplates: [
          {
            id: "template-reading-question",
            name: "Reading Prompt",
            version: 4,
            schemaJson: {
              cardType: "custom:template-reading-question",
              title: "Reading Prompt",
              markdown: "Prompt:\nResponse:",
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
            builtIn: false,
            enabled: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    );

    expect(json.content?.[0]?.attrs).toEqual({
      cardType: "custom:template-reading-question",
      version: 4,
      title: "My prompt",
      markdown: "Question: What changed?",
      text: "Question: What changed?",
      data: {
        kind: "prompt",
        layout: {
          tone: "short",
          density: "detailed",
        },
      },
    });
  });

  it("imports basic Markdown blocks into Tiptap JSON", () => {
    const json = markdownToBasicTiptap(
      ["# Title", "Paragraph", "> Quote", "- A\n- B", "1. One\n2. Two", "---"].join("\n\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Paragraph" }] },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }],
            },
          ],
        },
        { type: "horizontalRule" },
      ],
    });
  });

  it("imports inline rich text into Tiptap marks and source nodes", () => {
    const json = markdownToBasicTiptap(
      [
        "Read **deeply**, *slowly*, ~~carefully~~, and `quote accurately`.",
        "Open [ReadAny](https://readany.example) and cite [Chapter 1](readany://cfi/epubcfi%28%2F6%2F2%29).",
        "Link [[doc-1|Durable note]] and [[Loose idea]].",
      ].join("\n\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "deeply", marks: [{ type: "bold" }] },
            { type: "text", text: ", " },
            { type: "text", text: "slowly", marks: [{ type: "italic" }] },
            { type: "text", text: ", " },
            { type: "text", text: "carefully", marks: [{ type: "strike" }] },
            { type: "text", text: ", and " },
            { type: "text", text: "quote accurately", marks: [{ type: "code" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open " },
            {
              type: "text",
              text: "ReadAny",
              marks: [{ type: "link", attrs: { href: "https://readany.example" } }],
            },
            { type: "text", text: " and cite " },
            {
              type: "readanySourceReference",
              attrs: { label: "Chapter 1", cfi: "epubcfi(/6/2)" },
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Link " },
            {
              type: "readanyInternalLink",
              attrs: { documentId: "doc-1", label: "Durable note", title: "Durable note" },
            },
            { type: "text", text: " and " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Loose idea", title: "Loose idea" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("round-trips inline links with bracketed labels and parenthesized URLs", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open " },
            {
              type: "text",
              text: "Spec [draft]",
              marks: [{ type: "link", attrs: { href: "https://example.com/docs/ref(1)" } }],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });

    expect(markdown).toBe("Open [Spec \\[draft\\]](<https://example.com/docs/ref(1)>).");
    expect(markdownToBasicTiptap(markdown)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open " },
            {
              type: "text",
              text: "Spec [draft]",
              marks: [{ type: "link", attrs: { href: "https://example.com/docs/ref(1)" } }],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("exports Obsidian-style internal links without losing aliases", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Link " },
            {
              type: "readanyInternalLink",
              attrs: { documentId: "doc-1", label: "Durable note", title: "Durable note" },
            },
            { type: "text", text: " and " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Loose idea", title: "Loose idea" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });

    expect(markdown).toBe("Link [[doc-1|Durable note]] and [[Loose idea]].");
  });

  it("exports path-backed internal links without treating paths as document ids", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Compare " },
            {
              type: "readanyInternalLink",
              attrs: {
                targetPath: "Books/The Book/Reading Trail/Question Log",
                label: "Question Log",
                title: "Question Log",
              },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });

    expect(markdown).toBe("Compare [[Books/The Book/Reading Trail/Question Log|Question Log]].");
  });

  it("escapes internal link aliases so Obsidian round-trips titles with pipes", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Compare " },
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: "doc-1",
                label: "Question | Log",
                title: "Question | Log",
              },
            },
          ],
        },
      ],
    });

    expect(markdown).toBe("Compare [[doc-1|Question \\| Log]]");
    expect(markdownToBasicTiptap(markdown)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Compare " },
            {
              type: "readanyInternalLink",
              attrs: { documentId: "doc-1", label: "Question | Log", title: "Question | Log" },
            },
          ],
        },
      ],
    });
  });

  it("lets export callers resolve internal link ids to path-backed targets", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Compare " },
              {
                type: "readanyInternalLink",
                attrs: {
                  documentId: "doc-1",
                  label: "Question Log",
                  title: "Question Log",
                },
              },
              { type: "text", text: "." },
            ],
          },
        ],
      },
      {
        resolveInternalLinkTarget: (_attrs, fallbackTarget) =>
          fallbackTarget === "doc-1" ? "Books/The Book/Reading Trail/Question Log" : fallbackTarget,
      },
    );

    expect(markdown).toBe("Compare [[Books/The Book/Reading Trail/Question Log|Question Log]].");
  });

  it("imports stable ReadAny internal links without losing document ids", () => {
    const stableDocumentId = "23a0aef7-4188-4f5c-a955-cad6c1d3bb3f";
    const json = markdownToBasicTiptap(`Reference [[${stableDocumentId}]] and [[Loose idea]].`);

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Reference " },
            {
              type: "readanyInternalLink",
              attrs: {
                documentId: stableDocumentId,
                label: stableDocumentId,
                title: stableDocumentId,
              },
            },
            { type: "text", text: " and " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Loose idea", title: "Loose idea" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("imports Obsidian path links as target paths instead of document ids", () => {
    const json = markdownToBasicTiptap(
      "Follow [[Books/The Book/Reading Trail/Question Log|Question Log]] and [[Ideas/Loose.md]].",
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Follow " },
            {
              type: "readanyInternalLink",
              attrs: {
                targetPath: "Books/The Book/Reading Trail/Question Log",
                label: "Question Log",
                title: "Question Log",
              },
            },
            { type: "text", text: " and " },
            {
              type: "readanyInternalLink",
              attrs: {
                targetPath: "Ideas/Loose.md",
                label: "Loose",
                title: "Loose",
              },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("imports Markdown image and fenced code blocks without losing blank lines", () => {
    const json = markdownToBasicTiptap(
      [
        "![Cover](assets/cover.png)",
        "![Cover \\[draft\\]](<assets/Cover (final).png>)",
        "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      ].join("\n\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        { type: "image", attrs: { alt: "Cover", src: "assets/cover.png" } },
        { type: "image", attrs: { alt: "Cover [draft]", src: "assets/Cover (final).png" } },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a = 1;\n\nconst b = 2;" }],
        },
      ],
    });
  });

  it("imports Markdown task lists into task item nodes", () => {
    const json = markdownToBasicTiptap("- [x] Done\n- [ ] Later");

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Later" }] }],
            },
          ],
        },
      ],
    });
  });

  it("normalizes invalid content to an empty Tiptap document", () => {
    expect(normalizeTiptapDocument(null)).toEqual({ type: "doc", content: [] });
    expect(renderKnowledgeJsonToMarkdown(null)).toBe("");
  });
});
