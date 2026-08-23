import Database from "better-sqlite3";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStoreOnlyZip, type ZipEntry } from "@readany/core/utils/store-only-zip";
import { describe, expect, it } from "vitest";
import { ensureCoreInitialized, resetCoreForTests } from "./data.js";
import { handleMcpRequest } from "./mcp.js";
import { getMinimumProfileForScopes } from "./profiles.js";
import { READANY_TOOLS } from "./tool-registry.js";

const encoder = new TextEncoder();

function textEntry(name: string, content: string): ZipEntry {
  return { name, data: encoder.encode(content) };
}

function buildInspectableEpub(): Uint8Array {
  return buildStoreOnlyZip([
    textEntry("mimetype", "application/epub+zip"),
    textEntry(
      "META-INF/container.xml",
      `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
    ),
    textEntry(
      "OPS/package.opf",
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>MCP for Readers</dc:title><dc:creator>Ada Reader</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine></package>`,
    ),
    textEntry(
      "OPS/nav.xhtml",
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">Agent Access</a></li><li><a href="chapter-2.xhtml">Draft Safety</a></li></ol></nav></body></html>`,
    ),
    textEntry("OPS/chapter-1.xhtml", "<html><body>Agent Access</body></html>"),
    textEntry("OPS/chapter-2.xhtml", "<html><body>Draft Safety</body></html>"),
  ]);
}

function buildInvalidMissingResourceEpub(): Uint8Array {
  return buildStoreOnlyZip([
    textEntry("mimetype", "application/epub+zip"),
    textEntry(
      "META-INF/container.xml",
      `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
    ),
    textEntry(
      "OPS/package.opf",
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Invalid MCP Draft</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter-1" href="missing.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/></spine></package>`,
    ),
  ]);
}

function buildSimplePdf(pages: string[]): Uint8Array {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];

  for (const text of pages) {
    const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
    const contentId = addObject(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

async function createEnv() {
  const root = await mkdtemp(join(tmpdir(), "readany-cli-mcp-"));
  const dataRoot = join(root, "library");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(join(dataRoot, "books"), { recursive: true });
  return {
    ...process.env,
    READANY_HOME: dataRoot,
    AGENT_HOME: join(root, "agent"),
  } as NodeJS.ProcessEnv;
}

async function seedBook(env: NodeJS.ProcessEnv): Promise<void> {
  await resetCoreForTests();
  await ensureCoreInitialized(env);
  const db = new Database(join(env.READANY_HOME!, "readany.db"));
  db.exec(`
    INSERT INTO books (
      id, file_path, format, title, author, publisher, language, isbn, description,
      cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
      group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
      is_vectorized, vectorize_progress, tags, file_hash, sync_status
    ) VALUES (
      'mcp-book', 'books/mcp.epub', 'epub', 'MCP for Readers', 'Ada Reader', NULL, 'en',
      NULL, 'MCP access for ReadAny', NULL, NULL, NULL, NULL, '["AI"]',
      100, 8, NULL, 1000, 2000, 3000, NULL, 0.5, 'epubcfi(/6/2)', 1, 1,
      '["mcp"]', 'hash-mcp', 'local'
    );

    INSERT INTO notes (
      id, book_id, highlight_id, cfi, title, content, chapter_title, tags, created_at, updated_at
    ) VALUES (
      'mcp-note', 'mcp-book', NULL, 'epubcfi(/6/28)', 'MCP note',
      'MCP export should stay file-based.', 'Agent Access', '["mcp"]', 7000, 7000
    );

    INSERT INTO highlights (
      id, book_id, cfi, text, color, note, chapter_title, created_at, updated_at
    ) VALUES (
      'mcp-highlight', 'mcp-book', 'epubcfi(/6/30)',
      'External agents should receive export metadata, not full exported files.',
      'yellow', 'Export boundary', 'Agent Access', 8000, 8000
    );

    INSERT INTO bookmarks (
      id, book_id, cfi, label, chapter_title, created_at
    ) VALUES (
      'mcp-bookmark', 'mcp-book', 'epubcfi(/6/32)', 'Return here', 'Agent Access', 8100
    );

    INSERT INTO skills (
      id, name, description, icon, enabled, parameters, prompt, built_in, created_at, updated_at
    ) VALUES (
      'mcp-skill', 'MCP Reviewer', 'Reviews external access plans.', NULL, 1,
      '[]', 'Review the access plan.', 0, 8200, 8200
    );
  `);
  db.close();
  await writeFile(join(env.READANY_HOME!, "books", "mcp.epub"), buildInspectableEpub());

  const localDb = new Database(join(env.READANY_HOME!, "readany_local.db"));
  localDb.exec(`
    INSERT INTO chunks (
      id, book_id, chapter_index, chapter_title, content, token_count,
      start_cfi, end_cfi, segment_cfis, embedding, updated_at
    ) VALUES
    (
      'mcp-chunk-1', 'mcp-book', 1, 'Agent Access',
      'MCP access lets external agents search ReadAny chunks safely.',
      9, 'epubcfi(/6/20)', 'epubcfi(/6/22)', '["epubcfi(/6/20)"]', NULL, 6000
    ),
    (
      'mcp-chunk-1b', 'mcp-book', 1, 'Agent Access',
      'Chunk range controls keep MCP chapter reads bounded.',
      8, 'epubcfi(/6/22)', 'epubcfi(/6/23)', '["epubcfi(/6/22)"]', NULL, 6000
    ),
    (
      'mcp-chunk-2', 'mcp-book', 2, 'Draft Safety',
      'Draft-first editing protects original EPUB files.',
      7, 'epubcfi(/6/24)', 'epubcfi(/6/26)', '["epubcfi(/6/24)"]', NULL, 6000
    );
  `);
  localDb.close();
}

describe("mcp", () => {
  it("returns server capabilities during initialize", async () => {
    const response = await handleMcpRequest({ method: "initialize" }, "readonly", await createEnv());
    expect(response).toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: "readany" },
    });
  });

  it("lists implemented readonly tools only", async () => {
    const response = await handleMcpRequest({ method: "tools/list" }, "readonly", await createEnv());
    expect(response).toMatchObject({
      tools: [
        { name: "books.list" },
        { name: "books.search" },
        { name: "books.get" },
        { name: "chapters.list" },
        { name: "chapters.get" },
        { name: "context.get" },
        { name: "bookmarks.list" },
        { name: "skills.list" },
        { name: "notes.search" },
        { name: "notes.export" },
        { name: "knowledge.export" },
        { name: "knowledge.search" },
        { name: "highlights.search" },
        { name: "rag.search" },
        { name: "epub.inspect" },
        { name: "epub.draft.create" },
        { name: "epub.draft.discard" },
        { name: "epub.chapter.read" },
        { name: "epub.chapter.patch" },
        { name: "epub.chapters.patch" },
        { name: "epub.metadata.patch" },
        { name: "epub.toc.rebuild" },
        { name: "epub.history" },
        { name: "epub.diff" },
        { name: "epub.undo" },
        { name: "epub.validate" },
        { name: "epub.export" },
      ],
    });
  });

  it("includes safety metadata in tools/list for external agents", async () => {
    const response = await handleMcpRequest({ method: "tools/list" }, "readonly", await createEnv());
    const tools = (response as { tools: Array<Record<string, unknown>> }).tools;

    expect(tools.find((tool) => tool.name === "books.search")).toMatchObject({
      description: expect.stringContaining("Minimum profile: readonly"),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
      _meta: {
        "readany/risk": "low",
        "readany/scopes": ["book.read"],
        "readany/minimumProfile": "readonly",
      },
    });
    expect(tools.find((tool) => tool.name === "epub.chapter.patch")).toMatchObject({
      description: expect.stringContaining("Minimum profile: editor"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
      _meta: {
        "readany/risk": "medium",
        "readany/scopes": ["epub.draft"],
        "readany/minimumProfile": "editor",
      },
    });
    expect(tools.find((tool) => tool.name === "epub.export")).toMatchObject({
      description: expect.stringContaining("Minimum profile: publisher"),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
      _meta: {
        "readany/risk": "high",
        "readany/scopes": ["epub.export"],
        "readany/minimumProfile": "publisher",
      },
    });
  });

  it("exposes safety metadata for every registered MCP tool", async () => {
    const response = await handleMcpRequest({ method: "tools/list" }, "readonly", await createEnv());
    const exposedTools = new Map(
      (response as { tools: Array<Record<string, unknown>> }).tools.map((tool) => [
        tool.name,
        tool,
      ]),
    );

    expect(exposedTools.size).toBe(READANY_TOOLS.length);
    for (const registeredTool of READANY_TOOLS) {
      const exposedTool = exposedTools.get(registeredTool.name);
      const minimumProfile = getMinimumProfileForScopes(registeredTool.scopes);
      const destructiveHint =
        registeredTool.name.includes(".patch") ||
        registeredTool.name.endsWith(".discard") ||
        registeredTool.name.endsWith(".undo") ||
        registeredTool.name.endsWith(".export");

      expect(exposedTool, registeredTool.name).toMatchObject({
        description: expect.stringContaining(`Minimum profile: ${minimumProfile}`),
        annotations: {
          readOnlyHint: registeredTool.risk === "low",
          destructiveHint,
        },
        _meta: {
          "readany/risk": registeredTool.risk,
          "readany/scopes": registeredTool.scopes,
          "readany/minimumProfile": minimumProfile,
        },
      });
    }
  });

  it("calls a readonly tool", async () => {
    const env = await createEnv();
    await seedBook(env);
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "books.search",
          arguments: { query: "mcp" },
        },
      },
      "readonly",
      env,
    );

    expect(response).toMatchObject({ isError: false });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: {
        books: [{ id: "mcp-book", meta: { title: "MCP for Readers" } }],
      },
    });
  });

  it("searches library knowledge with bounded snippets", async () => {
    const env = await createEnv();
    await seedBook(env);

    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "knowledge.search",
          arguments: {
            query: "export",
            limit: 5,
            contentLimit: 40,
          },
        },
      },
      "readonly",
      env,
    );

    expect(response).toMatchObject({ isError: false });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: {
        knowledge: {
          query: "export",
          returned: expect.any(Number),
          results: expect.arrayContaining([
            expect.objectContaining({
              source: expect.stringMatching(/book|note|highlight/),
              reference: expect.objectContaining({
                bookId: "mcp-book",
              }),
            }),
          ]),
        },
      },
    });
  });

  it("calls readonly bookmark and skill discovery tools", async () => {
    const env = await createEnv();
    await seedBook(env);

    const bookmarksResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "bookmarks.list",
          arguments: { bookId: "mcp-book" },
        },
      },
      "readonly",
      env,
    );
    expect(bookmarksResponse).toMatchObject({ isError: false });
    const bookmarksText = (bookmarksResponse as { content: Array<{ text: string }> }).content[0]
      .text;
    expect(JSON.parse(bookmarksText)).toMatchObject({
      ok: true,
      data: {
        bookmarks: [
          {
            id: "mcp-bookmark",
            bookId: "mcp-book",
            label: "Return here",
            chapterTitle: "Agent Access",
          },
        ],
      },
    });

    const skillsResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "skills.list",
          arguments: {},
        },
      },
      "readonly",
      env,
    );
    expect(skillsResponse).toMatchObject({ isError: false });
    const skillsText = (skillsResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(skillsText)).toMatchObject({
      ok: true,
      data: {
        skills: [
          {
            id: "mcp-skill",
            name: "MCP Reviewer",
            enabled: true,
          },
        ],
      },
    });
  });

  it("reads the latest reader context snapshot", async () => {
    const env = await createEnv();
    await seedBook(env);
    await mkdir(join(env.READANY_HOME!, "readany-store"), { recursive: true });
    await writeFile(
      join(env.READANY_HOME!, "readany-store", "reader-context.json"),
      JSON.stringify({
        bookId: "mcp-book",
        bookTitle: "MCP for Readers",
        currentChapter: {
          index: 1,
          title: "Agent Access",
          href: "OPS/chapter-1.xhtml",
        },
        currentPosition: {
          cfi: "epubcfi(/6/20)",
          percentage: 0.5,
          page: 7,
        },
        selection: {
          text: "External agents should receive export metadata, not full exported files.",
          cfi: "epubcfi(/6/30)",
          chapterIndex: 1,
          chapterTitle: "Agent Access",
        },
        surroundingText:
          "External agents should receive export metadata, not full exported files. The reader is validating the access boundary.",
        recentHighlights: [
          {
            text: "MCP export should stay file-based.",
            cfi: "epubcfi(/6/28)",
            note: "Export boundary",
          },
        ],
        operationType: "selecting",
        timestamp: 1700000000000,
      }),
      "utf8",
    );

    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "context.get",
          arguments: { contentLimit: 24 },
        },
      },
      "readonly",
      env,
    );

    expect(response).toMatchObject({ isError: false });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: {
        readerContext: {
          available: true,
          context: {
            bookId: "mcp-book",
            selection: {
              text: "External agents should r",
            },
            surroundingText: "External agents should r",
            recentHighlights: [
              {
                text: "MCP export should stay f",
              },
            ],
          },
        },
      },
    });
  });

  it("gates notes.export by publisher profile and writes an export file", async () => {
    const env = await createEnv();
    await seedBook(env);
    const outputPath = join(env.READANY_HOME!, "exports", "mcp-notes.md");

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "notes.export",
          arguments: { bookId: "mcp-book", outputPath },
        },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const publisherResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "notes.export",
          arguments: { bookId: "mcp-book", outputPath, format: "markdown" },
        },
      },
      "publisher",
      env,
    );
    expect(publisherResponse).toMatchObject({ isError: false });
    const publisherText = (publisherResponse as { content: Array<{ text: string }> }).content[0]
      .text;
    expect(JSON.parse(publisherText)).toMatchObject({
      ok: true,
      data: {
        export: {
          bookId: "mcp-book",
          outputPath,
          format: "markdown",
          noteCount: 1,
          highlightCount: 1,
        },
      },
    });
    expect(publisherText).not.toContain("MCP export should stay file-based.");

    const exported = await readFile(outputPath, "utf8");
    expect(exported).toContain("# MCP for Readers");
    expect(exported).toContain("MCP export should stay file-based.");
    expect(exported).toContain("External agents should receive export metadata");
  });

  it("gates knowledge.export by publisher profile and writes an export file", async () => {
    const env = await createEnv();
    await seedBook(env);
    const outputPath = join(env.READANY_HOME!, "exports", "knowledge.md");

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "knowledge.export",
          arguments: { outputPath },
        },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const publisherResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "knowledge.export",
          arguments: { outputPath, format: "markdown" },
        },
      },
      "publisher",
      env,
    );
    expect(publisherResponse).toMatchObject({ isError: false });
    const publisherText = (publisherResponse as { content: Array<{ text: string }> }).content[0]
      .text;
    expect(JSON.parse(publisherText)).toMatchObject({
      ok: true,
      data: {
        export: {
          outputPath,
          format: "markdown",
          bookCount: 1,
          noteCount: 1,
          highlightCount: 1,
        },
      },
    });
    expect(publisherText).not.toContain("MCP export should stay file-based.");

    const exported = await readFile(outputPath, "utf8");
    expect(exported).toContain("# ReadAny Knowledge Export");
    expect(exported).toContain("## MCP for Readers");
    expect(exported).toContain("MCP export should stay file-based.");
    expect(exported).toContain("External agents should receive export metadata");
  });

  it("rejects missing arguments for unknown tools", async () => {
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.nope", arguments: {} },
      },
      "readonly",
      await createEnv(),
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "unknown_tool" },
    });
  });

  it("gates epub.undo by editor profile and restores a prior patch", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const patchResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.patch",
          arguments: {
            draftId,
            chapterId: "chapter-1",
            xhtml:
              `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>MCP Undo</h1><p>Undo this chapter patch.</p></body></html>`,
          },
        },
      },
      "editor",
      env,
    );
    expect(patchResponse).toMatchObject({ isError: false });
    const patchText = (patchResponse as { content: Array<{ text: string }> }).content[0].text;
    const operationId = (JSON.parse(patchText) as { data: { patch: { operationId: string } } }).data
      .patch.operationId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.undo", arguments: { draftId, operationId } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.undo", arguments: { draftId, operationId } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        undo: {
          draftId,
          bookId: "mcp-book",
          operationId,
          undoneAction: "epub.chapter.patch",
          resourcePath: "OPS/chapter-1.xhtml",
        },
      },
    });
  });

  it("rejects epub.undo without an operation id", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.undo", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("gates epub.inspect by editor profile", async () => {
    const env = await createEnv();
    await seedBook(env);

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.inspect", arguments: { bookId: "mcp-book" } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.inspect", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        epub: {
          bookId: "mcp-book",
          filePath: "books/mcp.epub",
          packagePath: "OPS/package.opf",
          metadata: {
            title: "MCP for Readers",
            creator: "Ada Reader",
          },
          toc: {
            count: 2,
            items: [{ label: "Agent Access" }, { label: "Draft Safety" }],
          },
        },
      },
    });
  });

  it("gates epub.draft.create by editor profile and creates a draft", async () => {
    const env = await createEnv();
    await seedBook(env);
    const sourcePath = join(env.READANY_HOME!, "books", "mcp.epub");
    const sourceBefore = await readFile(sourcePath);

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    const parsed = JSON.parse(editorText) as {
      ok: true;
      data: {
        draft: {
          draftFilePath: string;
          manifestPath: string;
          historyPath: string;
          sourceHash: string;
        };
      };
    };
    expect(parsed).toMatchObject({
      ok: true,
      data: {
        draft: {
          bookId: "mcp-book",
          sourceFilePath: "books/mcp.epub",
          draftFilePath: expect.stringMatching(/^drafts\/epub\/mcp-book-.+\/source\.epub$/),
          sourceHash: expect.any(String),
        },
      },
    });
    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    expect(await readFile(join(env.READANY_HOME!, parsed.data.draft.draftFilePath))).toEqual(
      sourceBefore,
    );
  });

  it("gates epub.chapter.read by editor profile and reads a draft chapter", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.read",
          arguments: { draftId, chapterId: "chapter-1" },
        },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.read",
          arguments: { draftId, chapterId: "chapter-1", contentLimit: 12 },
        },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        chapter: {
          source: "draft",
          draftId,
          bookId: "mcp-book",
          id: "chapter-1",
          href: "chapter-1.xhtml",
          contentFormat: "text",
          content: "Agent Access",
        },
      },
    });

    const xhtmlResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.read",
          arguments: { draftId, chapterId: "chapter-1", contentFormat: "xhtml" },
        },
      },
      "editor",
      env,
    );
    expect(xhtmlResponse).toMatchObject({ isError: false });
    const xhtmlText = (xhtmlResponse as { content: Array<{ text: string }> }).content[0].text;
    const xhtmlParsed = JSON.parse(xhtmlText) as { data: { chapter: { content: string } } };
    expect(xhtmlParsed).toMatchObject({
      ok: true,
      data: {
        chapter: {
          contentFormat: "xhtml",
          contentTruncated: false,
        },
      },
    });
    expect(xhtmlParsed.data.chapter.content).toContain("<body>Agent Access</body>");
  });

  it("gates epub.draft.discard by editor profile and discards a draft", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.discard", arguments: { draftId } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.discard", arguments: { draftId, reason: "no longer needed" } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        discarded: {
          draftId,
          bookId: "mcp-book",
          status: "discarded",
        },
      },
    });
  });

  it("gates epub.chapter.patch by editor profile and patches a draft chapter", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.patch",
          arguments: {
            draftId,
            chapterId: "chapter-1",
            xhtml:
              `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Agent Updated</h1><p>Patched by MCP.</p></body></html>`,
          },
        },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.patch",
          arguments: {
            draftId,
            chapterId: "chapter-1",
            xhtml:
              `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Agent Updated</h1><p>Patched by MCP.</p></body></html>`,
          },
        },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        patch: {
          draftId,
          bookId: "mcp-book",
          chapterId: "chapter-1",
          href: "chapter-1.xhtml",
          resourcePath: "OPS/chapter-1.xhtml",
          changed: true,
          title: "Agent Updated",
        },
      },
    });
  });

  it("gates epub.chapters.patch and applies batch patches through draft history", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;
    const patches = [
      {
        chapterId: "chapter-1",
        xhtml:
          '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Batch Agent Access</h1><p>First MCP batch patch.</p></body></html>',
      },
      {
        chapterId: "chapter-2",
        xhtml:
          '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Batch Draft Safety</h1><p>Second MCP batch patch.</p></body></html>',
      },
    ];

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapters.patch",
          arguments: { draftId, patches },
        },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapters.patch",
          arguments: { draftId, patches },
        },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        batch: {
          draftId,
          bookId: "mcp-book",
          requestedCount: 2,
          patchedCount: 2,
          changedCount: 2,
          patches: [
            { chapterId: "chapter-1", title: "Batch Agent Access" },
            { chapterId: "chapter-2", title: "Batch Draft Safety" },
          ],
        },
      },
    });

    const historyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.history", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(historyResponse).toMatchObject({ isError: false });
    const historyText = (historyResponse as { content: Array<{ text: string }> }).content[0].text;
    const history = JSON.parse(historyText) as {
      data: { history: { entries: Array<{ action: string; chapterId?: string }> } };
    };
    expect(history.data.history.entries.slice(-2)).toMatchObject([
      { action: "epub.chapter.patch", chapterId: "chapter-1" },
      { action: "epub.chapter.patch", chapterId: "chapter-2" },
    ]);
  });

  it("gates epub.metadata.patch by editor profile and patches draft metadata", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.metadata.patch",
          arguments: {
            draftId,
            metadata: { title: "MCP Metadata Revised" },
          },
        },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.metadata.patch",
          arguments: {
            draftId,
            metadata: {
              title: "MCP Metadata Revised",
              creator: "Ada Editor",
              subjects: ["AI", "MCP"],
            },
          },
        },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        metadata: {
          draftId,
          bookId: "mcp-book",
          packagePath: "OPS/package.opf",
          changed: true,
          metadata: {
            title: "MCP Metadata Revised",
            creator: "Ada Editor",
            subjects: ["AI", "MCP"],
          },
        },
      },
    });
  });

  it("rejects epub.metadata.patch without a metadata object", async () => {
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.metadata.patch",
          arguments: { draftId: "draft-1", metadata: "title" },
        },
      },
      "editor",
      await createEnv(),
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("rejects unknown nested epub.metadata.patch fields", async () => {
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.metadata.patch",
          arguments: {
            draftId: "draft-1",
            metadata: {
              title: "MCP Metadata Revised",
              rawXml: "<package/>",
            },
          },
        },
      },
      "editor",
      await createEnv(),
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("gates epub.toc.rebuild by editor profile and rebuilds draft toc", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.toc.rebuild", arguments: { draftId } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.toc.rebuild", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        toc: {
          draftId,
          bookId: "mcp-book",
          navPath: "OPS/nav.xhtml",
          itemCount: 2,
        },
      },
    });
  });

  it("gates epub.history by editor profile and returns draft operations", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.history", arguments: { draftId } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.history", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        history: {
          draftId,
          bookId: "mcp-book",
          entries: [{ action: "epub.draft.create", draftId }],
        },
      },
    });
  });

  it("gates epub.diff by editor profile and returns draft resource changes", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const patchResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.patch",
          arguments: {
            draftId,
            chapterId: "chapter-1",
            xhtml:
              `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Diffed Agent Access</h1><p>MCP diff changed this chapter.</p></body></html>`,
          },
        },
      },
      "editor",
      env,
    );
    expect(patchResponse).toMatchObject({ isError: false });

    const readonlyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.diff", arguments: { draftId } },
      },
      "readonly",
      env,
    );
    expect(readonlyResponse).toMatchObject({ isError: true });
    const readonlyText = (readonlyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(readonlyText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.diff", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: false });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: true,
      data: {
        diff: {
          draftId,
          bookId: "mcp-book",
          changedCount: 1,
          entries: expect.arrayContaining([
            expect.objectContaining({
              path: "OPS/chapter-1.xhtml",
              status: "modified",
            }),
          ]),
        },
      },
    });
  });

  it("gates epub.validate by publisher profile and validates a draft", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.validate", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: true });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const publisherResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.validate", arguments: { draftId } },
      },
      "publisher",
      env,
    );
    expect(publisherResponse).toMatchObject({ isError: false });
    const publisherText = (publisherResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(publisherText)).toMatchObject({
      ok: true,
      data: {
        validation: {
          draftId,
          bookId: "mcp-book",
          valid: true,
          errorCount: 0,
          issues: [],
        },
      },
    });
    expect(String(publisherText)).not.toContain(env.READANY_HOME);
  });

  it("gates epub.export by publisher profile and writes a new EPUB", async () => {
    const env = await createEnv();
    await seedBook(env);
    const sourcePath = join(env.READANY_HOME!, "books", "mcp.epub");
    const sourceBytes = await readFile(sourcePath);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;
    const outputPath = join(env.READANY_HOME!, "..", "exports", "mcp-export.epub");

    const editorResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.export", arguments: { draftId, outputPath } },
      },
      "editor",
      env,
    );
    expect(editorResponse).toMatchObject({ isError: true });
    const editorText = (editorResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(editorText)).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const publisherResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.export", arguments: { draftId, outputPath } },
      },
      "publisher",
      env,
    );
    expect(publisherResponse).toMatchObject({ isError: false });
    const publisherText = (publisherResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(publisherText)).toMatchObject({
      ok: true,
      data: {
        export: {
          draftId,
          bookId: "mcp-book",
          outputPath,
          outputHash: expect.any(String),
          outputSize: sourceBytes.byteLength,
          validation: {
            valid: true,
          },
        },
      },
    });
    expect(await readFile(outputPath)).toEqual(sourceBytes);
    expect(await readFile(sourcePath)).toEqual(sourceBytes);

    const secondResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.export", arguments: { draftId, outputPath } },
      },
      "publisher",
      env,
    );
    expect(secondResponse).toMatchObject({ isError: true });
    const secondText = (secondResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(secondText)).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });

  });

  it("refuses to export invalid drafts through MCP without writing output", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draft = (JSON.parse(createText) as {
      data: { draft: { draftId: string; draftFilePath: string } };
    }).data.draft;
    await writeFile(join(env.READANY_HOME!, draft.draftFilePath), buildInvalidMissingResourceEpub());

    const validateResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.validate", arguments: { draftId: draft.draftId } },
      },
      "publisher",
      env,
    );
    const validateText = (validateResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(validateText)).toMatchObject({
      ok: true,
      data: {
        validation: {
          valid: false,
          errorCount: 1,
          issues: [
            {
              code: "manifest_resource_missing",
              path: "OPS/missing.xhtml",
            },
          ],
        },
      },
    });

    const outputPath = join(env.READANY_HOME!, "..", "exports", "invalid-mcp-export.epub");
    const exportResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.export", arguments: { draftId: draft.draftId, outputPath } },
      },
      "publisher",
      env,
    );
    expect(exportResponse).toMatchObject({ isError: true });
    const exportText = (exportResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(exportText)).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
    expect(exportText).toMatch(/validation failed/i);
    await expect(readFile(outputPath)).rejects.toThrow();
  });

  it("blocks draft reads after discard", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const discardResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.discard", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(discardResponse).toMatchObject({ isError: false });

    const historyResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.history", arguments: { draftId } },
      },
      "editor",
      env,
    );
    expect(historyResponse).toMatchObject({ isError: false });
    const historyText = (historyResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(historyText)).toMatchObject({
      ok: true,
      data: {
        history: {
          draftId,
          status: "discarded",
          entries: [
            expect.objectContaining({ action: "epub.draft.create" }),
            expect.objectContaining({ action: "epub.draft.discard" }),
          ],
        },
      },
    });

    const chapterResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.chapter.read", arguments: { draftId, chapterId: "chapter-1" } },
      },
      "editor",
      env,
    );
    expect(chapterResponse).toMatchObject({ isError: true });
    const chapterText = (chapterResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(chapterText)).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
    expect(String(chapterText)).toMatch(/discarded/i);
  });


  it("calls rag.search with readonly profile", async () => {
    const env = await createEnv();
    await seedBook(env);
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "rag.search",
          arguments: { query: "external agents", bookId: "mcp-book", limit: 1 },
        },
      },
      "readonly",
      env,
    );

    expect(response).toMatchObject({ isError: false });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: {
        results: [
          {
            matchType: "bm25",
            chunk: {
              id: "mcp-chunk-1",
              bookId: "mcp-book",
              chapterTitle: "Agent Access",
              startCfi: "epubcfi(/6/20)",
            },
          },
        ],
      },
    });
  });

  it("calls chapters list and get with readonly profile", async () => {
    const env = await createEnv();
    await seedBook(env);

    const listResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "chapters.list",
          arguments: { bookId: "mcp-book" },
        },
      },
      "readonly",
      env,
    );
    expect(listResponse).toMatchObject({ isError: false });
    const listText = (listResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(listText)).toMatchObject({
      ok: true,
      data: {
        chapters: [
          {
            id: "1",
            title: "Agent Access",
            startCfi: "epubcfi(/6/20)",
            chunkCount: 2,
          },
          {
            id: "2",
            title: "Draft Safety",
            startCfi: "epubcfi(/6/24)",
          },
        ],
      },
    });

    const getResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "chapters.get",
          arguments: { bookId: "mcp-book", chapterId: "1", chunkStart: 2, chunkCount: 1 },
        },
      },
      "readonly",
      env,
    );
    expect(getResponse).toMatchObject({ isError: false });
    const getText = (getResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(getText)).toMatchObject({
      ok: true,
      data: {
        chapter: {
          id: "1",
          totalChunkCount: 2,
          returnedChunkCount: 1,
          chunkStart: 2,
          rangeTruncated: true,
          content: "Chunk range controls keep MCP chapter reads bounded.",
          chunks: [{ id: "mcp-chunk-1b" }],
        },
      },
    });
  });

  it("falls back to epub chapters when no chunks are indexed", async () => {
    const env = await createEnv();
    await resetCoreForTests();
    await ensureCoreInitialized(env);
    const db = new Database(join(env.READANY_HOME!, "readany.db"));
    db.exec(`
      INSERT INTO books (
        id, file_path, format, title, author, publisher, language, isbn, description,
        cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
        group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
        is_vectorized, vectorize_progress, tags, file_hash, sync_status
      ) VALUES (
        'fallback-book', 'books/fallback.epub', 'epub', 'Fallback Book', 'Ada Reader', NULL, 'en',
        NULL, 'Fallback epub only', NULL, NULL, NULL, NULL, '["AI"]',
        100, 1, NULL, 1000, 2000, 3000, NULL, 0.5, 'epubcfi(/6/2)', 0, 0,
        '["epub"]', 'hash-fallback', 'local'
      );
    `);
    db.close();
    await writeFile(join(env.READANY_HOME!, "books", "fallback.epub"), buildInspectableEpub());

    const listResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "chapters.list",
          arguments: { bookId: "fallback-book" },
        },
      },
      "readonly",
      env,
    );
    expect(listResponse).toMatchObject({ isError: false });
    const listText = (listResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(listText)).toMatchObject({
      ok: true,
      data: {
        chapters: [
          {
            source: "epub",
            id: "chapter-1",
            title: "Agent Access",
            href: "chapter-1.xhtml",
          },
          {
            source: "epub",
            id: "chapter-2",
            title: "Draft Safety",
            href: "chapter-2.xhtml",
          },
        ],
      },
    });

    const getResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "chapters.get",
          arguments: { bookId: "fallback-book", chapterId: "chapter-1" },
        },
      },
      "readonly",
      env,
    );
    expect(getResponse).toMatchObject({ isError: false });
    const getText = (getResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(getText)).toMatchObject({
      ok: true,
      data: {
        chapter: {
          source: "book",
          bookId: "fallback-book",
          id: "chapter-1",
          content: "Agent Access",
        },
      },
    });
  });

  it("falls back to pdf pages when no chunks are indexed", async () => {
    const env = await createEnv();
    await resetCoreForTests();
    await ensureCoreInitialized(env);
    const db = new Database(join(env.READANY_HOME!, "readany.db"));
    db.exec(`
      INSERT INTO books (
        id, file_path, format, title, author, publisher, language, isbn, description,
        cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
        group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
        is_vectorized, vectorize_progress, tags, file_hash, sync_status
      ) VALUES (
        'pdf-fallback-book', 'books/pdf-fallback.pdf', 'pdf', 'Fallback PDF', 'Ada Reader', NULL, 'en',
        NULL, 'Fallback pdf only', NULL, NULL, NULL, NULL, '["AI"]',
        2, 2, NULL, 1000, 2000, 3000, NULL, 0.5, 'page:1', 0, 0,
        '["pdf"]', 'hash-pdf-fallback', 'local'
      );
    `);
    db.close();
    await writeFile(
      join(env.READANY_HOME!, "books", "pdf-fallback.pdf"),
      buildSimplePdf(["PDF fallback agents", "Second page for fallback"]),
    );

    const listResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "chapters.list",
          arguments: { bookId: "pdf-fallback-book" },
        },
      },
      "readonly",
      env,
    );
    expect(listResponse).toMatchObject({ isError: false });
    const listText = (listResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(listText)).toMatchObject({
      ok: true,
      data: {
        chapters: [
          { source: "pdf", id: "page-1", title: "Page 1", page: 1 },
          { source: "pdf", id: "page-2", title: "Page 2", page: 2 },
        ],
      },
    });

    const getResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "chapters.get",
          arguments: { bookId: "pdf-fallback-book", chapterId: "page-1" },
        },
      },
      "readonly",
      env,
    );
    expect(getResponse).toMatchObject({ isError: false });
    const getText = (getResponse as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(getText)).toMatchObject({
      ok: true,
      data: {
        chapter: {
          source: "pdf",
          bookId: "pdf-fallback-book",
          id: "page-1",
          content: "PDF fallback agents",
          cfi: "page:1",
        },
      },
    });
  });

  it("rejects rag.search without a book id", async () => {
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "rag.search",
          arguments: { query: "external agents" },
        },
      },
      "readonly",
      await createEnv(),
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("rejects tool arguments outside the registered schema", async () => {
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "books.search",
          arguments: { query: "mcp", rawSql: "select * from books" },
        },
      },
      "readonly",
      await createEnv(),
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("rejects undeclared arguments for every registered tool", async () => {
    const env = await createEnv();

    for (const tool of READANY_TOOLS) {
      const response = await handleMcpRequest(
        {
          method: "tools/call",
          params: {
            name: tool.name,
            arguments: { __readanyUnexpected: true },
          },
        },
        "admin",
        env,
      );

      expect(response, tool.name).toMatchObject({ isError: true });
      const text = (response as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text), tool.name).toMatchObject({
        ok: false,
        error: { code: "invalid_tool_arguments" },
      });
    }
  });

  it("rejects non-object MCP tool arguments", async () => {
    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "books.search",
          arguments: "query=mcp",
        },
      },
      "readonly",
      await createEnv(),
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("rejects invalid nested batch patch arguments", async () => {
    const env = await createEnv();
    const cases = [
      {
        patches: [],
        message: "empty patches",
      },
      {
        patches: [
          {
            chapterId: "chapter-1",
            xhtml: "<html><body>Updated</body></html>",
            rawSql: "select * from books",
          },
        ],
        message: "unknown nested field",
      },
    ];

    for (const item of cases) {
      const response = await handleMcpRequest(
        {
          method: "tools/call",
          params: {
            name: "epub.chapters.patch",
            arguments: {
              draftId: "draft-1",
              patches: item.patches,
            },
          },
        },
        "editor",
        env,
      );

      expect(response, item.message).toMatchObject({ isError: true });
      const text = (response as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text), item.message).toMatchObject({
        ok: false,
        error: { code: "invalid_tool_arguments" },
      });
    }
  });

  it("rejects epub.chapter.patch without xhtml", async () => {
    const env = await createEnv();
    await seedBook(env);
    const createResponse = await handleMcpRequest(
      {
        method: "tools/call",
        params: { name: "epub.draft.create", arguments: { bookId: "mcp-book" } },
      },
      "editor",
      env,
    );
    const createText = (createResponse as { content: Array<{ text: string }> }).content[0].text;
    const draftId = (JSON.parse(createText) as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const response = await handleMcpRequest(
      {
        method: "tools/call",
        params: {
          name: "epub.chapter.patch",
          arguments: { draftId, chapterId: "chapter-1" },
        },
      },
      "editor",
      env,
    );

    expect(response).toMatchObject({ isError: true });
    const text = (response as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({
      ok: false,
      error: { code: "invalid_tool_arguments" },
    });
  });

  it("enforces tool argument schema limits", async () => {
    const env = await createEnv();
    const cases = [
      {
        name: "books.search",
        arguments: { query: "   " },
        message: "empty string",
      },
      {
        name: "books.list",
        arguments: { limit: 1000 },
        message: "number maximum",
      },
      {
        name: "rag.search",
        arguments: { query: "mcp", bookId: "mcp-book", mode: "semantic" },
        message: "enum value",
      },
      {
        name: "notes.export",
        arguments: { bookId: "mcp-book", outputPath: "notes.md", format: "xml" },
        message: "export format enum",
        profile: "publisher",
      },
    ];

    for (const item of cases) {
      const response = await handleMcpRequest(
        {
          method: "tools/call",
          params: {
            name: item.name,
            arguments: item.arguments,
          },
        },
        item.profile ?? "readonly",
        env,
      );

      expect(response, item.message).toMatchObject({ isError: true });
      const text = (response as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text), item.message).toMatchObject({
        ok: false,
        error: { code: "invalid_tool_arguments" },
      });
    }
  });

  it("rejects tools when the profile is missing required scopes", async () => {
    const temporaryTool = {
      name: "test.admin.backup",
      description: "Test admin-only tool.",
      scopes: ["admin.backup"],
      risk: "high",
      inputSchema: {
        type: "object",
        additionalProperties: false,
      },
    } as const;
    (READANY_TOOLS as unknown as typeof temporaryTool[]).push(temporaryTool);

    try {
      const response = await handleMcpRequest(
        {
          method: "tools/call",
          params: { name: temporaryTool.name, arguments: {} },
        },
        "readonly",
        await createEnv(),
      );

      expect(response).toMatchObject({ isError: true });
      const text = (response as { content: Array<{ text: string }> }).content[0].text;
      expect(JSON.parse(text)).toMatchObject({
        ok: false,
        error: { code: "permission_denied" },
      });
    } finally {
      (READANY_TOOLS as unknown as typeof temporaryTool[]).pop();
    }
  });
});
