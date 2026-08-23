import { stdin as input, stdout as output } from "node:process";
import type { Readable, Writable } from "node:stream";
import type { CommandResult } from "./result.js";
import { failure, success } from "./result.js";
import type { AccessProfile, PermissionScope } from "./profiles.js";
import { getMinimumProfileForScopes, parseAccessProfile, profileHasScope } from "./profiles.js";
import { isRagSearchMode } from "./rag-config.js";
import { listTools } from "./tool-registry.js";
import type { ReadAnyTool } from "./tool-registry.js";
import {
  diffEpubDraftWorkspace,
  discardEpubDraftWorkspace,
  exportEpubDraftWorkspace,
  exportBookNotesWorkspace,
  exportKnowledgeWorkspace,
  getBookById,
  getEpubDraftHistory,
  getReaderContextSnapshot,
  getIndexedChapter,
  listBookmarks,
  listIndexedChapters,
  listBooks,
  listHighlights,
  listNotes,
  listSkills,
  createEpubDraftForBook,
  inspectEpubBook,
  patchEpubChapter,
  patchEpubChapters,
  patchEpubMetadata,
  readEpubChapter,
  rebuildEpubTocWorkspace,
  searchRag,
  searchBooks,
  searchKnowledgeWorkspace,
  undoEpubDraftWorkspace,
  validateEpubDraftWorkspace,
} from "./data.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type McpRequestEnvelope = {
  request: JsonRpcRequest;
  framing: "header" | "line";
};

type ToolCallParams = {
  name?: string;
  arguments?: unknown;
};

type ToolPropertySchema = {
  type?: unknown;
  minLength?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  minItems?: unknown;
  maxItems?: unknown;
  enum?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  items?: unknown;
};

function getEpubChapterReadFormat(args: Record<string, unknown>): "text" | "xhtml" {
  const value = args.contentFormat;
  return value === "xhtml" ? "xhtml" : "text";
}

function toMcpTool(tool: ReturnType<typeof listTools>[number]) {
  const minimumProfile = getMinimumProfileForScopes(tool.scopes);
  const safetySummary = `Risk: ${tool.risk}. Minimum profile: ${minimumProfile}. Required scopes: ${tool.scopes.join(", ")}.`;
  const destructiveHint =
    tool.name.includes(".patch") ||
    tool.name.endsWith(".discard") ||
    tool.name.endsWith(".undo") ||
    tool.name.endsWith(".export");
  return {
    name: tool.name,
    description: `${tool.description}\n\n${safetySummary}`,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.risk === "low",
      destructiveHint,
    },
    _meta: {
      "readany/risk": tool.risk,
      "readany/scopes": tool.scopes,
      "readany/minimumProfile": minimumProfile,
    },
  };
}

function parseArgs(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object") return {};
  return params as Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isNotesExportFormat(value: string): value is "markdown" | "json" | "obsidian" | "notion" {
  return value === "markdown" || value === "json" || value === "obsidian" || value === "notion";
}

function isKnowledgeExportFormat(value: string): value is "markdown" | "json" | "obsidian" {
  return value === "markdown" || value === "json" || value === "obsidian";
}

function getLimit(args: Record<string, unknown>, fallback: number): number {
  return getNumber(args, "limit", fallback);
}

function getNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (typeof value !== "number") return fallback;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertToolAllowed(profile: AccessProfile, scopes: PermissionScope[]): CommandResult<void> {
  const missingScopes = scopes.filter((scope) => !profileHasScope(profile, scope));
  if (missingScopes.length > 0) {
    return failure(
      "permission_denied",
      `Profile '${profile}' is missing required scopes: ${missingScopes.join(", ")}`,
    );
  }
  return success(undefined);
}

function validateToolArguments(
  tool: ReadAnyTool,
  args: Record<string, unknown>,
): CommandResult<void> {
  const invalid = validateObjectSchema(tool.name, tool.inputSchema, args);
  return invalid ?? success(undefined);
}

function validateObjectSchema(
  path: string,
  schema: ToolPropertySchema,
  value: Record<string, unknown>,
): CommandResult<never> | undefined {
  const properties = schema.properties ?? {};
  const allowedKeys = new Set(Object.keys(properties));
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));

  if (schema.additionalProperties === false && unknownKeys.length > 0) {
    return failure(
      "invalid_tool_arguments",
      `Unknown arguments for ${path}: ${unknownKeys.join(", ")}`,
    );
  }

  for (const key of schema.required ?? []) {
    if (!(key in value)) {
      return failure("invalid_tool_arguments", `${path} requires argument: ${key}`);
    }
  }

  for (const [key, childValue] of Object.entries(value)) {
    const schema = properties[key];
    if (!schema || typeof schema !== "object" || !("type" in schema)) continue;
    const typedSchema = schema as ToolPropertySchema;
    const invalid = validateValueSchema(`${path}.${key}`, typedSchema, childValue);
    if (invalid) return invalid;
  }

  return undefined;
}

function validateValueSchema(
  path: string,
  schema: ToolPropertySchema,
  value: unknown,
): CommandResult<never> | undefined {
  const type = schema.type;
  if (type === "string" && typeof value !== "string") {
    return failure("invalid_tool_arguments", `${path} must be a string`);
  }
  if (
    type === "string" &&
    typeof value === "string" &&
    typeof schema.minLength === "number" &&
    value.trim().length < schema.minLength
  ) {
    return failure(
      "invalid_tool_arguments",
      `${path} must be at least ${schema.minLength} characters`,
    );
  }
  if (type === "number" && typeof value !== "number") {
    return failure("invalid_tool_arguments", `${path} must be a number`);
  }
  if (type === "boolean" && typeof value !== "boolean") {
    return failure("invalid_tool_arguments", `${path} must be a boolean`);
  }
  if (type === "object") {
    if (!isPlainRecord(value)) {
      return failure("invalid_tool_arguments", `${path} must be an object`);
    }
    return validateObjectSchema(path, schema, value);
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      return failure("invalid_tool_arguments", `${path} must be an array`);
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return failure(
        "invalid_tool_arguments",
        `${path} must contain at least ${schema.minItems} items`,
      );
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return failure(
        "invalid_tool_arguments",
        `${path} must contain at most ${schema.maxItems} items`,
      );
    }
    if (schema.items && typeof schema.items === "object") {
      for (const [index, item] of value.entries()) {
        const invalid = validateValueSchema(
          `${path}[${index}]`,
          schema.items as ToolPropertySchema,
          item,
        );
        if (invalid) return invalid;
      }
    }
  }
  if (
    type === "number" &&
    typeof value === "number" &&
    typeof schema.minimum === "number" &&
    value < schema.minimum
  ) {
    return failure(
      "invalid_tool_arguments",
      `${path} must be greater than or equal to ${schema.minimum}`,
    );
  }
  if (
    type === "number" &&
    typeof value === "number" &&
    typeof schema.maximum === "number" &&
    value > schema.maximum
  ) {
    return failure(
      "invalid_tool_arguments",
      `${path} must be less than or equal to ${schema.maximum}`,
    );
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((allowedValue) => allowedValue === value)) {
    return failure("invalid_tool_arguments", `${path} must be one of: ${schema.enum.join(", ")}`);
  }

  return undefined;
}

async function callReadAnyTool(
  profile: AccessProfile,
  toolName: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const tool = listTools().find((item) => item.name === toolName);
  if (!tool) {
    return failure("unknown_tool", `Unknown ReadAny tool: ${toolName}`);
  }

  const allowed = assertToolAllowed(profile, tool.scopes);
  if (!allowed.ok) return allowed;

  const validArguments = validateToolArguments(tool, args);
  if (!validArguments.ok) return validArguments;

  if (toolName === "books.list") {
    return success({ books: await listBooks(getLimit(args, 50), env) });
  }

  if (toolName === "books.search") {
    const query = getString(args, "query");
    if (!query) return failure("missing_query", "books.search requires query");
    return success({ books: await searchBooks(query, getLimit(args, 20), env) });
  }

  if (toolName === "books.get") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "books.get requires bookId");
    return success({ book: await getBookById(bookId, env) });
  }

  if (toolName === "chapters.list") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "chapters.list requires bookId");
    return success({ chapters: await listIndexedChapters({ bookId, env }) });
  }

  if (toolName === "chapters.get") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "chapters.get requires bookId");
    const chapterId = getString(args, "chapterId");
    if (!chapterId) return failure("missing_chapter_id", "chapters.get requires chapterId");
    const chapter = await getIndexedChapter({
      bookId,
      chapterId,
      chunkStart: getNumber(args, "chunkStart", 1),
      chunkCount:
        typeof args.chunkCount === "number" &&
        Number.isFinite(args.chunkCount) &&
        args.chunkCount > 0
          ? Math.floor(args.chunkCount)
          : undefined,
      contentLimit: getNumber(args, "contentLimit", 12000),
      env,
    });
    if (!chapter) {
      return failure("chapter_not_found", `Chapter ${chapterId} was not found in ${bookId}`);
    }
    return success({ chapter });
  }

  if (toolName === "context.get") {
    return success({
      readerContext: await getReaderContextSnapshot({
        includeSelection: typeof args.includeSelection === "boolean" ? args.includeSelection : true,
        includeSurroundingText:
          typeof args.includeSurroundingText === "boolean" ? args.includeSurroundingText : true,
        includeHighlights:
          typeof args.includeHighlights === "boolean" ? args.includeHighlights : true,
        contentLimit: getNumber(args, "contentLimit", 12000),
        env,
      }),
    });
  }

  if (toolName === "bookmarks.list") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "bookmarks.list requires bookId");
    return success({ bookmarks: await listBookmarks(bookId, env) });
  }

  if (toolName === "skills.list") {
    return success({ skills: await listSkills(env) });
  }

  if (toolName === "notes.search") {
    const query = getString(args, "query");
    if (!query) return failure("missing_query", "notes.search requires query");
    return success({
      notes: await listNotes({
        query,
        bookId: getString(args, "bookId"),
        limit: getLimit(args, 50),
        env,
      }),
    });
  }

  if (toolName === "notes.export") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "notes.export requires bookId");
    const outputPath = getString(args, "outputPath");
    if (!outputPath) return failure("missing_output_path", "notes.export requires outputPath");
    const format = getString(args, "format") ?? "markdown";
    if (!isNotesExportFormat(format)) {
      return failure(
        "unsupported_notes_export_format",
        "notes.export format must be markdown, json, obsidian, or notion",
      );
    }
    const exported = await exportBookNotesWorkspace({
      bookId,
      outputPath,
      format,
      overwrite: args.overwrite === true,
      env,
    });
    return success({ export: exported });
  }

  if (toolName === "knowledge.export") {
    const outputPath = getString(args, "outputPath");
    if (!outputPath) return failure("missing_output_path", "knowledge.export requires outputPath");
    const format = getString(args, "format") ?? "markdown";
    if (!isKnowledgeExportFormat(format)) {
      return failure(
        "unsupported_knowledge_export_format",
        "knowledge.export format must be markdown, json, or obsidian",
      );
    }
    const exported = await exportKnowledgeWorkspace({
      outputPath,
      format,
      overwrite: args.overwrite === true,
      includeBooks: typeof args.includeBooks === "boolean" ? args.includeBooks : undefined,
      includeNotes: typeof args.includeNotes === "boolean" ? args.includeNotes : undefined,
      includeHighlights:
        typeof args.includeHighlights === "boolean" ? args.includeHighlights : undefined,
      limit: getNumber(args, "limit", 1000),
      env,
    });
    return success({ export: exported });
  }

  if (toolName === "knowledge.search") {
    const query = getString(args, "query");
    if (!query) return failure("missing_query", "knowledge.search requires query");
    return success({
      knowledge: await searchKnowledgeWorkspace({
        query,
        bookId: getString(args, "bookId"),
        limit: getLimit(args, 20),
        contentLimit: getNumber(args, "contentLimit", 240),
        scanLimit: getNumber(args, "scanLimit", 1000),
        includeBooks: typeof args.includeBooks === "boolean" ? args.includeBooks : undefined,
        includeNotes: typeof args.includeNotes === "boolean" ? args.includeNotes : undefined,
        includeHighlights:
          typeof args.includeHighlights === "boolean" ? args.includeHighlights : undefined,
        env,
      }),
    });
  }

  if (toolName === "highlights.search") {
    const query = getString(args, "query");
    if (!query) return failure("missing_query", "highlights.search requires query");
    return success({
      highlights: await listHighlights({
        query,
        bookId: getString(args, "bookId"),
        limit: getLimit(args, 50),
        env,
      }),
    });
  }

  if (toolName === "rag.search") {
    const query = getString(args, "query");
    if (!query) return failure("missing_query", "rag.search requires query");
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "rag.search requires bookId");
    const mode = getString(args, "mode") ?? "bm25";
    if (!isRagSearchMode(mode)) {
      return failure("unsupported_rag_mode", "mode must be bm25, hybrid, or vector");
    }
    return success({
      results: await searchRag({
        query,
        bookId,
        mode,
        limit: getLimit(args, 5),
        env,
      }),
    });
  }

  if (toolName === "epub.inspect") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "epub.inspect requires bookId");
    const inspect = await inspectEpubBook(bookId, env);
    if (!inspect) return failure("book_not_found", `Book ${bookId} was not found`);
    return success({ epub: inspect });
  }

  if (toolName === "epub.draft.create") {
    const bookId = getString(args, "bookId");
    if (!bookId) return failure("missing_book_id", "epub.draft.create requires bookId");
    const draft = await createEpubDraftForBook(bookId, env);
    if (!draft) return failure("book_not_found", `Book ${bookId} was not found`);
    return success({ draft });
  }

  if (toolName === "epub.draft.discard") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.draft.discard requires draftId");
    const reason = getString(args, "reason");
    const discarded = await discardEpubDraftWorkspace({ draftId, reason, env });
    return success({ discarded });
  }

  if (toolName === "epub.chapter.read") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.chapter.read requires draftId");
    const chapterId = getString(args, "chapterId");
    if (!chapterId) return failure("missing_chapter_id", "epub.chapter.read requires chapterId");
    const chapter = await readEpubChapter({
      draftId,
      chapterId,
      contentLimit: getNumber(args, "contentLimit", 12000),
      contentFormat: getEpubChapterReadFormat(args),
      env,
    });
    if (!chapter) return failure("chapter_not_found", `Chapter ${chapterId} was not found`);
    return success({ chapter });
  }

  if (toolName === "epub.chapter.patch") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.chapter.patch requires draftId");
    const chapterId = getString(args, "chapterId");
    if (!chapterId) return failure("missing_chapter_id", "epub.chapter.patch requires chapterId");
    const xhtml = getString(args, "xhtml");
    if (!xhtml) return failure("missing_xhtml", "epub.chapter.patch requires xhtml");
    const patch = await patchEpubChapter({
      draftId,
      chapterId,
      xhtml,
      env,
    });
    return success({ patch });
  }

  if (toolName === "epub.chapters.patch") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.chapters.patch requires draftId");
    const patches = args.patches as Array<{ chapterId: string; xhtml: string }>;
    const result = await patchEpubChapters({
      draftId,
      patches,
      env,
    });
    return success({ batch: result });
  }

  if (toolName === "epub.metadata.patch") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.metadata.patch requires draftId");
    const metadata = args.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return failure("invalid_tool_arguments", "epub.metadata.patch requires metadata object");
    }
    const patch = metadata as {
      title?: string;
      creator?: string;
      language?: string;
      publisher?: string;
      description?: string;
      modified?: string;
      subjects?: string[];
    };
    const result = await patchEpubMetadata({
      draftId,
      patch,
      env,
    });
    return success({ metadata: result });
  }

  if (toolName === "epub.toc.rebuild") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.toc.rebuild requires draftId");
    const toc = await rebuildEpubTocWorkspace(draftId, env);
    return success({ toc });
  }

  if (toolName === "epub.history") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.history requires draftId");
    const history = await getEpubDraftHistory(draftId, env);
    return success({ history });
  }

  if (toolName === "epub.diff") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.diff requires draftId");
    const diff = await diffEpubDraftWorkspace(draftId, env);
    return success({ diff });
  }

  if (toolName === "epub.undo") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.undo requires draftId");
    const operationId = getString(args, "operationId");
    if (!operationId) return failure("missing_operation_id", "epub.undo requires operationId");
    const undo = await undoEpubDraftWorkspace({
      draftId,
      operationId,
      env,
    });
    return success({ undo });
  }

  if (toolName === "epub.validate") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.validate requires draftId");
    const validation = await validateEpubDraftWorkspace(draftId, env);
    return success({ validation });
  }

  if (toolName === "epub.export") {
    const draftId = getString(args, "draftId");
    if (!draftId) return failure("missing_draft_id", "epub.export requires draftId");
    const outputPath = getString(args, "outputPath");
    if (!outputPath) return failure("missing_output_path", "epub.export requires outputPath");
    const exported = await exportEpubDraftWorkspace({
      draftId,
      outputPath,
      overwrite: args.overwrite === true,
      env,
    });
    return success({ export: exported });
  }

  return failure("not_implemented", `${toolName} is registered but not implemented yet.`);
}

function asMcpContent(result: CommandResult) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: !result.ok,
  };
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  profile: AccessProfile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  let result: unknown;

  if (request.method === "initialize") {
    result = {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "readany",
        version: "0.1.0",
      },
    };
    return result;
  }

  if (request.method === "notifications/initialized") {
    result = {};
    return result;
  }

  if (request.method === "tools/list") {
    result = {
      tools: listTools().map(toMcpTool),
    };
    return result;
  }

  if (request.method === "tools/call") {
    const params = parseArgs(request.params) as ToolCallParams;
    const name = params.name;
    if (!name) {
      result = asMcpContent(failure("missing_tool_name", "tools/call requires name"));
      return result;
    }
    const args = params.arguments ?? {};
    if (!isPlainRecord(args)) {
      result = asMcpContent(
        failure("invalid_tool_arguments", "tools/call arguments must be an object"),
      );
      return result;
    }
    try {
      result = asMcpContent(await callReadAnyTool(profile, name, args, env));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown tool execution failure";
      result = asMcpContent(failure("command_failed", message));
    }
    return result;
  }

  result = {
    error: {
      code: -32601,
      message: `Unknown MCP method: ${request.method ?? ""}`.trim(),
    },
  };
  return result;
}

export async function serveMcp(argvProfile: string | undefined, env = process.env): Promise<void> {
  const profile = parseAccessProfile(argvProfile);

  for await (const { request, framing } of readMcpRequests(input)) {
    const result = await handleMcpRequest(request, profile, env);
    writeMcpResponse(output, request, result, framing);
  }
}

async function* readMcpRequests(stream: Readable): AsyncGenerator<McpRequestEnvelope> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (buffer.length > 0) {
      const firstNonWhitespace = buffer.findIndex((byte) => byte !== 10 && byte !== 13);
      if (firstNonWhitespace > 0) buffer = buffer.slice(firstNonWhitespace);
      if (buffer.length === 0) break;

      if (startsWithContentLength(buffer)) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)(?:\r\n|$)/i.exec(header);
        if (!match) throw new Error("MCP message is missing Content-Length.");
        const contentLength = Number.parseInt(match[1], 10);
        const bodyStart = headerEnd + 4;
        const messageEnd = bodyStart + contentLength;
        if (buffer.length < messageEnd) break;
        const body = buffer.slice(bodyStart, messageEnd).toString("utf8");
        buffer = buffer.slice(messageEnd);
        yield { request: JSON.parse(body) as JsonRpcRequest, framing: "header" };
        continue;
      }

      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) break;
      const line = buffer.slice(0, lineEnd).toString("utf8").trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line) continue;
      yield { request: JSON.parse(line) as JsonRpcRequest, framing: "line" };
    }
  }

  const rest = buffer.toString("utf8").trim();
  if (rest) yield { request: JSON.parse(rest) as JsonRpcRequest, framing: "line" };
}

function writeMcpResponse(
  stream: Writable,
  request: JsonRpcRequest,
  result: unknown,
  framing: McpRequestEnvelope["framing"],
): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: request.id ?? null,
    result,
  });
  if (framing === "header") {
    stream.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    return;
  }
  stream.write(`${body}\n`);
}

function startsWithContentLength(buffer: Buffer): boolean {
  return buffer
    .slice(0, Math.min(buffer.length, "Content-Length".length))
    .toString("utf8")
    .toLowerCase()
    .startsWith("content-length");
}
