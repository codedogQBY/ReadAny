import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import {
  loadWorkspaceConfig,
  resolveInputPath,
  workspaceRealSamplePath,
} from "./acceptance-workspace.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(scriptDir, "..");
const repoRoot = resolve(cliRoot, "../..");
const binPath = resolve(cliRoot, "dist/bin/readany.js");
const cliPackageJson = JSON.parse(await readFile(resolve(cliRoot, "package.json"), "utf8"));

function parseArgs(argv) {
  const options = {
    bookId: undefined,
    epubBookId: undefined,
    pdfBookId: undefined,
    ragQuery: undefined,
    knowledgeQuery: undefined,
    exportDir: undefined,
    evidencePath: undefined,
    workspacePath: undefined,
    draftExport: false,
    keepDraft: false,
    readanyHome: process.env.READANY_HOME,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--book") {
      options.bookId = next;
      index += 1;
    } else if (arg === "--epub-book") {
      options.epubBookId = next;
      index += 1;
    } else if (arg === "--pdf-book") {
      options.pdfBookId = next;
      index += 1;
    } else if (arg === "--rag-query") {
      options.ragQuery = next;
      index += 1;
    } else if (arg === "--knowledge-query") {
      options.knowledgeQuery = next;
      index += 1;
    } else if (arg === "--export-dir") {
      options.exportDir = next;
      index += 1;
    } else if (arg === "--evidence") {
      options.evidencePath = next;
      index += 1;
    } else if (arg === "--workspace") {
      options.workspacePath = next;
      index += 1;
    } else if (arg === "--readany-home") {
      options.readanyHome = next;
      index += 1;
    } else if (arg === "--draft-export") {
      options.draftExport = true;
    } else if (arg === "--keep-draft") {
      options.keepDraft = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return `ReadAny real sample acceptance helper

Usage:
  pnpm --filter @readany/cli acceptance:real -- --book <book-id> --rag-query <query> [options]

Readonly by default:
  --book <book-id>             Primary real sample book id for books/chapters/RAG checks.
  --epub-book <book-id>        EPUB book id for epub.inspect; defaults to --book.
  --pdf-book <book-id>         Optional PDF book id for PDF page fallback checks.
  --rag-query <query>          Query expected to return at least one RAG result.
  --knowledge-query <query>    Knowledge query; defaults to --rag-query.
  --readany-home <path>        ReadAny data root; defaults to READANY_HOME.
  --evidence <path>            Write JSON evidence to this path.
  --workspace <path>           Acceptance workspace root or workspace.json.

Explicit write/export mode:
  --draft-export               Create, validate, export, and re-inspect an EPUB draft.
  --export-dir <path>          Required with --draft-export; export target directory.
  --keep-draft                 Keep the draft workspace after export for manual inspection.
`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runMetadataCommand(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function createEnvironmentEvidence() {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pnpm: runMetadataCommand("pnpm", ["--version"]) ?? "unavailable",
    cliVersion: cliPackageJson.version,
    gitCommit: runMetadataCommand("git", ["rev-parse", "HEAD"]) ?? "unavailable",
    gitBranch: runMetadataCommand("git", ["branch", "--show-current"]) ?? "unavailable",
  };
}

function createManualAcceptanceRequirements() {
  return [
    {
      id: "sample-source",
      label: "Record the real sample source, license/privacy status, and whether it is publishable.",
      evidence: [
        "sample title/source owner or fixture origin",
        "license/privacy classification",
        "whether the evidence can be committed or must stay local",
      ],
      commands: [],
    },
    {
      id: "external-agent-clients",
      label: "Verify at least two real external agent clients, with at least one using MCP.",
      evidence: [
        "client names and versions",
        "MCP config snippets without secrets",
        "tools/list output",
        "readonly write rejection",
        "editor draft and publisher export summaries",
      ],
      commands: [
        "readany mcp config --client codex --profile readonly --json",
        "readany mcp config --client claude --profile readonly --json",
      ],
    },
    {
      id: "desktop-settings",
      label: "Verify the desktop External AI settings page can install/update/remove CLI and Skill and copy MCP config.",
      evidence: [
        "settings page screenshots or operation log",
        "doctor result rendered in the app",
        "Skill install/update/uninstall status",
        "MCP config copy for readonly/editor/publisher profiles",
      ],
      commands: [
        "readany doctor --json",
        "readany skill status --json",
        "readany mcp config --client generic --profile readonly --json",
      ],
    },
    {
      id: "packaged-app-matrix",
      label: "Verify packaged app install, doctor, Skill, MCP, and draft export on macOS, Windows, and Linux.",
      evidence: [
        "package source and version per platform",
        "install/uninstall result",
        "doctor output per platform",
        "Skill status per platform",
        "MCP initialize/tools/list per platform",
        "draft export result per platform",
      ],
      commands: [
        "readany doctor --json",
        "readany skill install --json",
        "readany skill status --json",
        "readany mcp serve --profile readonly",
      ],
    },
    {
      id: "reader-jumpback",
      label: "Verify RAG and chapter citations can jump back in the desktop reader.",
      evidence: [
        "RAG result citation fields",
        "chapter citation fields",
        "reader jumpback screenshot or screen recording",
      ],
      commands: [
        "readany rag search \"<query>\" --book <book-id> --json",
        "readany chapter get <book-id> <chapter-id> --json",
      ],
    },
    {
      id: "runtime-bundle",
      label: "Verify native binary or full runtime bundle behavior for users without a separate Node setup.",
      evidence: [
        "whether Node is required or bundled",
        "doctor runtime.node/runtime.executable",
        "nativeSqliteAvailable and nativeSqlitePath",
        "result on a clean user machine without repo node_modules",
      ],
      commands: [
        "readany --version",
        "readany doctor --json",
        "readany books list --json",
      ],
    },
  ];
}

async function createSampleFileEvidence(label, book, readanyHome) {
  assert(book?.id, `${label} sample did not include a book id`);
  assert(book?.filePath, `${label} sample did not include a book file path`);
  const absoluteFilePath = resolve(readanyHome, book.filePath);
  const bytes = await readFile(absoluteFilePath);
  return {
    labels: [label],
    bookId: book.id,
    format: book.format,
    title: book.meta?.title,
    filePath: book.filePath,
    absoluteFilePath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

async function addSampleFileEvidence(sampleFilesByBookId, label, book, readanyHome) {
  const existing = sampleFilesByBookId.get(book?.id);
  if (existing) {
    if (!existing.labels.includes(label)) existing.labels.push(label);
    return;
  }
  sampleFilesByBookId.set(book.id, await createSampleFileEvidence(label, book, readanyHome));
}

function decodeXmlText(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getPackageDir(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index + 1) : "";
}

function resolvePackagePath(packageDir, href) {
  if (!packageDir) return href;
  return `${packageDir}${href}`.replace(/\/{2,}/g, "/");
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return {
        entryCount: view.getUint16(offset + 10, true),
        centralDirectoryOffset: view.getUint32(offset + 16, true),
      };
    }
  }
  throw new Error("ZIP end of central directory was not found.");
}

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const eocd = findEndOfCentralDirectory(bytes);
  const entries = new Map();
  let offset = eocd.centralDirectoryOffset;

  for (let index = 0; index < eocd.entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry.");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${name}.`);
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
    }
    entries.set(name, data);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipText(entries, path) {
  const data =
    entries.get(path) ??
    Array.from(entries.entries()).find(([entryPath]) => entryPath.toLowerCase() === path.toLowerCase())?.[1];
  return data ? new TextDecoder().decode(data) : undefined;
}

function inspectExportedEpub(bytes) {
  const entries = readZipEntries(bytes);
  const containerXml = readZipText(entries, "META-INF/container.xml");
  if (!containerXml) throw new Error("Exported EPUB container.xml was not found.");
  const packagePath = containerXml.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i)?.[1];
  if (!packagePath) throw new Error("Exported EPUB container.xml does not declare a package document.");

  const opfXml = readZipText(entries, packagePath);
  if (!opfXml) throw new Error(`Exported EPUB package document was not found: ${packagePath}`);
  const packageDir = getPackageDir(packagePath);
  const title = opfXml.match(/<[^:>]*:?title\b[^>]*>([^<]*)<\/[^>]+>/i)?.[1]?.trim();
  const navHref = opfXml
    .match(/<item\b[^>]*\bproperties=["'][^"']*\bnav\b[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1] ??
    opfXml.match(/<item\b[^>]*\bhref=["']([^"']+)["'][^>]*\bproperties=["'][^"']*\bnav\b[^"']*["'][^>]*>/i)?.[1];
  const navXml = navHref ? readZipText(entries, resolvePackagePath(packageDir, navHref)) : undefined;

  return {
    packagePath,
    title: title ? decodeXmlText(title) : undefined,
    manifestCount: opfXml.match(/<item\b/gi)?.length ?? 0,
    spineCount: opfXml.match(/<itemref\b/gi)?.length ?? 0,
    tocCount: navXml?.match(/<a\b/gi)?.length ?? 0,
  };
}

function runCli(args, env) {
  const cliArgs = [...args, "--json"];
  const result = spawnSync(process.execPath, [binPath, ...cliArgs], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  const raw = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      ok: false,
      error: { code: "invalid_json", message: raw.trim() || "CLI did not return JSON" },
    };
  }
  return {
    command: ["readany", ...cliArgs].join(" "),
    status: result.status,
    ok: parsed.ok === true,
    data: parsed.data,
    error: parsed.error,
  };
}

function requireOk(step) {
  if (!step.ok) {
    const message = step.error?.message ?? `Command failed with status ${step.status}`;
    throw new Error(`${step.command}: ${message}`);
  }
  return step.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstChapter(chapters) {
  return chapters.find((chapter) => chapter.id) ?? null;
}

function createChapterCitationTarget(bookId, chapter) {
  return {
    type: chapter?.source === "pdf" ? "pdf-page" : "chapter",
    bookId,
    chapterId: chapter?.id,
    chapterIndex: chapter?.index,
    chapterTitle: chapter?.title,
    page: chapter?.page,
    cfi: chapter?.cfi ?? chapter?.startCfi,
    startCfi: chapter?.startCfi,
    endCfi: chapter?.endCfi,
    source: chapter?.source,
  };
}

function createChunkCitationTarget(result) {
  const chunk = result?.chunk;
  return {
    type: "rag-chunk",
    bookId: chunk?.bookId,
    chunkId: chunk?.id,
    chapterIndex: chunk?.chapterIndex,
    chapterTitle: chunk?.chapterTitle,
    cfi: chunk?.startCfi,
    startCfi: chunk?.startCfi,
    endCfi: chunk?.endCfi,
    matchType: result?.matchType,
  };
}

function isUsableCitationTarget(target) {
  return Boolean(target?.bookId && (target.cfi || target.startCfi || target.page || target.chapterId || target.chunkId));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  if (!options.readanyHome) {
    throw new Error("Set READANY_HOME or pass --readany-home <path>.");
  }
  if (!options.bookId) {
    throw new Error("Pass --book <book-id>.");
  }
  if (!options.ragQuery) {
    throw new Error("Pass --rag-query <query>.");
  }
  if (options.draftExport && !options.exportDir) {
    throw new Error("--draft-export requires --export-dir <path>.");
  }

  let workspaceFile;
  let workspace;
  if (options.workspacePath) {
    const loaded = await loadWorkspaceConfig(options.workspacePath);
    workspaceFile = loaded.workspaceFile;
    workspace = loaded.workspace;
  }

  const evidencePath =
    (options.evidencePath
      ? resolveInputPath(options.evidencePath)
      : workspaceRealSamplePath(workspace)) ??
    join(await mkdtemp(join(tmpdir(), "readany-real-acceptance-")), "evidence.json");
  const env = {
    ...process.env,
    READANY_HOME: options.readanyHome,
  };
  const checks = [];
  const commands = [];
  const sampleFilesByBookId = new Map();
  const citationTargets = [];

  const record = (name, step, details = {}) => {
    commands.push({
      name,
      command: step.command,
      status: step.status,
      ok: step.ok,
      errorCode: step.error?.code,
      details,
    });
    checks.push(name);
  };

  const doctor = runCli(["doctor"], env);
  const doctorData = requireOk(doctor);
  record("doctor runtime and MCP diagnostics", doctor, {
    version: doctorData.version,
    profile: doctorData.profile,
    node: doctorData.runtime?.node,
    executable: doctorData.runtime?.executable,
    nativeSqliteAvailable: doctorData.runtime?.nativeSqliteAvailable,
    toolCount: doctorData.tools?.count,
    mcpDefaultProfile: doctorData.mcp?.defaultProfile,
    mcpServeArgs: doctorData.mcp?.serveArgs,
    mcpToolCount: doctorData.mcp?.toolCount,
    failedChecks: doctorData.checks
      ?.filter((check) => check.ok !== true)
      .map((check) => check.name),
  });

  const books = runCli(["books", "list", "--limit", "50"], env);
  const booksData = requireOk(books);
  assert(
    booksData.books.some((book) => book.id === options.bookId),
    `Book ${options.bookId} was not found in books.list`,
  );
  record("books.list contains primary real sample", books, { bookId: options.bookId });

  const book = runCli(["book", "get", options.bookId], env);
  const bookData = requireOk(book);
  assert(bookData.book?.id === options.bookId, "book.get did not return the primary book");
  await addSampleFileEvidence(sampleFilesByBookId, "primary", bookData.book, options.readanyHome);
  record("book.get primary sample", book, {
    bookId: options.bookId,
    format: bookData.book?.format,
    title: bookData.book?.meta?.title,
  });

  const chapters = runCli(["chapters", "list", options.bookId], env);
  const chaptersData = requireOk(chapters);
  const chapter = firstChapter(chaptersData.chapters);
  assert(chapter, `No chapters were returned for ${options.bookId}`);
  const primaryChapterCitation = createChapterCitationTarget(options.bookId, chapter);
  if (isUsableCitationTarget(primaryChapterCitation)) {
    citationTargets.push(primaryChapterCitation);
  }
  record("chapters.list primary sample", chapters, {
    bookId: options.bookId,
    count: chaptersData.chapters.length,
    firstChapterId: chapter.id,
    firstChapterSource: chapter.source,
  });

  const chapterRead = runCli(["chapter", "get", options.bookId, chapter.id, "--limit", "4000"], env);
  const chapterReadData = requireOk(chapterRead);
  assert(
    typeof chapterReadData.chapter?.content === "string" &&
      chapterReadData.chapter.content.length > 0,
    `chapter.get returned empty content for ${options.bookId}/${chapter.id}`,
  );
  record("chapter.get primary sample", chapterRead, {
    bookId: options.bookId,
    chapterId: chapter.id,
    source: chapterReadData.chapter.source,
    contentLength: chapterReadData.chapter.content.length,
    contentHash: sha256(chapterReadData.chapter.content),
  });

  const rag = runCli(["rag", "search", options.ragQuery, "--book", options.bookId, "--mode", "bm25", "--limit", "3"], env);
  const ragData = requireOk(rag);
  assert(Array.isArray(ragData.results) && ragData.results.length > 0, "rag.search returned no results");
  const ragCitationTargets = ragData.results
    .map((result) => createChunkCitationTarget(result))
    .filter(isUsableCitationTarget);
  assert(ragCitationTargets.length > 0, "rag.search returned no usable citation targets");
  citationTargets.push(...ragCitationTargets);
  record("rag.search primary sample", rag, {
    bookId: options.bookId,
    queryHash: sha256(options.ragQuery),
    count: ragData.results.length,
    firstChunkId: ragData.results[0]?.chunk?.id,
    citationTargetCount: ragCitationTargets.length,
    firstCitationTarget: ragCitationTargets[0],
  });

  const knowledgeQuery = options.knowledgeQuery ?? options.ragQuery;
  const knowledge = runCli(["knowledge", "search", knowledgeQuery, "--book", options.bookId, "--limit", "5"], env);
  const knowledgeData = requireOk(knowledge);
  assert(
    Array.isArray(knowledgeData.knowledge?.results),
    "knowledge.search did not return a results array",
  );
  record("knowledge.search bounded sample", knowledge, {
    bookId: options.bookId,
    queryHash: sha256(knowledgeQuery),
    count: knowledgeData.knowledge.results.length,
  });

  const context = runCli(["context", "get", "--limit", "2000"], env);
  const contextData = requireOk(context);
  record("context.get bounded snapshot", context, {
    available: contextData.readerContext?.available === true,
    bookId: contextData.readerContext?.context?.bookId,
  });

  const epubBookId = options.epubBookId ?? (bookData.book?.format === "epub" ? options.bookId : undefined);
  if (epubBookId) {
    const epubBook = runCli(["book", "get", epubBookId], env);
    const epubBookData = requireOk(epubBook);
    await addSampleFileEvidence(sampleFilesByBookId, "epub", epubBookData.book, options.readanyHome);
    const inspect = runCli(["epub", "inspect", epubBookId, "--profile", "editor"], env);
    const inspectData = requireOk(inspect);
    assert(inspectData.epub?.spine?.items?.length > 0, "epub.inspect returned no spine items");
    record("epub.inspect real sample", inspect, {
      bookId: epubBookId,
      packagePath: inspectData.epub.packagePath,
      spineCount: inspectData.epub.spine.items.length,
      tocCount: inspectData.epub.toc?.items?.length ?? 0,
    });

    if (options.draftExport) {
      await mkdir(options.exportDir, { recursive: true });
      const draftCreate = runCli(["epub", "draft", "create", epubBookId, "--profile", "editor"], env);
      const draftData = requireOk(draftCreate);
      const draftId = draftData.draft?.draftId;
      assert(draftId, "epub.draft.create did not return draftId");
      record("epub.draft.create real sample", draftCreate, { bookId: epubBookId, draftId });
      let draftWorkflowFailed = false;
      try {
        const validate = runCli(["epub", "validate", draftId, "--profile", "publisher"], env);
        const validateData = requireOk(validate);
        assert(validateData.validation?.valid === true, "epub.validate did not pass for real sample draft");
        record("epub.validate real sample draft", validate, { draftId });

        const exportPath = join(options.exportDir, `readany-real-sample-${Date.now()}.epub`);
        const exported = runCli(["epub", "export", draftId, "--output", exportPath, "--profile", "publisher"], env);
        requireOk(exported);
        const exportedBytes = await readFile(exportPath);
        record("epub.export real sample draft", exported, {
          draftId,
          outputPath: exportPath,
          outputHash: sha256(exportedBytes),
          outputBytes: exportedBytes.byteLength,
        });

        const exportedInspect = inspectExportedEpub(exportedBytes);
        assert(
          exportedInspect.spineCount > 0,
          "exported real sample EPUB inspect returned no spine items",
        );
        record("epub.export inspect real sample output", exported, {
          draftId,
          outputPath: exportPath,
          packagePath: exportedInspect.packagePath,
          title: exportedInspect.title,
          manifestCount: exportedInspect.manifestCount,
          spineCount: exportedInspect.spineCount,
          tocCount: exportedInspect.tocCount,
        });
      } catch (error) {
        draftWorkflowFailed = true;
        throw error;
      } finally {
        if (!options.keepDraft) {
          const discard = runCli(
            [
              "epub",
              "draft",
              "discard",
              draftId,
              "--profile",
              "editor",
              "--reason",
              "real sample acceptance cleanup",
            ],
            env,
          );
          record("epub.draft.discard real sample cleanup", discard, { draftId });
          if (!discard.ok && !draftWorkflowFailed) {
            requireOk(discard);
          }
        }
      }
    }
  }

  if (options.pdfBookId) {
    const pdfBook = runCli(["book", "get", options.pdfBookId], env);
    const pdfBookData = requireOk(pdfBook);
    await addSampleFileEvidence(sampleFilesByBookId, "pdf", pdfBookData.book, options.readanyHome);
    const pdfChapters = runCli(["chapters", "list", options.pdfBookId], env);
    const pdfChaptersData = requireOk(pdfChapters);
    const pdfPage = pdfChaptersData.chapters.find((item) => item.source === "pdf");
    assert(pdfPage, `No PDF fallback pages were returned for ${options.pdfBookId}`);
    const pdfPageCitation = createChapterCitationTarget(options.pdfBookId, pdfPage);
    if (isUsableCitationTarget(pdfPageCitation)) {
      citationTargets.push(pdfPageCitation);
    }
    record("pdf chapters.list real sample", pdfChapters, {
      bookId: options.pdfBookId,
      count: pdfChaptersData.chapters.length,
      firstPageId: pdfPage.id,
    });

    const pdfRead = runCli(["chapter", "get", options.pdfBookId, pdfPage.id, "--limit", "4000"], env);
    const pdfReadData = requireOk(pdfRead);
    assert(pdfReadData.chapter?.source === "pdf", "PDF chapter.get did not return PDF source");
    const pdfReadCitation = createChapterCitationTarget(options.pdfBookId, pdfReadData.chapter);
    assert(isUsableCitationTarget(pdfReadCitation), "PDF chapter.get did not return a usable page citation");
    citationTargets.push(pdfReadCitation);
    record("pdf chapter.get real sample", pdfRead, {
      bookId: options.pdfBookId,
      pageId: pdfPage.id,
      cfi: pdfReadData.chapter.cfi,
      contentLength: pdfReadData.chapter.content?.length ?? 0,
      contentHash: sha256(pdfReadData.chapter.content ?? ""),
    });
  }

  const sampleFiles = Array.from(sampleFilesByBookId.values());
  const manualAcceptanceRequired = createManualAcceptanceRequirements();
  const citationTargetTypes = Array.from(new Set(citationTargets.map((target) => target.type).filter(Boolean)));
  const summary = {
    commandCount: commands.length,
    checkCount: checks.length,
    sampleFileCount: sampleFiles.length,
    sampleFormats: Array.from(new Set(sampleFiles.map((sample) => sample.format).filter(Boolean))),
    citationTargetCount: citationTargets.length,
    citationTargetTypes,
    draftExport: options.draftExport,
    pdfChecked: Boolean(options.pdfBookId),
    doctorFailedChecks: doctorData.checks
      ?.filter((check) => check.ok !== true)
      .map((check) => check.name) ?? [],
    manualAcceptanceRequiredCount: manualAcceptanceRequired.length,
    manualAcceptanceRequiredIds: manualAcceptanceRequired.map((item) => item.id),
  };

  const evidence = {
    ok: true,
    generatedAt: new Date().toISOString(),
    environment: createEnvironmentEvidence(),
    doctor: doctorData,
    readanyHome: options.readanyHome,
    bookId: options.bookId,
    epubBookId: options.epubBookId,
    pdfBookId: options.pdfBookId,
    summary,
    sampleFiles,
    citationTargets,
    draftExport: options.draftExport,
    keepDraft: options.keepDraft,
    checks,
    commands,
    manualAcceptanceRequired,
    note: "This helper records real-sample evidence. It does not replace manual external-agent or packaged-app matrix acceptance.",
  };

  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, workspaceFile, evidencePath, summary, checks }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
