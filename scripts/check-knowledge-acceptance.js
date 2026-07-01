#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const knowledgeEditorBundlePath = path.join(
  rootDir,
  "packages/app-expo/assets/editor/knowledge-editor.html",
);
const desktopDistDir = path.join(rootDir, "packages/app/dist");
const mobileChatRendererPath = path.join(
  rootDir,
  "packages/app-expo/src/components/chat/PartRenderer.tsx",
);
const mobileKnowledgeEditorPath = path.join(
  rootDir,
  "packages/app-expo/src/components/knowledge/MobileKnowledgeEditor.tsx",
);
const desktopChatRendererPath = path.join(
  rootDir,
  "packages/app/src/components/chat/PartRenderer.tsx",
);
const desktopChatPagePath = path.join(rootDir, "packages/app/src/components/chat/ChatPage.tsx");
const desktopMainPath = path.join(rootDir, "packages/app/src/main.tsx");
const desktopBrowserPreviewPlatformPath = path.join(
  rootDir,
  "packages/app/src/lib/platform/browser-preview-platform-service.ts",
);
const desktopKnowledgeEditorPath = path.join(
  rootDir,
  "packages/app/src/components/knowledge/KnowledgeEditor.tsx",
);
const desktopNotesPagePath = path.join(rootDir, "packages/app/src/components/notes/NotesPage.tsx");
const mobileNotesViewPath = path.join(rootDir, "packages/app-expo/src/screens/NotesView.tsx");

const knowledgeTests = [
  "src/db/__tests__/knowledge-queries.test.ts",
  "src/db/__tests__/knowledge-source-writeback.test.ts",
  "src/db/__tests__/db-core.test.ts",
  "src/db/__tests__/highlight-queries.test.ts",
  "src/db/__tests__/note-queries.test.ts",
  "src/sync/__tests__/simple-sync.integration.test.ts",
  "src/sync/__tests__/sync-files.test.ts",
  "src/knowledge/document-utils.test.ts",
  "src/knowledge/vault-path-fidelity.test.ts",
  "src/knowledge/editor-profile.test.ts",
  "src/knowledge/editor-projection.test.ts",
  "src/knowledge/editor-draft.test.ts",
  "src/knowledge/mobile-editor-bridge.test.ts",
  "src/knowledge/rich-text-preservation.test.ts",
  "src/knowledge/card-registry.test.ts",
  "src/knowledge/attachments.test.ts",
  "src/knowledge/internal-links.test.ts",
  "src/knowledge/source-links.test.ts",
  "src/knowledge/proposals.test.ts",
  "src/knowledge/compact-summary.test.ts",
  "src/i18n/locales.test.ts",
  "src/ai/__tests__/system-prompt.test.ts",
  "src/ai/__tests__/streaming.test.ts",
  "src/ai/__tests__/reading-agent-tools.test.ts",
  "src/ai/__tests__/tools.test.ts",
  "src/ai/__tests__/knowledge-context.test.ts",
  "src/ai/__tests__/knowledge-memory.test.ts",
  "src/ai/__tests__/tool-call-state.test.ts",
  "src/ai/__tests__/knowledge-tool-result.test.ts",
  "src/ai/__tests__/tool-result.test.ts",
  "src/ai/tools/knowledge-tools.test.ts",
  "src/export/knowledge-exporter.test.ts",
  "src/export/knowledge-importer.test.ts",
  "src/export/obsidian-uri.test.ts",
];

const commands = [
  [
    "pnpm",
    ["--filter", "@readany/core", "exec", "vitest", "run", ...knowledgeTests],
    "knowledge acceptance tests",
  ],
  ["pnpm", ["--filter", "@readany/core", "exec", "tsc", "--noEmit"], "core TypeScript"],
  ["pnpm", ["--filter", "app", "exec", "tsc", "--noEmit"], "desktop TypeScript"],
  ["pnpm", ["--filter", "app", "exec", "vite", "build"], "desktop production bundle"],
  ["pnpm", ["--filter", "@readany/app-expo", "exec", "tsc", "--noEmit"], "mobile TypeScript"],
];

function readFile(pathname) {
  return fs.existsSync(pathname) ? fs.readFileSync(pathname, "utf8") : null;
}

function readTextBundle(dir, extensions) {
  if (!fs.existsSync(dir)) {
    console.error(`[knowledge-acceptance] desktop production bundle is missing: ${dir}`);
    process.exit(1);
  }

  const stack = [dir];
  const chunks = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (extensions.has(path.extname(entry.name))) {
        chunks.push(fs.readFileSync(entryPath, "utf8"));
      }
    }
  }

  return chunks.join("\n");
}

function runCommand(command, args, label) {
  console.log(`\n[knowledge-acceptance] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`[knowledge-acceptance] Failed to start ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[knowledge-acceptance] ${label} failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function verifySourceContract(label, pathname, requiredFragments) {
  console.log(`\n[knowledge-acceptance] ${label}`);
  const source = readFile(pathname);
  if (!source) {
    console.error(`[knowledge-acceptance] source file is missing: ${pathname}`);
    process.exit(1);
  }

  const missingFragments = requiredFragments.filter((fragment) => !source.includes(fragment));
  if (missingFragments.length > 0) {
    console.error(
      [
        `[knowledge-acceptance] ${label} is missing required fragments:`,
        ...missingFragments.map((fragment) => `- ${fragment}`),
      ].join("\n"),
    );
    process.exit(1);
  }
}

function verifyDesktopProductionBundleContract() {
  console.log("\n[knowledge-acceptance] desktop production bundle contract");
  const bundle = readTextBundle(desktopDistDir, new Set([".css", ".html", ".js"]));
  const requiredFragments = [
    "readany-knowledge-editor",
    "knowledgeProposal",
    "knowledgeToolResult",
    "readany-card",
    "readany-internal-link",
    "readany-source-reference",
    "knowledgeDocumentSearchPlaceholder",
    "knowledgeDocumentPath",
    "type: readany-knowledge",
    "readany-knowledge-bundle",
    "book_home",
    "standalone_note",
    "highlight_note",
    "imported_markdown",
    "readany-attachment://",
  ];
  const missingFragments = requiredFragments.filter((fragment) => !bundle.includes(fragment));
  if (missingFragments.length > 0) {
    console.error(
      [
        "[knowledge-acceptance] desktop production bundle is missing knowledge features:",
        ...missingFragments.map((fragment) => `- ${fragment}`),
      ].join("\n"),
    );
    process.exit(1);
  }
}

function verifyKnowledgeEditorBundle() {
  const before = readFile(knowledgeEditorBundlePath);
  runCommand(
    "pnpm",
    ["--filter", "@readany/app-expo", "exec", "node", "scripts/build-knowledge-editor.js"],
    "mobile knowledge editor bundle",
  );
  const after = readFile(knowledgeEditorBundlePath);
  if (before !== after) {
    console.error(
      [
        "[knowledge-acceptance] mobile knowledge editor bundle was regenerated.",
        "Commit packages/app-expo/assets/editor/knowledge-editor.html and rerun pnpm acceptance:knowledge.",
      ].join("\n"),
    );
    process.exit(1);
  }
  verifyKnowledgeEditorBundleContract(after);
}

function verifyKnowledgeEditorBundleContract(bundle) {
  if (!bundle) {
    console.error("[knowledge-acceptance] mobile knowledge editor bundle is missing.");
    process.exit(1);
  }

  const requiredFragments = [
    "window.__ReadAnyKnowledgeEditor",
    "ReactNativeWebView",
    "postMessage",
    "loaded",
    "ready",
    "selectionChanged",
    "contentChanged",
    "heightChanged",
    "focusChanged",
    "error",
    "unknown_command",
    "unknown_message",
    "bridge_error",
    "parse_error",
    "setContent",
    "setEditable",
    "requestContent",
    "runCommand",
    "insertImage",
    "insertInternalLink",
    "insertSourceReference",
    "insertCard",
    "readany-card",
    "readany-card-convert",
    "Convert card to normal text",
    "readany-card-structured-fields",
    "readany-card-structured-group-heading",
    "Structured fields",
    "readany-card-multiselect",
    "readany-card-field-missing",
    "readany-card-field-width-half",
    "data-readany-card-field-width",
    "Required value missing.",
    "readany-internal-link",
    "readany-source-reference",
    "readany-image-missing",
    "readany-attachment://",
  ];
  const missingFragments = requiredFragments.filter((fragment) => !bundle.includes(fragment));
  if (missingFragments.length > 0) {
    console.error(
      [
        "[knowledge-acceptance] mobile knowledge editor bundle is missing bridge features:",
        ...missingFragments.map((fragment) => `- ${fragment}`),
      ].join("\n"),
    );
    process.exit(1);
  }
}

function verifyMobileAIKnowledgeChatContract() {
  verifySourceContract("mobile AI knowledge chat contract", mobileChatRendererPath, [
    "getKnowledgeWriteProposal(part.result)",
    "getKnowledgeToolResultDisplay(part.name, part.result",
    "applyKnowledgeWriteProposal(proposal)",
    "KnowledgeProposalCard",
    "KnowledgeToolResultCard",
    'display.kind === "failure"',
    "display.relations",
    "knowledge:open-document",
    "ai_proposal",
    "applyResult",
    "knowledgeToolResult.relations",
    "knowledgeToolResult.openDocument",
    "preview.writeSafety",
    "knowledgeProposal.writeSafety",
    "knowledgeToolResult.failureSafeHint",
    "knowledgeToolResult.matchedIn",
    "document.matchFields",
    "display.writeSafety",
    "knowledgeToolResult.writeSafety",
    "knowledgeProposal.applyFailed",
    'type KnowledgeProposalApplyState = "idle" | "applying" | "applied" | "failed";',
    "proposalApplyError",
    'setProposalApplyState("failed")',
    "knowledgeProposal.failedBadge",
    "knowledgeProposal.applyFailedSafeHint",
    "knowledgeProposal.retry",
    "getKnowledgeProposalApplyErrorDetails",
    "proposalApplyButton",
    "preview.visiblePath",
    "preview.hasPathChange",
  ]);
}

function verifyDesktopAIKnowledgeChatContract() {
  verifySourceContract("desktop AI knowledge chat contract", desktopChatRendererPath, [
    "getKnowledgeWriteProposal(part.result)",
    "getKnowledgeToolResultDisplay(part.name, part.result",
    "applyKnowledgeWriteProposal(proposal)",
    "KnowledgeProposalCard",
    "KnowledgeToolResultCard",
    'display.kind === "failure"',
    "display.relations",
    "knowledge:open-document",
    "ai_proposal",
    "applyResult",
    "knowledgeToolResult.relations",
    "knowledgeToolResult.openDocument",
    "preview.writeSafety",
    "knowledgeProposal.writeSafety",
    "knowledgeToolResult.failureSafeHint",
    "knowledgeToolResult.matchedIn",
    "document.matchFields",
    "display.writeSafety",
    "knowledgeToolResult.writeSafety",
    "knowledgeProposal.applyFailed",
    "knowledgeProposal.applySuccess",
    'type KnowledgeProposalApplyState = "idle" | "applying" | "applied" | "failed";',
    "proposalApplyError",
    'setProposalApplyState("failed")',
    "knowledgeProposal.failedBadge",
    "knowledgeProposal.applyFailedSafeHint",
    "knowledgeProposal.retry",
    "getKnowledgeProposalApplyErrorDetails",
    "preview.visiblePath",
    "preview.hasPathChange",
  ]);
  verifySourceContract("desktop chat citation navigation contract", desktopChatPagePath, [
    "openDesktopBook",
    "handleCitationClick",
    "citation.bookId",
    "initialCfi: citation.cfi?.trim() || undefined",
    "citationOpenedBook",
    "citationBookMissing",
  ]);
}

function verifyDesktopKnowledgeEditorContract() {
  verifySourceContract("desktop knowledge editor contract", desktopKnowledgeEditorPath, [
    "createReadAnyCardTiptapContent",
    "convertToBlocks",
    "insertContentAt",
    "knowledgeCardConvertToText",
    "getReadAnyCardTemplateFields",
    "isReadAnyCardTemplateRequiredValueMissing",
    "normalizeReadAnyCardTemplateFields",
    "knowledgeCustomCardFields",
    "knowledgeCustomCardFieldGroup",
    "knowledgeCustomCardGroupVisibleWhen",
    "knowledgeCustomCardFieldLayout",
    "knowledgeCustomCardFieldOptionDefault",
    "knowledgeCardStructuredFields",
    "knowledgeCardFieldRequiredMissing",
    "createKnowledgeEditorDraftKey",
    "knowledgeEditorDraftFound",
    "restorePendingDraft",
    "knowledgeInsertMinorHeadingHint",
    "knowledgeInsertOrderedListHint",
    "data-readany-card-field-state",
    "data-readany-card-field-width",
    "data-readany-card-control",
    "parseReadAnyCardDataFromEditor",
  ]);
}

function verifyMobileKnowledgeEditorContract() {
  verifySourceContract("mobile knowledge editor contract", mobileKnowledgeEditorPath, [
    "EditorIssueBanner",
    "useMarkdownFallback",
    "pendingDraft",
    "knowledgeEditorLoadFailed",
    "knowledgeEditorRetry",
    "knowledgeEditorDraftRestore",
    "onContentProcessDidTerminate",
    "getReadAnyCardTemplateFields",
    "normalizeReadAnyCardTemplateFields",
    "knowledgeCustomCardFields",
    "knowledgeCustomCardFieldGroup",
    "knowledgeCustomCardGroupVisibleWhen",
    "knowledgeCustomCardFieldLayout",
    "knowledgeCustomCardFieldOptionDefault",
    "knowledgeCustomCardFieldType",
    "knowledgeCustomCardFieldDefault",
    "knowledgeCustomCardRemoveField",
    "knowledgeInsertMinorHeadingHint",
    "knowledgeInsertOrderedListHint",
    "createCustomReadAnyCardTemplate",
    "updateCustomReadAnyCardTemplate",
  ]);
}

function verifyDesktopKnowledgeWorkspaceContract() {
  verifySourceContract("desktop knowledge workspace contract", desktopNotesPagePath, [
    "KnowledgeDocumentExplorer",
    "KnowledgeVaultRootOverview",
    "KnowledgeFolderOverview",
    "KnowledgeFolderBrowserSection",
    "KnowledgeFolderBrowserRow",
    "buildKnowledgeDocumentTree",
    "createKnowledgeRootDisplaySections",
    "createKnowledgeFolderDisplaySections",
    "getKnowledgeDocumentOpenMode",
    "boolean | Promise<boolean>",
    "return false",
    "KnowledgeDocumentBreadcrumbs",
    "KnowledgePathInline",
    "KnowledgeEditor",
    "getKnowledgeEditorSurfaceForDocumentType",
    "KnowledgeMarkdownImportReviewCard",
    "KnowledgeVaultImportReviewCard",
    "knowledgeVaultImportResolutionLabel",
    "knowledgeVaultImportResolution.",
    "entry.resolution",
    "KnowledgeVaultConflictCard",
    "createObsidianVaultFileOpenUri",
    "knowledgeObsidianOpenFile",
    "knowledgeObsidianSearchVault",
    "openExternalUrl",
    "knowledgeDocumentPath",
    "knowledge:open-document",
    "applyBackgroundKnowledgeSummaryUpdate",
    "createKnowledgeSummarySourceFingerprint(knowledgeHome)",
    "queueKnowledgeSummaryMaintenance(summaryDocumentIds)",
    'role="tree"',
    'activeKnowledgeOpenMode === "folder_browser"',
    "isVaultRootOpen ? (",
  ]);
}

function verifyMobileKnowledgeWorkspaceContract() {
  verifySourceContract("mobile knowledge workspace contract", mobileNotesViewPath, [
    'type MobileKnowledgeWorkspaceMode = "vault" | "document"',
    "MobileKnowledgeEditor",
    "KnowledgeDocumentExplorer",
    "KnowledgeDocumentTreeRow",
    "KnowledgeVaultRootOverview",
    "KnowledgeFolderOverview",
    "KnowledgeFolderBrowserGroup",
    "KnowledgeFolderBrowserItem",
    "buildKnowledgeDocumentTree",
    "createKnowledgeRootDisplaySections",
    "createKnowledgeFolderDisplaySections",
    "getKnowledgeDocumentWorkspaceMode",
    "getKnowledgeDocumentOpenMode",
    "getKnowledgeDocumentCreateParentId",
    "boolean | Promise<boolean>",
    "opened === false",
    "filterKnowledgeDocumentTreeNodesForSearch",
    "knowledgeDocumentPathText",
    "knowledge:open-document",
    "KnowledgeMarkdownImportReviewSheet",
    "pickFiles",
    "sourceName",
    "applyKnowledgeWriteProposal",
    "applyBackgroundKnowledgeSummaryUpdate",
    "createKnowledgeSummarySourceFingerprint(knowledgeHome)",
    "queueKnowledgeSummaryMaintenance(summaryDocumentIds)",
    "useKeyboardInsets",
    "documentKeyboardBottomPadding",
    "keyboardInsets.isVisible",
    "KeyboardAvoidingView",
    "knowledgeDocumentKeyboardAvoider",
    "SafeAreaView",
  ]);
}

function verifyDesktopBrowserPreviewContract() {
  verifySourceContract("desktop browser-preview runtime contract", desktopMainPath, [
    "BrowserPreviewPlatformService",
    "isTauriRuntimeAvailable()",
    "setStreamingFetch(globalThis.fetch.bind(globalThis)",
    'import("./lib/tauri-vector-db")',
    'import("./lib/storage/desktop-library-root")',
    'import("./lib/rag/fallback-content-provider")',
  ]);
  verifySourceContract(
    "desktop browser-preview platform contract",
    desktopBrowserPreviewPlatformPath,
    [
      "BrowserPreviewPlatformService",
      "BrowserPreviewDatabase",
      'platformType = "desktop"',
      "loadDatabase",
      "shareOrDownloadFile",
      "LAN sync server is only available in the Tauri desktop app.",
    ],
  );
}

for (const [command, args, label] of commands) {
  runCommand(command, args, label);
}

verifyDesktopProductionBundleContract();
verifyKnowledgeEditorBundle();
verifyDesktopKnowledgeEditorContract();
verifyMobileKnowledgeEditorContract();
verifyDesktopAIKnowledgeChatContract();
verifyMobileAIKnowledgeChatContract();
verifyDesktopKnowledgeWorkspaceContract();
verifyMobileKnowledgeWorkspaceContract();
verifyDesktopBrowserPreviewContract();
runCommand("git", ["diff", "--check"], "diff whitespace check");

console.log("\n[knowledge-acceptance] all automated checks passed");
