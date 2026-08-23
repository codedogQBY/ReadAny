import {
  access,
  appendFile,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildStoreOnlyZip, type ZipEntry } from "@readany/core/utils/store-only-zip";
import { describe, expect, it } from "vitest";
import { parseCommand, runCommand } from "./commands.js";
import { ensureCoreInitialized, resetCoreForTests } from "./data.js";
import { createSkillContent } from "./skill.js";

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
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Agent Systems</dc:title><dc:creator>Ada Reader</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine></package>`,
    ),
    textEntry(
      "OPS/nav.xhtml",
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">Tools</a></li><li><a href="chapter-2.xhtml">Drafts</a></li></ol></nav></body></html>`,
    ),
    textEntry("OPS/chapter-1.xhtml", "<html><body>Tools</body></html>"),
    textEntry("OPS/chapter-2.xhtml", "<html><body>Drafts</body></html>"),
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
      `<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Invalid Draft</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter-1" href="missing.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter-1"/></spine></package>`,
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
    const contentId = addObject(
      `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
    );
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

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "readany-cli-workspace-"));
  const dataRoot = join(root, "library");
  const appRoot = join(root, "app-data");
  const skillsDir = join(root, "agent", "skills", "readany");
  const cliHome = join(root, "readany-home");
  await mkdir(dataRoot, { recursive: true });
  await mkdir(appRoot, { recursive: true });
  await mkdir(join(dataRoot, "books"), { recursive: true });
  await mkdir(skillsDir, { recursive: true });
  await mkdir(cliHome, { recursive: true });

  return {
    root,
    dataRoot,
    appRoot,
    env: {
      ...process.env,
      AGENT_HOME: join(root, "agent"),
      CODEX_HOME: join(root, "codex"),
      CLAUDE_HOME: join(root, "claude"),
      CURSOR_HOME: join(root, "cursor"),
      OPENCODE_HOME: join(root, "opencode"),
      AGENTS_HOME: join(root, "agents"),
      READANY_HOME: dataRoot,
    } as NodeJS.ProcessEnv,
  };
}

async function seedLibrary(dataRoot: string): Promise<void> {
  await resetCoreForTests();
  await ensureCoreInitialized({ ...process.env, READANY_HOME: dataRoot });
  const db = new Database(join(dataRoot, "readany.db"));
  db.exec(`
    INSERT INTO books (
      id, file_path, format, title, author, publisher, language, isbn, description,
      cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
      group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
      is_vectorized, vectorize_progress, tags, file_hash, sync_status
    ) VALUES (
      'book-1', 'books/agent.epub', 'epub', 'Agent Systems', 'Ada Reader', NULL, 'en',
      NULL, 'A book about safe agent architecture', NULL, NULL, NULL, NULL, '["AI"]',
      100, 8, NULL, 1000, 2000, 3000, NULL, 0.5, 'epubcfi(/6/2)', 1, 1,
      '["ai","agent"]', 'hash-1', 'local'
    );

    INSERT INTO notes (
      id, book_id, highlight_id, cfi, title, content, chapter_title, tags, created_at, updated_at
    ) VALUES (
      'note-1', 'book-1', NULL, 'epubcfi(/6/4)', 'Planning note',
      'Agents need safe tool boundaries.', 'Tools', '["agent"]', 4000, 4000
    );

    INSERT INTO highlights (
      id, book_id, cfi, text, color, note, chapter_title, created_at, updated_at
    ) VALUES (
      'highlight-1', 'book-1', 'epubcfi(/6/8)', 'Draft-first editing keeps users safe.',
      'yellow', 'Important safety point', 'Safety', 5000, 5000
    );

    INSERT INTO bookmarks (
      id, book_id, cfi, label, chapter_title, created_at
    ) VALUES (
      'bookmark-1', 'book-1', 'epubcfi(/6/6)', 'Review this section', 'Tools', 5500
    );

    INSERT INTO skills (
      id, name, description, icon, enabled, parameters, prompt, built_in, created_at, updated_at
    ) VALUES (
      'skill-1', 'Chapter Polisher', 'Suggests safer chapter edits.', NULL, 1,
      '[{"name":"tone","type":"string","description":"Target tone","required":false}]',
      'Polish chapter text in a controlled draft.', 0, 5600, 5600
    );
  `);
  db.close();

  await writeFile(join(dataRoot, "books", "agent.epub"), buildInspectableEpub());

  const localDb = new Database(join(dataRoot, "readany_local.db"));
  localDb.exec(`
    INSERT INTO chunks (
      id, book_id, chapter_index, chapter_title, content, token_count,
      start_cfi, end_cfi, segment_cfis, embedding, updated_at
    ) VALUES
    (
      'chunk-1', 'book-1', 1, 'Tools',
      'Agents need safe tool boundaries and permissioned local context.',
      9, 'epubcfi(/6/10)', 'epubcfi(/6/12)', '["epubcfi(/6/10)"]', NULL, 6000
    ),
    (
      'chunk-1b', 'book-1', 1, 'Tools',
      'Bounded chapter ranges keep external AI responses compact.',
      8, 'epubcfi(/6/12)', 'epubcfi(/6/13)', '["epubcfi(/6/12)"]', NULL, 6000
    ),
    (
      'chunk-2', 'book-1', 2, 'Drafts',
      'Draft-first editing keeps EPUB sources safe while AI proposes changes.',
      10, 'epubcfi(/6/14)', 'epubcfi(/6/16)', '["epubcfi(/6/14)"]', NULL, 6000
    );
  `);
  localDb.close();
}

async function seedVectorLibrary(dataRoot: string): Promise<void> {
  await resetCoreForTests();
  await ensureCoreInitialized({ ...process.env, READANY_HOME: dataRoot });
  const db = new Database(join(dataRoot, "readany.db"));
  db.exec(`
    INSERT INTO books (
      id, file_path, format, title, author, publisher, language, isbn, description,
      cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
      group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
      is_vectorized, vectorize_progress, tags, file_hash, sync_status
    ) VALUES (
      'vector-book', 'books/vector.epub', 'epub', 'Vector Search', 'Ada Reader', NULL, 'en',
      NULL, 'A book with embeddings for semantic search', NULL, NULL, NULL, NULL, '["AI"]',
      120, 6, NULL, 1000, 2000, 3000, NULL, 0.5, 'epubcfi(/6/2)', 1, 1,
      '["vector"]', 'hash-vector', 'local'
    );
  `);
  db.close();

  const localDb = new Database(join(dataRoot, "readany_local.db"));
  localDb.exec(`
    INSERT INTO chunks (
      id, book_id, chapter_index, chapter_title, content, token_count,
      start_cfi, end_cfi, segment_cfis, embedding, updated_at
    ) VALUES
    (
      'vector-chunk-1', 'vector-book', 1, 'Embeddings',
      'Semantic search should match meaning rather than surface terms.',
      9, 'epubcfi(/6/18)', 'epubcfi(/6/20)', '["epubcfi(/6/18)"]',
      x'000000000000803f0000003f', 6000
    ),
    (
      'vector-chunk-2', 'vector-book', 2, 'Fallback',
      'Hybrid search can still fall back to BM25 when vectors are unavailable.',
      10, 'epubcfi(/6/22)', 'epubcfi(/6/24)', '["epubcfi(/6/22)"]',
      x'0000803f0000000000000000', 6000
    );
  `);
  localDb.close();
}

async function writeReaderContextSnapshot(
  dataRoot: string,
  bookTitle = "Agent Systems",
): Promise<void> {
  await mkdir(join(dataRoot, "readany-store"), { recursive: true });
  await writeFile(
    join(dataRoot, "readany-store", "reader-context.json"),
    JSON.stringify({
      bookId: "book-1",
      bookTitle,
      currentChapter: {
        index: 1,
        title: "Tools",
        href: "OPS/chapter-1.xhtml",
      },
      currentPosition: {
        cfi: "epubcfi(/6/10)",
        percentage: 0.42,
        page: 12,
      },
      selection: {
        text: "Agents need safe tool boundaries and permissioned local context.",
        cfi: "epubcfi(/6/10)",
        chapterIndex: 1,
        chapterTitle: "Tools",
      },
      surroundingText:
        "Agents need safe tool boundaries and permissioned local context. The reader is looking at the tool safety section.",
      recentHighlights: [
        {
          text: "Draft-first editing keeps users safe.",
          cfi: "epubcfi(/6/8)",
          note: "Important safety point",
        },
      ],
      operationType: "selecting",
      timestamp: 1700000000000,
    }),
    "utf8",
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("commands", () => {
  it("parses json and profile flags", () => {
    expect(parseCommand(["doctor", "--json", "--profile", "editor"])).toEqual({
      name: "doctor",
      args: [],
      json: true,
      profile: "editor",
      mode: undefined,
      options: {},
    });
  });

  it("does not consume the next flag as a missing profile value", () => {
    expect(parseCommand(["mcp", "config", "--profile", "--json"])).toEqual({
      name: "mcp",
      args: ["config"],
      json: true,
      profile: "",
      mode: undefined,
      options: {},
    });
  });

  it("returns version", async () => {
    const result = await runCommand(["--version"], await createWorkspace().then((w) => w.env));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("0.1.0");
  });

  it("installs, updates, and reports skill status", async () => {
    const workspace = await createWorkspace();
    const skillFile = join(workspace.root, "agent", "skills", "readany", "SKILL.md");
    const missingUpdate = await runCommand(["skill", "update"], workspace.env);
    expect(missingUpdate).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });

    const install = await runCommand(["skill", "install"], workspace.env);
    expect(install).toMatchObject({
      ok: true,
      data: {
        installed: true,
        path: skillFile,
      },
    });

    await writeFile(skillFile, createSkillContent("0.0.0"), "utf8");
    const update = await runCommand(["skill", "update"], workspace.env);
    expect(update).toMatchObject({
      ok: true,
      data: {
        updated: true,
        path: skillFile,
        previousVersion: "0.0.0",
        version: "0.1.0",
      },
    });

    const status = await runCommand(["skill", "status"], workspace.env);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.data).toMatchObject({ installed: true });
    }
  });

  it("repairs the managed CLI shim by reinstalling it", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    const env = { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath };
    const userBinDir = join(workspace.root, "bin");
    const repair = await runCommand(["repair", "--user", "--user-bin-dir", userBinDir], env);
    expect(repair).toMatchObject({
      ok: true,
      data: {
        repaired: true,
        installed: true,
        mode: "user",
      },
    });
    if (!repair.ok) return;
    const repairData = repair.data as { path: string; target: string };
    expect(repairData.path).toBe(
      join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany"),
    );
    expect(repairData.target).toContain("readany.js");

    const secondRepair = await runCommand(["repair", "--user", "--user-bin-dir", userBinDir], env);
    expect(secondRepair).toMatchObject({
      ok: true,
      data: {
        repaired: true,
        path: repairData.path,
        target: repairData.target,
      },
    });

    const uninstall = await runCommand(["uninstall", "--user", "--user-bin-dir", userBinDir], env);
    expect(uninstall).toMatchObject({
      ok: true,
      data: {
        removed: true,
        path: repairData.path,
      },
    });
  });

  it("uninstalls additional managed CLI shims discovered on PATH when requested", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    const oldCliBinPath = join(
      workspace.root,
      "global",
      "lib",
      "node_modules",
      "@readany",
      "cli",
      "dist",
      "bin",
      "readany.js",
    );
    const userBinDir = join(workspace.root, "bin");
    const pathBinDir = join(workspace.root, "path-bin");
    const pathShim = join(pathBinDir, "readany");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await mkdir(join(workspace.root, "global", "lib", "node_modules", "@readany", "cli", "dist", "bin"), {
      recursive: true,
    });
    await mkdir(pathBinDir, { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    await writeFile(oldCliBinPath, "#!/usr/bin/env node\nconst marker = 'readany-cli-managed';\n", "utf8");
    await symlink(oldCliBinPath, pathShim);

    const uninstall = await runCommand(
      ["uninstall", "--user", "--user-bin-dir", userBinDir, "--remove-path-shims"],
      { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath, PATH: pathBinDir },
    );
    expect(uninstall).toMatchObject({
      ok: true,
      data: {
        removed: false,
        path: join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany"),
        extraRemoved: [pathShim],
      },
    });
    await expect(lstat(pathShim)).rejects.toThrow();
  });

  it("sets up and uninstalls the external agent entrypoint", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    const userBinDir = join(workspace.root, "bin with spaces");
    const skillFile = join(workspace.root, "agent", "skills", "readany", "SKILL.md");
    const codexSkillLink = join(workspace.root, "codex", "skills", "readany");
    const claudeSkillLink = join(workspace.root, "claude", "skills", "readany");
    const cursorSkillLink = join(workspace.root, "cursor", "skills", "readany");
    const opencodeSkillLink = join(workspace.root, "opencode", "skills", "readany");
    const agentsSkillLink = join(workspace.root, "agents", "skills", "readany");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    const env = { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath };

    const setup = await runCommand(
      [
        "agent",
        "setup",
        "--user",
        "--user-bin-dir",
        userBinDir,
        "--client",
        "codex",
        "--profile",
        "readonly",
      ],
      env,
    );

    expect(setup).toMatchObject({
      ok: true,
      data: {
        setup: true,
        command: expect.stringContaining(
          "readany agent setup --user --client codex --profile readonly --json",
        ),
        install: {
          installed: true,
          mode: "user",
          path: join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany"),
          target: cliBinPath,
        },
        skill: {
          installed: true,
          path: skillFile,
          version: "0.1.0",
        },
        clientSkillLinks: expect.arrayContaining([
          expect.objectContaining({
            client: "codex",
            linked: true,
            path: codexSkillLink,
            target: join(workspace.root, "agent", "skills", "readany"),
          }),
        ]),
        mcp: {
          client: "codex",
          format: "toml",
          profile: "readonly",
          snippet: expect.stringContaining("[mcp_servers.readany]"),
        },
        nextSteps: expect.arrayContaining([expect.stringContaining("mcp.snippet")]),
      },
    });
    expect(
      await pathExists(join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany")),
    ).toBe(true);
    expect(await readFile(skillFile, "utf8")).toContain(
      "readany mcp config --profile readonly --client codex --json",
    );
    expect((await lstat(codexSkillLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(codexSkillLink)).toBe(join(workspace.root, "agent", "skills", "readany"));

    const repeatedSetup = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "generic"],
      env,
    );
    expect(repeatedSetup).toMatchObject({
      ok: true,
      data: {
        skill: {
          updated: true,
          path: skillFile,
          previousVersion: "0.1.0",
          version: "0.1.0",
        },
        mcp: {
          client: "generic",
          profile: "readonly",
          snippet: expect.stringContaining('"mcpServers"'),
        },
      },
    });

    const uninstall = await runCommand(
      ["agent", "uninstall", "--user", "--user-bin-dir", userBinDir],
      env,
    );
    expect(uninstall).toMatchObject({
      ok: true,
      data: {
        uninstalled: true,
        command: expect.stringContaining("readany agent uninstall --user --json"),
        install: {
          removed: true,
          path: join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany"),
        },
        skill: {
          removed: true,
          path: skillFile,
        },
        clientSkillLinks: expect.arrayContaining([
          expect.objectContaining({
            client: "codex",
            removed: true,
            path: codexSkillLink,
          }),
          expect.objectContaining({
            client: "claude",
            removed: false,
            path: claudeSkillLink,
          }),
          expect.objectContaining({
            client: "cursor",
            removed: false,
            path: cursorSkillLink,
          }),
          expect.objectContaining({
            client: "opencode",
            removed: false,
            path: opencodeSkillLink,
          }),
          expect.objectContaining({
            client: "agents",
            removed: false,
            path: agentsSkillLink,
          }),
        ]),
      },
    });
    expect(
      await pathExists(join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany")),
    ).toBe(false);
    expect(await pathExists(skillFile)).toBe(false);
    expect(await pathExists(codexSkillLink)).toBe(false);
  });

  it("links known client skill directories during agent setup", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    const userBinDir = join(workspace.root, "bin");
    const skillDir = join(workspace.root, "agent", "skills", "readany");
    const agentsSkillLink = join(workspace.root, "agents", "skills", "readany");
    const codexSkillLink = join(workspace.root, "codex", "skills", "readany");
    const claudeSkillLink = join(workspace.root, "claude", "skills", "readany");
    const cursorSkillLink = join(workspace.root, "cursor", "skills", "readany");
    const opencodeSkillLink = join(workspace.root, "opencode", "skills", "readany");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    const env = { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath };

    const claude = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "claude"],
      env,
    );
    expect(claude).toMatchObject({
      ok: true,
      data: {
        clientSkillLinks: [
          {
            client: "claude",
            linked: true,
            path: claudeSkillLink,
            target: skillDir,
          },
        ],
      },
    });
    expect((await lstat(claudeSkillLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(claudeSkillLink)).toBe(skillDir);

    const cursor = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "cursor"],
      env,
    );
    expect(cursor).toMatchObject({
      ok: true,
      data: {
        clientSkillLinks: [
          {
            client: "cursor",
            linked: true,
            path: cursorSkillLink,
            target: skillDir,
          },
        ],
      },
    });
    expect((await lstat(cursorSkillLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(cursorSkillLink)).toBe(skillDir);

    const opencode = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "opencode"],
      env,
    );
    expect(opencode).toMatchObject({
      ok: true,
      data: {
        clientSkillLinks: [
          {
            client: "opencode",
            linked: true,
            path: opencodeSkillLink,
            target: skillDir,
          },
        ],
        mcp: {
          client: "opencode",
          format: "json",
          mcp: {
            readany: {
              type: "local",
              command: [
                process.execPath,
                expect.stringMatching(
                  /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
                ),
                "mcp",
                "serve",
                "--profile",
                "readonly",
              ],
              enabled: true,
            },
          },
        },
      },
    });
    expect((await lstat(opencodeSkillLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(opencodeSkillLink)).toBe(skillDir);

    const all = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "all"],
      env,
    );
    expect(all).toMatchObject({
      ok: true,
      data: {
        command: expect.stringContaining(
          "readany agent setup --user --client all --profile readonly --json",
        ),
        clientSkillLinks: expect.arrayContaining([
          expect.objectContaining({ client: "agents", path: agentsSkillLink, target: skillDir }),
          expect.objectContaining({ client: "codex", path: codexSkillLink, target: skillDir }),
          expect.objectContaining({ client: "claude", path: claudeSkillLink, target: skillDir }),
          expect.objectContaining({ client: "cursor", path: cursorSkillLink, target: skillDir }),
          expect.objectContaining({
            client: "opencode",
            path: opencodeSkillLink,
            target: skillDir,
          }),
        ]),
        mcp: {
          client: "generic",
          format: "json",
          snippet: expect.stringContaining('"mcpServers"'),
        },
        mcpConfigs: expect.arrayContaining([
          expect.objectContaining({ client: "generic" }),
          expect.objectContaining({ client: "codex" }),
          expect.objectContaining({ client: "claude" }),
          expect.objectContaining({ client: "cursor" }),
          expect.objectContaining({ client: "opencode" }),
        ]),
      },
    });
    for (const linkPath of [
      agentsSkillLink,
      codexSkillLink,
      claudeSkillLink,
      cursorSkillLink,
      opencodeSkillLink,
    ]) {
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(linkPath)).toBe(skillDir);
    }
  });

  it("does not install agent files when setup options are invalid", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    const userBinDir = join(workspace.root, "bin");
    const skillFile = join(workspace.root, "agent", "skills", "readany", "SKILL.md");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    const env = { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath };

    const setup = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "vscode"],
      env,
    );

    expect(setup).toMatchObject({ ok: false, error: { code: "command_failed" } });
    expect(
      await pathExists(join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany")),
    ).toBe(false);
    expect(await pathExists(skillFile)).toBe(false);
  });

  it("does not overwrite unmanaged client skill links during agent setup", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    const userBinDir = join(workspace.root, "bin");
    const skillFile = join(workspace.root, "agent", "skills", "readany", "SKILL.md");
    const codexSkillDir = join(workspace.root, "codex", "skills", "readany");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await mkdir(codexSkillDir, { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    await writeFile(join(codexSkillDir, "SKILL.md"), "# User ReadAny Skill\n", "utf8");
    const env = { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath };

    const setup = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "codex"],
      env,
    );

    expect(setup).toMatchObject({ ok: false, error: { code: "command_failed" } });
    expect(
      await pathExists(join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany")),
    ).toBe(false);
    expect(await pathExists(skillFile)).toBe(false);
    expect(await readFile(join(codexSkillDir, "SKILL.md"), "utf8")).toBe("# User ReadAny Skill\n");
  });

  it("does not install the agent shim when the skill file is unmanaged", async () => {
    const workspace = await createWorkspace();
    const cliBinPath = join(workspace.root, "dist", "bin", "readany.js");
    const userBinDir = join(workspace.root, "bin");
    const skillFile = join(workspace.root, "agent", "skills", "readany", "SKILL.md");
    await mkdir(join(workspace.root, "dist", "bin"), { recursive: true });
    await writeFile(cliBinPath, "#!/usr/bin/env node\n", "utf8");
    await writeFile(skillFile, "# User-owned skill\n", "utf8");
    const env = { ...workspace.env, READANY_CLI_BIN_PATH: cliBinPath };

    const setup = await runCommand(
      ["agent", "setup", "--user", "--user-bin-dir", userBinDir, "--client", "codex"],
      env,
    );

    expect(setup).toMatchObject({ ok: false, error: { code: "command_failed" } });
    expect(
      await pathExists(join(userBinDir, process.platform === "win32" ? "readany.cmd" : "readany")),
    ).toBe(false);
    expect(await readFile(skillFile, "utf8")).toBe("# User-owned skill\n");
  });

  it("runs doctor with readonly profile", async () => {
    const workspace = await createWorkspace();
    const result = await runCommand(["doctor", "--profile", "readonly"], workspace.env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        version: "0.1.0",
        profile: "readonly",
        runtime: {
          node: expect.stringMatching(/^v/),
          executable: expect.any(String),
          nativeSqliteAvailable: true,
          nativeSqlitePath: expect.stringContaining("better-sqlite3"),
        },
        distribution: {
          kind: "node-script",
          usesNodeRuntime: true,
          nativeBinary: false,
          modulePath: expect.any(String),
          builtBundle: false,
          desktopResourceBundle: false,
        },
        tools: { count: 27 },
        mcp: {
          defaultProfile: "readonly",
          serveArgs: ["mcp", "serve", "--profile", "readonly"],
          supportedProfiles: ["readonly", "assistant", "editor", "publisher"],
          supportedClients: ["generic", "claude", "cursor", "codex", "opencode"],
          toolCount: 27,
        },
        agentAccess: {
          cliShim: {
            installed: expect.any(Boolean),
            managed: expect.any(Boolean),
            path: expect.any(String),
          },
          skill: {
            installed: expect.any(Boolean),
            path: expect.any(String),
          },
          clientSkills: expect.arrayContaining([
            expect.objectContaining({
              client: "codex",
              installed: expect.any(Boolean),
              managed: expect.any(Boolean),
              path: expect.any(String),
            }),
            expect.objectContaining({
              client: "opencode",
              installed: expect.any(Boolean),
              managed: expect.any(Boolean),
              path: expect.any(String),
            }),
          ]),
          mcpConfigs: expect.arrayContaining([
            expect.objectContaining({
              client: "codex",
              configured: expect.any(Boolean),
              checked: expect.any(Boolean),
              path: expect.any(String),
            }),
          ]),
        },
      });
    }
  });

  it("prints MCP config for external agents", async () => {
    const workspace = await createWorkspace();

    const readonly = await runCommand(["mcp", "config"], workspace.env);
    expect(readonly).toMatchObject({
      ok: true,
      data: {
        mcpServers: {
          readany: {
            command: process.execPath,
            args: [
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "readonly",
            ],
          },
        },
      },
    });

    const publisher = await runCommand(["mcp", "config", "--profile", "publisher"], workspace.env);
    expect(publisher).toMatchObject({
      ok: true,
      data: {
        client: "generic",
        format: "json",
        profile: "publisher",
        snippet: expect.stringContaining('"mcpServers"'),
        mcpServers: {
          readany: {
            command: process.execPath,
            args: [
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "publisher",
            ],
          },
        },
      },
    });
    if (publisher.ok) {
      const snippet = (publisher.data as { snippet: string }).snippet;
      expect(JSON.parse(snippet)).toEqual({
        mcpServers: {
          readany: {
            command: process.execPath,
            args: [
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "publisher",
            ],
          },
        },
      });
      expect(snippet).not.toContain('"client"');
      expect(snippet).not.toContain('"format"');
    }

    const codex = await runCommand(
      ["mcp", "config", "--profile", "readonly", "--client", "codex"],
      workspace.env,
    );
    expect(codex).toMatchObject({
      ok: true,
      data: {
        client: "codex",
        format: "toml",
        profile: "readonly",
        snippet: expect.stringContaining("[mcp_servers.readany]"),
      },
    });
    if (codex.ok) {
      expect((codex.data as { snippet: string }).snippet).toContain(
        '"mcp","serve","--profile","readonly"',
      );
      expect((codex.data as { snippet: string }).snippet).toContain(
        `command = ${JSON.stringify(process.execPath)}`,
      );
    }

    const claude = await runCommand(["mcp", "config", "--client", "claude"], workspace.env);
    expect(claude).toMatchObject({
      ok: true,
      data: {
        client: "claude",
        format: "json",
        snippet: expect.stringContaining('"mcpServers"'),
        mcpServers: {
          readany: {
            command: process.execPath,
            args: [
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "readonly",
            ],
          },
        },
      },
    });
    if (claude.ok) {
      expect((claude.data as { snippet: string }).snippet).not.toContain('"client"');
    }

    const opencode = await runCommand(["mcp", "config", "--client", "opencode"], workspace.env);
    expect(opencode).toMatchObject({
      ok: true,
      data: {
        client: "opencode",
        format: "json",
        snippet: expect.stringContaining('"mcp"'),
        mcp: {
          readany: {
            type: "local",
            command: [
              process.execPath,
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "readonly",
            ],
            enabled: true,
          },
        },
      },
    });
    if (opencode.ok) {
      expect(JSON.parse((opencode.data as { snippet: string }).snippet)).toEqual({
        mcp: {
          readany: {
            type: "local",
            command: [
              process.execPath,
              expect.stringMatching(
                /readany\.(js|ts|cmd)$|dist\/bin\/readany\.js|src\/bin\/readany\.ts/,
              ),
              "mcp",
              "serve",
              "--profile",
              "readonly",
            ],
            enabled: true,
          },
        },
      });
      expect((opencode.data as { snippet: string }).snippet).not.toContain('"mcpServers"');
      expect((opencode.data as { snippet: string }).snippet).not.toContain('"client"');
    }

    const invalidClient = await runCommand(["mcp", "config", "--client", "vscode"], workspace.env);
    expect(invalidClient).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });

    const missingClient = await runCommand(["mcp", "config", "--client", "--json"], workspace.env);
    expect(missingClient).toMatchObject({
      ok: false,
      error: { code: "invalid_option" },
    });

    const missingProfile = await runCommand(
      ["mcp", "config", "--profile", "--json"],
      workspace.env,
    );
    expect(missingProfile).toMatchObject({
      ok: false,
      error: { code: "invalid_option" },
    });

    const missingDoctorProfile = await runCommand(["doctor", "--profile", "--json"], workspace.env);
    expect(missingDoctorProfile).toMatchObject({
      ok: false,
      error: { code: "invalid_option" },
    });

    const invalid = await runCommand(["mcp", "config", "--profile", "root"], workspace.env);
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
  });

  it("returns empty book list from an empty workspace", async () => {
    const workspace = await createWorkspace();
    const result = await runCommand(["books", "list"], workspace.env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ books: [] });
    }
  });

  it("parses generic string options", () => {
    expect(parseCommand(["notes", "search", "agent", "--book", "book-1", "--limit", "5"])).toEqual({
      name: "notes",
      args: ["search", "agent"],
      json: false,
      profile: undefined,
      mode: undefined,
      options: {
        book: "book-1",
        limit: "5",
      },
    });
  });

  it("rejects CLI numeric options outside bounded ranges", async () => {
    const workspace = await createWorkspace();
    const cases = [
      {
        argv: ["books", "list", "--limit", "1000"],
        message: "books list limit maximum",
      },
      {
        argv: ["books", "list", "--limit", "0"],
        message: "books list positive integer",
      },
      {
        argv: ["chapter", "get", "book-1", "1", "--chunk-count", "201"],
        message: "chapter chunk-count maximum",
      },
      {
        argv: ["knowledge", "search", "agent", "--content-limit", "20"],
        message: "knowledge content-limit minimum",
      },
      {
        argv: ["rag", "search", "agent", "--book", "book-1", "--limit", "51"],
        message: "rag limit maximum",
      },
    ];

    for (const item of cases) {
      const result = await runCommand(item.argv, workspace.env);
      expect(result, item.message).toMatchObject({
        ok: false,
        error: { code: "invalid_option" },
      });
    }
  });

  it("lists bookmarks and skills from the CLI", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const bookmarks = await runCommand(["bookmarks", "list", "book-1"], workspace.env);
    expect(bookmarks).toMatchObject({
      ok: true,
      data: {
        bookmarks: [
          {
            id: "bookmark-1",
            bookId: "book-1",
            label: "Review this section",
            chapterTitle: "Tools",
          },
        ],
      },
    });

    const missingBook = await runCommand(["bookmarks", "list"], workspace.env);
    expect(missingBook).toMatchObject({
      ok: false,
      error: { code: "missing_book_id" },
    });

    const skills = await runCommand(["skills", "list"], workspace.env);
    expect(skills).toMatchObject({
      ok: true,
      data: {
        skills: [
          {
            id: "skill-1",
            name: "Chapter Polisher",
            enabled: true,
            builtIn: false,
            parameters: [
              {
                name: "tone",
                type: "string",
                description: "Target tone",
                required: false,
              },
            ],
          },
        ],
      },
    });
  });

  it("creates an EPUB draft with editor profile without changing the source EPUB", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot, workspace.env);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const readonly = await runCommand(["epub", "draft", "create", "book-1"], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toMatchObject({
      draft: {
        bookId: "book-1",
        sourceFilePath: "books/agent.epub",
        draftFilePath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/source\.epub$/),
        manifestPath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/manifest\.json$/),
        historyPath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/history\.jsonl$/),
        sourceHash: expect.any(String),
        inspect: {
          metadata: { title: "Agent Systems" },
        },
      },
    });

    const { draft } = result.data as {
      draft: {
        draftFilePath: string;
        manifestPath: string;
        historyPath: string;
        sourceHash: string;
      };
    };
    expect(draft.sourceHash).toHaveLength(64);
    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    expect(await readFile(join(workspace.dataRoot, draft.draftFilePath))).toEqual(sourceBefore);

    const manifest = JSON.parse(
      await readFile(join(workspace.dataRoot, draft.manifestPath), "utf8"),
    );
    expect(manifest).toMatchObject({
      version: 1,
      bookId: "book-1",
      sourceFilePath: "books/agent.epub",
      draftFilePath: draft.draftFilePath,
      sourceHash: draft.sourceHash,
      status: "draft",
    });

    const history = await readFile(join(workspace.dataRoot, draft.historyPath), "utf8");
    expect(JSON.parse(history.trim())).toMatchObject({
      action: "epub.draft.create",
      bookId: "book-1",
      sourceHash: draft.sourceHash,
    });
  });

  it("reads an EPUB chapter from a draft with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;

    const readonly = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1"],
      workspace.env,
    );
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor", "--limit", "12"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        chapter: {
          source: "draft",
          draftId,
          bookId: "book-1",
          id: "chapter-1",
          href: "chapter-1.xhtml",
          contentFormat: "text",
          content: "Tools",
          contentTruncated: false,
        },
      });
    }

    const xhtmlResult = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor", "--format", "xhtml"],
      workspace.env,
    );
    expect(xhtmlResult.ok).toBe(true);
    if (xhtmlResult.ok) {
      expect(xhtmlResult.data).toMatchObject({
        chapter: {
          contentFormat: "xhtml",
          contentTruncated: false,
        },
      });
      expect((xhtmlResult.data as { chapter: { content: string } }).chapter.content).toContain(
        "<body>Tools</body>",
      );
    }

    const invalidFormat = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor", "--format", "html"],
      workspace.env,
    );
    expect(invalidFormat).toMatchObject({
      ok: false,
      error: { code: "invalid_format" },
    });
  });

  it("patches an EPUB draft chapter with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string; historyPath: string } }).draft
      .draftId;
    const historyPath = (draftResult.data as { draft: { historyPath: string } }).draft.historyPath;
    const xhtmlPath = join(workspace.root, "chapter.xhtml");
    await writeFile(
      xhtmlPath,
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Updated Tools</h1><p>Draft chapter patched by the editor.</p></body></html>`,
      "utf8",
    );

    const readonly = await runCommand(
      ["epub", "chapter", "patch", draftId, "chapter-1", "--xhtml", xhtmlPath],
      workspace.env,
    );
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      [
        "epub",
        "chapter",
        "patch",
        draftId,
        "chapter-1",
        "--xhtml",
        xhtmlPath,
        "--profile",
        "editor",
      ],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      patch: {
        draftId,
        bookId: "book-1",
        chapterId: "chapter-1",
        href: "chapter-1.xhtml",
        resourcePath: "OPS/chapter-1.xhtml",
        changed: true,
        title: "Updated Tools",
        contentPreview: "Updated Tools Draft chapter patched by the editor.",
      },
    });

    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    const readResult = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor"],
      workspace.env,
    );
    expect(readResult).toMatchObject({
      ok: true,
      data: {
        chapter: {
          title: "Updated Tools",
          content: "Updated Tools Draft chapter patched by the editor.",
        },
      },
    });

    const historyLines = (await readFile(join(workspace.dataRoot, historyPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(historyLines.at(-1)).toMatchObject({
      action: "epub.chapter.patch",
      draftId,
      bookId: "book-1",
      chapterId: "chapter-1",
    });
  });

  it("leaves draft state unchanged when chapter patch validation fails", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draft = (
      draftResult.data as {
        draft: { draftId: string; draftFilePath: string; historyPath: string };
      }
    ).draft;
    const draftPath = join(workspace.dataRoot, draft.draftFilePath);
    const historyPath = join(workspace.dataRoot, draft.historyPath);
    const draftBefore = await readFile(draftPath);
    const historyBefore = await readFile(historyPath, "utf8");

    const invalidXhtmlPath = join(workspace.root, "invalid-chapter.xhtml");
    await writeFile(
      invalidXhtmlPath,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>No body</title></head></html>`,
      "utf8",
    );

    const failedPatch = await runCommand(
      [
        "epub",
        "chapter",
        "patch",
        draft.draftId,
        "chapter-1",
        "--xhtml",
        invalidXhtmlPath,
        "--profile",
        "editor",
      ],
      workspace.env,
    );
    expect(failedPatch).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });

    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    expect(await readFile(draftPath)).toEqual(draftBefore);
    expect(await readFile(historyPath, "utf8")).toBe(historyBefore);
    const readAfterFailure = await runCommand(
      ["epub", "chapter", "read", draft.draftId, "chapter-1", "--profile", "editor"],
      workspace.env,
    );
    expect(readAfterFailure).toMatchObject({
      ok: true,
      data: {
        chapter: {
          content: "Tools",
        },
      },
    });
  });

  it("patches an EPUB draft chapter batch through the same draft history", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string; historyPath: string } }).draft
      .draftId;
    const historyPath = (draftResult.data as { draft: { historyPath: string } }).draft.historyPath;
    const patchPath = join(workspace.root, "chapters.patch.json");
    await writeFile(
      patchPath,
      JSON.stringify(
        {
          patches: [
            {
              chapterId: "chapter-1",
              xhtml:
                '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Updated Tools</h1><p>Batch patch first chapter.</p></body></html>',
            },
            {
              chapterId: "chapter-2",
              xhtml:
                '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Updated Drafts</h1><p>Batch patch second chapter.</p></body></html>',
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const readonly = await runCommand(
      ["epub", "chapters", "patch", draftId, "--patch", patchPath],
      workspace.env,
    );
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "chapters", "patch", draftId, "--patch", patchPath, "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      batch: {
        draftId,
        bookId: "book-1",
        requestedCount: 2,
        patchedCount: 2,
        changedCount: 2,
        patches: [
          {
            chapterId: "chapter-1",
            title: "Updated Tools",
            contentPreview: "Updated Tools Batch patch first chapter.",
          },
          {
            chapterId: "chapter-2",
            title: "Updated Drafts",
            contentPreview: "Updated Drafts Batch patch second chapter.",
          },
        ],
      },
    });

    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    const firstRead = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor"],
      workspace.env,
    );
    expect(firstRead).toMatchObject({
      ok: true,
      data: { chapter: { content: "Updated Tools Batch patch first chapter." } },
    });
    const secondRead = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-2", "--profile", "editor"],
      workspace.env,
    );
    expect(secondRead).toMatchObject({
      ok: true,
      data: { chapter: { content: "Updated Drafts Batch patch second chapter." } },
    });

    const historyLines = (await readFile(join(workspace.dataRoot, historyPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(historyLines.slice(-2)).toMatchObject([
      { action: "epub.chapter.patch", draftId, bookId: "book-1", chapterId: "chapter-1" },
      { action: "epub.chapter.patch", draftId, bookId: "book-1", chapterId: "chapter-2" },
    ]);
  });

  it("validates a batch chapter patch before changing draft state", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draft = (
      draftResult.data as {
        draft: { draftId: string; draftFilePath: string; historyPath: string };
      }
    ).draft;
    const draftPath = join(workspace.dataRoot, draft.draftFilePath);
    const historyPath = join(workspace.dataRoot, draft.historyPath);
    const draftBefore = await readFile(draftPath);
    const historyBefore = await readFile(historyPath, "utf8");
    const cases = [
      {
        name: "invalid-xhtml",
        patches: [
          {
            chapterId: "chapter-1",
            xhtml:
              '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Should Not Apply</h1><p>First patch is valid.</p></body></html>',
          },
          {
            chapterId: "chapter-2",
            xhtml:
              '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>No body</title></head></html>',
          },
        ],
      },
      {
        name: "missing-chapter",
        patches: [
          {
            chapterId: "chapter-1",
            xhtml:
              '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Should Not Apply</h1><p>First patch is valid.</p></body></html>',
          },
          {
            chapterId: "missing-chapter",
            xhtml:
              '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Missing Chapter</h1><p>This target does not exist.</p></body></html>',
          },
        ],
      },
    ];

    for (const item of cases) {
      const patchPath = join(workspace.root, `${item.name}.patch.json`);
      await writeFile(patchPath, JSON.stringify({ patches: item.patches }, null, 2), "utf8");

      const failedBatch = await runCommand(
        ["epub", "chapters", "patch", draft.draftId, "--patch", patchPath, "--profile", "editor"],
        workspace.env,
      );
      expect(failedBatch, item.name).toMatchObject({
        ok: false,
        error: { code: "command_failed" },
      });

      expect(await readFile(sourcePath), item.name).toEqual(sourceBefore);
      expect(await readFile(draftPath), item.name).toEqual(draftBefore);
      expect(await readFile(historyPath, "utf8"), item.name).toBe(historyBefore);
      const firstRead = await runCommand(
        ["epub", "chapter", "read", draft.draftId, "chapter-1", "--profile", "editor"],
        workspace.env,
      );
      const secondRead = await runCommand(
        ["epub", "chapter", "read", draft.draftId, "chapter-2", "--profile", "editor"],
        workspace.env,
      );
      expect(firstRead, item.name).toMatchObject({
        ok: true,
        data: { chapter: { content: "Tools" } },
      });
      expect(secondRead, item.name).toMatchObject({
        ok: true,
        data: { chapter: { content: "Drafts" } },
      });
    }
  });

  it("patches EPUB draft metadata with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string; historyPath: string } }).draft
      .draftId;
    const historyPath = (draftResult.data as { draft: { historyPath: string } }).draft.historyPath;
    const patchPath = join(workspace.root, "metadata.json");
    await writeFile(
      patchPath,
      JSON.stringify({
        title: "Agent Systems Revised",
        creator: "Ada Editor",
        language: "zh-CN",
        publisher: "ReadAny Drafts",
        description: "Revised metadata from a controlled draft patch.",
        subjects: ["AI", "Agents"],
        modified: "2026-06-16T00:00:00Z",
      }),
      "utf8",
    );

    const readonly = await runCommand(
      ["epub", "metadata", "patch", draftId, "--patch", patchPath],
      workspace.env,
    );
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "metadata", "patch", draftId, "--patch", patchPath, "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      metadata: {
        draftId,
        bookId: "book-1",
        packagePath: "OPS/package.opf",
        changed: true,
        metadata: {
          title: "Agent Systems Revised",
          creator: "Ada Editor",
          language: "zh-CN",
          publisher: "ReadAny Drafts",
          description: "Revised metadata from a controlled draft patch.",
          modified: "2026-06-16T00:00:00Z",
          subjects: ["AI", "Agents"],
        },
      },
    });

    expect(await readFile(sourcePath)).toEqual(sourceBefore);
    const historyLines = (await readFile(join(workspace.dataRoot, historyPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(historyLines.at(-1)).toMatchObject({
      action: "epub.metadata.patch",
      draftId,
      bookId: "book-1",
      fields: ["title", "creator", "language", "publisher", "description", "modified", "subjects"],
    });
  });

  it("accepts metadata patch files with a metadata wrapper", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;
    const patchPath = join(workspace.root, "metadata-wrapper.json");
    await writeFile(
      patchPath,
      JSON.stringify({
        metadata: {
          description: "Wrapped metadata patch from an external agent.",
        },
      }),
      "utf8",
    );

    const result = await runCommand(
      ["epub", "metadata", "patch", draftId, "--patch", patchPath, "--profile", "editor"],
      workspace.env,
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        metadata: {
          changed: true,
          fields: ["description"],
          metadata: {
            description: "Wrapped metadata patch from an external agent.",
          },
        },
      },
    });
  });

  it("undoes a prior EPUB draft patch with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string; historyPath: string } }).draft
      .draftId;
    const historyPath = (draftResult.data as { draft: { historyPath: string } }).draft.historyPath;
    const xhtmlPath = join(workspace.root, "chapter-undo.xhtml");
    await writeFile(
      xhtmlPath,
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Undo Tools</h1><p>Undo restores the original chapter.</p></body></html>`,
      "utf8",
    );

    const patchResult = await runCommand(
      [
        "epub",
        "chapter",
        "patch",
        draftId,
        "chapter-1",
        "--xhtml",
        xhtmlPath,
        "--profile",
        "editor",
      ],
      workspace.env,
    );
    expect(patchResult.ok).toBe(true);
    if (!patchResult.ok) return;
    const operationId = (patchResult.data as { patch: { operationId: string } }).patch.operationId;

    const readonly = await runCommand(["epub", "undo", draftId, operationId], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const undoResult = await runCommand(
      ["epub", "undo", draftId, operationId, "--profile", "editor"],
      workspace.env,
    );
    expect(undoResult.ok).toBe(true);
    if (!undoResult.ok) return;
    expect(undoResult.data).toMatchObject({
      undo: {
        draftId,
        bookId: "book-1",
        operationId,
        undoneAction: "epub.chapter.patch",
        resourcePath: "OPS/chapter-1.xhtml",
        changed: true,
      },
    });
    expect(await readFile(sourcePath)).toEqual(sourceBefore);

    const historyLines = (await readFile(join(workspace.dataRoot, historyPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(historyLines.at(-1)).toMatchObject({
      action: "epub.undo",
      draftId,
      operationId,
      undoneAction: "epub.chapter.patch",
    });

    const chapterAfterUndo = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor"],
      workspace.env,
    );
    expect(chapterAfterUndo).toMatchObject({
      ok: true,
      data: {
        chapter: {
          content: "Tools",
        },
      },
    });
  });

  it("reads EPUB draft history with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;

    const readonly = await runCommand(["epub", "history", draftId], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "history", draftId, "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      history: {
        draftId,
        bookId: "book-1",
        status: "draft",
        historyPath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/history\.jsonl$/),
        entries: [
          {
            action: "epub.draft.create",
            bookId: "book-1",
            draftId,
          },
        ],
      },
    });
  });

  it("discards an EPUB draft and blocks further draft access", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string; historyPath: string } }).draft
      .draftId;
    const historyPath = (draftResult.data as { draft: { historyPath: string } }).draft.historyPath;

    const readonly = await runCommand(["epub", "draft", "discard", draftId], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const discarded = await runCommand(
      ["epub", "draft", "discard", draftId, "--profile", "editor", "--reason", "no longer needed"],
      workspace.env,
    );
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) return;
    expect(discarded.data).toMatchObject({
      discarded: {
        draftId,
        bookId: "book-1",
        status: "discarded",
        manifestPath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/manifest\.json$/),
        historyPath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/history\.jsonl$/),
      },
    });

    const manifest = JSON.parse(
      await readFile(join(workspace.dataRoot, `drafts/epub/${draftId}/manifest.json`), "utf8"),
    );
    expect(manifest.status).toBe("discarded");

    const historyLines = (await readFile(join(workspace.dataRoot, historyPath), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(historyLines.at(-1)).toMatchObject({
      action: "epub.draft.discard",
      draftId,
      bookId: "book-1",
      reason: "no longer needed",
    });

    const readAfterDiscard = await runCommand(
      ["epub", "chapter", "read", draftId, "chapter-1", "--profile", "editor"],
      workspace.env,
    );
    expect(readAfterDiscard).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
    if (!readAfterDiscard.ok) {
      expect(String(readAfterDiscard.error.message)).toMatch(/discarded/i);
    }
  });

  it("diffs an EPUB draft against the original with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;

    const xhtmlPath = join(workspace.root, "chapter.xhtml");
    await writeFile(
      xhtmlPath,
      `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Diffed Tools</h1><p>Draft chapter changed before diff.</p></body></html>`,
      "utf8",
    );
    const patchResult = await runCommand(
      [
        "epub",
        "chapter",
        "patch",
        draftId,
        "chapter-1",
        "--xhtml",
        xhtmlPath,
        "--profile",
        "editor",
      ],
      workspace.env,
    );
    expect(patchResult.ok).toBe(true);

    const readonly = await runCommand(["epub", "diff", draftId], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "diff", draftId, "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      diff: {
        draftId,
        bookId: "book-1",
        sourceFilePath: "books/agent.epub",
        draftFilePath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/source\.epub$/),
        changedCount: 1,
        modifiedCount: 1,
        entries: expect.arrayContaining([
          expect.objectContaining({
            path: "OPS/chapter-1.xhtml",
            status: "modified",
            sourceHash: expect.any(String),
            draftHash: expect.any(String),
          }),
        ]),
      },
    });
    expect(JSON.stringify(result.data)).not.toContain(workspace.root);
  });

  it("rebuilds an EPUB draft toc with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;

    const readonly = await runCommand(["epub", "toc", "rebuild", draftId], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "toc", "rebuild", draftId, "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      toc: {
        draftId,
        bookId: "book-1",
        navPath: "OPS/nav.xhtml",
        itemCount: 2,
        items: [
          { id: "chapter-1", href: "chapter-1.xhtml", label: "chapter-1" },
          { id: "chapter-2", href: "chapter-2.xhtml", label: "chapter-2" },
        ],
      },
    });
    expect(JSON.stringify(result.data)).not.toContain(workspace.root);
  });

  it("validates an EPUB draft with publisher profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;

    const editor = await runCommand(
      ["epub", "validate", draftId, "--profile", "editor"],
      workspace.env,
    );
    expect(editor).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "validate", draftId, "--profile", "publisher"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      validation: {
        draftId,
        bookId: "book-1",
        valid: true,
        draftFilePath: expect.stringMatching(/^drafts\/epub\/book-1-.+\/source\.epub$/),
        packagePath: "OPS/package.opf",
        manifestItemCount: 3,
        spineItemCount: 2,
        tocItemCount: 2,
        errorCount: 0,
        issues: [],
      },
    });
    expect(JSON.stringify(result.data)).not.toContain(workspace.root);
  });

  it("exports an EPUB draft with publisher profile after validation", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const sourcePath = join(workspace.dataRoot, "books", "agent.epub");
    const sourceBefore = await readFile(sourcePath);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draftId = (draftResult.data as { draft: { draftId: string } }).draft.draftId;
    const outputPath = join(workspace.root, "exports", "agent-export.epub");

    const editor = await runCommand(
      ["epub", "export", draftId, "--output", outputPath, "--profile", "editor"],
      workspace.env,
    );
    expect(editor).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "export", draftId, "--output", outputPath, "--profile", "publisher"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      export: {
        draftId,
        bookId: "book-1",
        outputPath,
        outputHash: expect.any(String),
        outputSize: sourceBefore.byteLength,
        validation: {
          valid: true,
          errorCount: 0,
        },
      },
    });
    expect(await readFile(outputPath)).toEqual(sourceBefore);
    expect(await readFile(sourcePath)).toEqual(sourceBefore);

    const overwriteDenied = await runCommand(
      ["epub", "export", draftId, "--output", outputPath, "--profile", "publisher"],
      workspace.env,
    );
    expect(overwriteDenied).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });

  });

  it("refuses to export an invalid EPUB draft without writing output", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const draftResult = await runCommand(
      ["epub", "draft", "create", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(draftResult.ok).toBe(true);
    if (!draftResult.ok) return;
    const draft = (draftResult.data as { draft: { draftId: string; draftFilePath: string } }).draft;
    await writeFile(
      join(workspace.dataRoot, draft.draftFilePath),
      buildInvalidMissingResourceEpub(),
    );

    const validation = await runCommand(
      ["epub", "validate", draft.draftId, "--profile", "publisher"],
      workspace.env,
    );
    expect(validation).toMatchObject({
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

    const outputPath = join(workspace.root, "exports", "invalid-export.epub");
    const exported = await runCommand(
      ["epub", "export", draft.draftId, "--output", outputPath, "--profile", "publisher"],
      workspace.env,
    );
    expect(exported).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
    if (!exported.ok) {
      expect(exported.error.message).toMatch(/validation failed/i);
    }
    await expect(readFile(outputPath)).rejects.toThrow();
  });

  it("reads seeded books, notes, and highlights through core queries", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const books = await runCommand(["books", "search", "agent"], workspace.env);
    expect(books.ok).toBe(true);
    if (books.ok) {
      expect(books.data).toMatchObject({
        books: [
          {
            id: "book-1",
            meta: {
              title: "Agent Systems",
              author: "Ada Reader",
            },
          },
        ],
      });
    }

    const notes = await runCommand(["notes", "search", "boundaries"], workspace.env);
    expect(notes.ok).toBe(true);
    if (notes.ok) {
      expect(notes.data).toMatchObject({
        notes: [{ id: "note-1", title: "Planning note" }],
      });
    }

    const highlights = await runCommand(["highlights", "search", "draft-first"], workspace.env);
    expect(highlights.ok).toBe(true);
    if (highlights.ok) {
      expect(highlights.data).toMatchObject({
        highlights: [{ id: "highlight-1", text: "Draft-first editing keeps users safe." }],
      });
    }
  });

  it("inspects an EPUB with editor profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const readonly = await runCommand(["epub", "inspect", "book-1"], workspace.env);
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      ["epub", "inspect", "book-1", "--profile", "editor"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        epub: {
          bookId: "book-1",
          filePath: "books/agent.epub",
          packagePath: "OPS/package.opf",
          metadata: {
            title: "Agent Systems",
            creator: "Ada Reader",
            language: "en",
          },
          manifest: { count: 3 },
          spine: { count: 2 },
          toc: {
            count: 2,
            items: [
              { label: "Tools", href: "chapter-1.xhtml" },
              { label: "Drafts", href: "chapter-2.xhtml" },
            ],
          },
        },
      });
    }
  });

  it("searches indexed chunks with BM25 rag search", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const result = await runCommand(
      ["rag", "search", "permissioned context", "--book", "book-1", "--limit", "1"],
      workspace.env,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        results: [
          {
            matchType: "bm25",
            chunk: {
              id: "chunk-1",
              bookId: "book-1",
              chapterTitle: "Tools",
              startCfi: "epubcfi(/6/10)",
            },
          },
        ],
      });
    }
  });

  it("lists and reads indexed chapters from stored chunks", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const chapters = await runCommand(["chapters", "list", "book-1"], workspace.env);
    expect(chapters.ok).toBe(true);
    if (chapters.ok) {
      expect(chapters.data).toMatchObject({
        chapters: [
          {
            id: "1",
            index: 1,
            title: "Tools",
            chunkCount: 2,
            startCfi: "epubcfi(/6/10)",
          },
          {
            id: "2",
            index: 2,
            title: "Drafts",
            chunkCount: 1,
            startCfi: "epubcfi(/6/14)",
          },
        ],
      });
    }

    const chapter = await runCommand(["chapter", "get", "book-1", "2"], workspace.env);
    expect(chapter.ok).toBe(true);
    if (chapter.ok) {
      expect(chapter.data).toMatchObject({
        chapter: {
          id: "2",
          bookId: "book-1",
          title: "Drafts",
          content: "Draft-first editing keeps EPUB sources safe while AI proposes changes.",
          chunks: [{ id: "chunk-2", startCfi: "epubcfi(/6/14)" }],
        },
      });
    }
  });

  it("falls back to epub chapters when no chunks are indexed", async () => {
    const workspace = await createWorkspace();
    await resetCoreForTests();
    await ensureCoreInitialized(workspace.env);

    const db = new Database(join(workspace.dataRoot, "readany.db"));
    db.exec(`
      INSERT INTO books (
        id, file_path, format, title, author, publisher, language, isbn, description,
        cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
        group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
        is_vectorized, vectorize_progress, tags, file_hash, sync_status
      ) VALUES (
        'epub-book', 'books/epub-book.epub', 'epub', 'Fallback EPUB', 'Ada Reader', NULL, 'en',
        NULL, 'A fallback epub only', NULL, NULL, NULL, NULL, '["AI"]',
        100, 2, NULL, 1000, 2000, 3000, NULL, 0.5, 'epubcfi(/6/2)', 0, 0,
        '["epub"]', 'hash-epub', 'local'
      );
    `);
    db.close();
    await writeFile(join(workspace.dataRoot, "books", "epub-book.epub"), buildInspectableEpub());

    const book = await runCommand(["book", "get", "epub-book"], workspace.env);
    expect(book.ok).toBe(true);
    if (book.ok) {
      expect(book.data).toMatchObject({
        book: {
          id: "epub-book",
          format: "epub",
        },
      });
    }

    const chapters = await runCommand(["chapters", "list", "epub-book"], workspace.env);
    expect(chapters.ok).toBe(true);
    if (chapters.ok) {
      expect(chapters.data).toMatchObject({
        chapters: [
          {
            source: "epub",
            id: "chapter-1",
            title: "Tools",
            href: "chapter-1.xhtml",
          },
          {
            source: "epub",
            id: "chapter-2",
            title: "Drafts",
            href: "chapter-2.xhtml",
          },
        ],
      });
    }

    const chapter = await runCommand(["chapter", "get", "epub-book", "chapter-1"], workspace.env);
    expect(chapter.ok).toBe(true);
    if (chapter.ok) {
      expect(chapter.data).toMatchObject({
        chapter: {
          source: "book",
          bookId: "epub-book",
          id: "chapter-1",
          content: "Tools",
        },
      });
    }
  });

  it("falls back to pdf pages when no chunks are indexed", async () => {
    const workspace = await createWorkspace();
    await resetCoreForTests();
    await ensureCoreInitialized(workspace.env);

    const db = new Database(join(workspace.dataRoot, "readany.db"));
    db.exec(`
      INSERT INTO books (
        id, file_path, format, title, author, publisher, language, isbn, description,
        cover_url, publish_date, rating, reviews, subjects, total_pages, total_chapters,
        group_id, added_at, last_opened_at, updated_at, deleted_at, progress, current_cfi,
        is_vectorized, vectorize_progress, tags, file_hash, sync_status
      ) VALUES (
        'pdf-book', 'books/pdf-book.pdf', 'pdf', 'Fallback PDF', 'Ada Reader', NULL, 'en',
        NULL, 'A fallback pdf only', NULL, NULL, NULL, NULL, '["AI"]',
        2, 2, NULL, 1000, 2000, 3000, NULL, 0.5, 'page:1', 0, 0,
        '["pdf"]', 'hash-pdf', 'local'
      );
    `);
    db.close();
    await writeFile(
      join(workspace.dataRoot, "books", "pdf-book.pdf"),
      buildSimplePdf(["PDF agents need safe access", "Second page keeps references stable"]),
    );

    const chapters = await runCommand(["chapters", "list", "pdf-book"], workspace.env);
    expect(chapters.ok).toBe(true);
    if (chapters.ok) {
      expect(chapters.data).toMatchObject({
        chapters: [
          { source: "pdf", id: "page-1", title: "Page 1", page: 1 },
          { source: "pdf", id: "page-2", title: "Page 2", page: 2 },
        ],
      });
    }

    const chapter = await runCommand(["chapter", "get", "pdf-book", "page-1"], workspace.env);
    expect(chapter.ok).toBe(true);
    if (chapter.ok) {
      expect(chapter.data).toMatchObject({
        chapter: {
          source: "pdf",
          bookId: "pdf-book",
          id: "page-1",
          page: 1,
          cfi: "page:1",
          content: "PDF agents need safe access",
        },
      });
    }
  });

  it("reads indexed chapter chunk ranges", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const result = await runCommand(
      ["chapter", "get", "book-1", "1", "--chunk-start", "2", "--chunk-count", "1"],
      workspace.env,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        chapter: {
          id: "1",
          chunkCount: 2,
          totalChunkCount: 2,
          returnedChunkCount: 1,
          chunkStart: 2,
          rangeTruncated: true,
          content: "Bounded chapter ranges keep external AI responses compact.",
          chunks: [{ id: "chunk-1b" }],
        },
      });
    }
  });

  it("returns chapter_not_found for missing indexed chapters", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const result = await runCommand(["chapter", "get", "book-1", "99"], workspace.env);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "chapter_not_found" },
    });
  });

  it("exports notes and highlights with publisher profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const outputPath = join(workspace.root, "exports", "notes.md");

    const readonly = await runCommand(
      ["notes", "export", "book-1", "--output", outputPath],
      workspace.env,
    );
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      [
        "notes",
        "export",
        "book-1",
        "--output",
        outputPath,
        "--profile",
        "publisher",
        "--format",
        "markdown",
      ],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      export: {
        bookId: "book-1",
        outputPath,
        outputHash: expect.any(String),
        outputSize: expect.any(Number),
        format: "markdown",
        noteCount: 1,
        highlightCount: 1,
      },
    });
    const exported = await readFile(outputPath, "utf8");
    expect(exported).toContain("# Agent Systems");
    expect(exported).toContain("Draft-first editing keeps users safe.");
    expect(exported).toContain("Planning note");
    expect(JSON.stringify(result.data)).not.toContain("Agents need safe tool boundaries.");

    const overwriteBlocked = await runCommand(
      ["notes", "export", "book-1", "--output", outputPath, "--profile", "publisher"],
      workspace.env,
    );
    expect(overwriteBlocked).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
  });

  it("exports library knowledge with publisher profile", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);
    const outputPath = join(workspace.root, "exports", "knowledge.md");

    const readonly = await runCommand(
      ["knowledge", "export", "--output", outputPath],
      workspace.env,
    );
    expect(readonly).toMatchObject({
      ok: false,
      error: { code: "permission_denied" },
    });

    const result = await runCommand(
      [
        "knowledge",
        "export",
        "--output",
        outputPath,
        "--profile",
        "publisher",
        "--format",
        "markdown",
      ],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      export: {
        outputPath,
        outputHash: expect.any(String),
        outputSize: expect.any(Number),
        format: "markdown",
        bookCount: 1,
        noteCount: 1,
        highlightCount: 1,
      },
    });
    expect(JSON.stringify(result.data)).not.toContain("Agents need safe tool boundaries.");

    const exported = await readFile(outputPath, "utf8");
    expect(exported).toContain("# ReadAny Knowledge Export");
    expect(exported).toContain("## Agent Systems");
    expect(exported).toContain("Draft-first editing keeps users safe.");
    expect(exported).toContain("Agents need safe tool boundaries.");

    const overwriteBlocked = await runCommand(
      ["knowledge", "export", "--output", outputPath, "--profile", "publisher"],
      workspace.env,
    );
    expect(overwriteBlocked).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
  });

  it("searches library knowledge with bounded snippets", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const result = await runCommand(
      ["knowledge", "search", "safe", "--limit", "5", "--content-limit", "40"],
      workspace.env,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      knowledge: {
        query: "safe",
        returned: 3,
        results: [
          {
            source: "note",
            id: "note-1",
            bookId: "book-1",
            bookTitle: "Agent Systems",
            reference: {
              bookId: "book-1",
              noteId: "note-1",
              cfi: "epubcfi(/6/4)",
              chapterTitle: "Tools",
            },
          },
          {
            source: "highlight",
            id: "highlight-1",
            reference: {
              bookId: "book-1",
              highlightId: "highlight-1",
              cfi: "epubcfi(/6/8)",
            },
          },
          {
            source: "book",
            id: "book-1",
          },
        ],
      },
    });
    const payload = result.data as { knowledge: { results: Array<{ snippet: string }> } };
    expect(payload.knowledge.results.every((item) => item.snippet.length <= 40)).toBe(true);
  });

  it("requires a book id for rag search", async () => {
    const result = await runCommand(["rag", "search", "context"], (await createWorkspace()).env);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "missing_book_id" },
    });
  });

  it("allows hybrid rag mode to fall back to BM25 without embeddings", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const result = await runCommand(
      ["rag", "search", "context", "--book", "book-1", "--mode", "hybrid"],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results[0]).toMatchObject({
      matchType: "bm25",
      chunk: {
        id: "chunk-1",
      },
    });
  });

  it("requires embedding configuration for vector rag mode", async () => {
    const workspace = await createWorkspace();
    await seedLibrary(workspace.dataRoot);

    const result = await runCommand(
      ["rag", "search", "context", "--book", "book-1", "--mode", "vector"],
      workspace.env,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "command_failed" },
    });
  });

  it("runs vector rag mode with configured remote embeddings", async () => {
    const workspace = await createWorkspace();
    await seedVectorLibrary(workspace.dataRoot);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0, 1, 0.5] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      const result = await runCommand(
        ["rag", "search", "semantic meaning", "--book", "vector-book", "--mode", "vector"],
        {
          ...workspace.env,
          READANY_EMBEDDING_MODEL: "test-embedding",
          READANY_EMBEDDING_BASE_URL: "http://localhost:1234/v1",
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.results[0]).toMatchObject({
        matchType: "vector",
        chunk: {
          id: "vector-chunk-1",
        },
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("returns unavailable reader context when no snapshot exists", async () => {
    const workspace = await createWorkspace();
    const result = await runCommand(["context", "get", "--json"], workspace.env);
    expect(result).toMatchObject({
      ok: true,
      data: {
        readerContext: {
          available: false,
          context: null,
        },
      },
    });
  });

  it("reads the latest reader context snapshot", async () => {
    const workspace = await createWorkspace();
    await writeReaderContextSnapshot(workspace.dataRoot);

    const result = await runCommand(["context", "get", "--json", "--limit", "24"], workspace.env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      readerContext: {
        available: true,
        context: {
          bookId: "book-1",
          bookTitle: "Agent Systems",
          currentChapter: {
            index: 1,
            title: "Tools",
          },
          currentPosition: {
            cfi: "epubcfi(/6/10)",
            percentage: 0.42,
          },
          selection: {
            cfi: "epubcfi(/6/10)",
            text: "Agents need safe tool bo",
          },
          surroundingText: "Agents need safe tool bo",
          recentHighlights: [
            {
              text: "Draft-first editing keep",
            },
          ],
        },
      },
    });
  });

  it("can omit optional reader context text fields", async () => {
    const workspace = await createWorkspace();
    await writeReaderContextSnapshot(workspace.dataRoot);

    const result = await runCommand(
      [
        "context",
        "get",
        "--json",
        "--include-selection",
        "false",
        "--include-surrounding-text",
        "false",
        "--include-highlights",
        "false",
      ],
      workspace.env,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.readerContext.context.selection).toBeUndefined();
    expect(result.data.readerContext.context.surroundingText).toBe("");
    expect(result.data.readerContext.context.recentHighlights).toEqual([]);
  });

  it("rejects unknown rag modes", async () => {
    const result = await runCommand(
      ["rag", "search", "context", "--book", "book-1", "--mode", "semantic"],
      (await createWorkspace()).env,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "unsupported_rag_mode" },
    });
  });

});
