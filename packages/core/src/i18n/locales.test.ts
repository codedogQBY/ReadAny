import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type LocaleObject = Record<string, unknown>;

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");
const repoRoot = path.resolve(localesDir, "../../../../..");
const knowledgeNamespaces = ["notes", "chat"] as const;
const knowledgeNotesSourceFiles = [
  "packages/app/src/components/knowledge/KnowledgeEditor.tsx",
  "packages/app/src/components/notes/NotesPage.tsx",
  "packages/app-expo/src/components/knowledge/MobileKnowledgeEditor.tsx",
  "packages/app-expo/src/screens/NotesView.tsx",
] as const;
const knowledgeChatSourceFiles = [
  "packages/app/src/components/chat/MessageList.tsx",
  "packages/app/src/components/chat/PartRenderer.tsx",
  "packages/app/src/components/chat/StreamingIndicator.tsx",
  "packages/app-expo/src/components/chat/MessageList.tsx",
  "packages/app-expo/src/components/chat/PartRenderer.tsx",
  "packages/app-expo/src/components/chat/StreamingIndicator.tsx",
  "packages/core/src/hooks/use-streaming-chat.ts",
] as const;
const knowledgeDocumentTypeKeys = [
  "book_home",
  "folder",
  "standalone_note",
  "highlight_note",
  "review",
  "summary",
  "imported_markdown",
] as const;
const knowledgeToolResultMatchFieldKeys = [
  "title",
  "path",
  "tags",
  "excerpt",
  "summary",
  "content",
] as const;
const knowledgeToolResultWriteSafetyKeys = [
  "read_only",
  "memory_persisted",
  "memory_skipped",
  "no_write_failed",
] as const;
const knowledgeProposalTypeKeys = [
  "knowledgeDocument",
  "bookHome",
  "folder",
  "standaloneNote",
  "highlightNote",
  "review",
  "summary",
  "importedMarkdown",
  "knowledgeLink",
] as const;
const knowledgeProposalFieldKeys = ["parentFolder", "title", "content", "tags"] as const;
const knowledgeProposalApplyErrorKeys = [
  "parent.book_home_locked",
  "parent.missing_parent",
  "parent.parent_not_folder",
  "parent.book_mismatch",
  "parent.missing_document",
  "parent.descendant_parent",
  "parent.invalid_parent",
  "title.duplicate_sibling_title",
  "create.create_id_conflict",
  "update.stale_document",
  "link.missing_source_document",
  "link.missing_target_document",
] as const;

function readLocaleNamespace(locale: string, namespace: (typeof knowledgeNamespaces)[number]) {
  return JSON.parse(
    readFileSync(path.join(localesDir, locale, `${namespace}.json`), "utf8"),
  ) as LocaleObject;
}

function isLocaleObject(value: unknown): value is LocaleObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function flattenKeys(value: LocaleObject, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    return isLocaleObject(child) ? flattenKeys(child, nextKey) : [nextKey];
  });
}

function flattenEntries(value: LocaleObject, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    return isLocaleObject(child) ? flattenEntries(child, nextKey) : [[nextKey, child]];
  });
}

function isKnowledgeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("knowledge") || normalized.includes("card");
}

function localeDirectories() {
  return readdirSync(localesDir)
    .filter((entry) => statSync(path.join(localesDir, entry)).isDirectory())
    .sort();
}

function interpolationPlaceholders(value: unknown): string[] {
  return Array.from(String(value).matchAll(/{{\s*([\w.]+)\s*}}/g))
    .map((match) => match[1])
    .sort();
}

function hasPath(value: LocaleObject, key: string): boolean {
  let current: unknown = value;
  for (const part of key.split(".")) {
    if (!isLocaleObject(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function extractI18nKeysFromSource(sourceFiles: readonly string[], prefixes: readonly string[]) {
  const keys = new Set<string>();
  const pattern = new RegExp(`["'](${prefixes.join("|")})\\.[A-Za-z0-9_.-]+["']`, "g");
  for (const sourceFile of sourceFiles) {
    const source = readFileSync(path.join(repoRoot, sourceFile), "utf8");
    for (const match of source.matchAll(pattern)) {
      const key = match[0].slice(1, -1);
      if (!key.endsWith(".")) keys.add(key);
    }
  }
  return [...keys].sort();
}

describe("i18n knowledge locales", () => {
  it("keeps notes knowledge and card keys inside the notes object", () => {
    for (const locale of localeDirectories()) {
      const topLevelKeys = Object.keys(readLocaleNamespace(locale, "notes")).filter(isKnowledgeKey);
      expect(
        topLevelKeys,
        `${locale}/notes has knowledge i18n keys outside the notes object`,
      ).toEqual([]);
    }
  });

  it("keeps knowledge notes UI keys used by desktop and mobile sources translated", () => {
    const notesLocale = readLocaleNamespace("en", "notes");
    const missingKeys = extractI18nKeysFromSource(knowledgeNotesSourceFiles, [
      "notes\\.knowledge",
    ]).filter((key) => !hasPath(notesLocale, key));
    expect(missingKeys, "English notes locale is missing knowledge UI keys").toEqual([]);
  });

  it("keeps knowledge chat UI keys used by desktop and mobile sources translated", () => {
    const chatLocale = readLocaleNamespace("en", "chat");
    const missingKeys = extractI18nKeysFromSource(knowledgeChatSourceFiles, [
      "knowledgeToolResult",
      "knowledgeProposal",
      "toolLabels",
      "streaming",
    ]).filter((key) => !hasPath(chatLocale, key));
    expect(missingKeys, "English chat locale is missing knowledge chat UI keys").toEqual([]);
  });

  it("keeps dynamic knowledge chat UI keys translated", () => {
    const chatLocale = readLocaleNamespace("en", "chat");
    const expectedKeys = [
      ...knowledgeDocumentTypeKeys.map((key) => `knowledgeToolResult.types.${key}`),
      ...knowledgeToolResultMatchFieldKeys.map(
        (key) => `knowledgeToolResult.matchFields.${key}`,
      ),
      ...knowledgeToolResultWriteSafetyKeys.flatMap((key) => [
        `knowledgeToolResult.writeSafety.${key}.label`,
        `knowledgeToolResult.writeSafety.${key}.description`,
      ]),
      ...knowledgeProposalTypeKeys.map((key) => `knowledgeProposal.types.${key}`),
      ...knowledgeProposalFieldKeys.map((key) => `knowledgeProposal.fields.${key}`),
      "knowledgeProposal.writeSafety.proposal_pending_confirmation.label",
      "knowledgeProposal.writeSafety.proposal_pending_confirmation.description",
      ...knowledgeProposalApplyErrorKeys.map((key) => `knowledgeProposal.errors.${key}`),
    ];
    const missingKeys = expectedKeys.filter((key) => !hasPath(chatLocale, key));

    expect(missingKeys, "English chat locale is missing dynamic knowledge UI keys").toEqual([]);
  });

  it("keeps knowledge and card translation keys available in every locale", () => {
    const locales = localeDirectories()
      .filter((locale) => locale !== "en")
      .sort();

    for (const namespace of knowledgeNamespaces) {
      const expectedKeys = flattenKeys(readLocaleNamespace("en", namespace)).filter(isKnowledgeKey);
      for (const locale of locales) {
        const localeKeys = new Set(flattenKeys(readLocaleNamespace(locale, namespace)));
        const missingKeys = expectedKeys.filter((key) => !localeKeys.has(key));
        expect(missingKeys, `${locale}/${namespace} is missing knowledge i18n keys`).toEqual([]);
      }
    }
  });

  it("keeps knowledge and card interpolation placeholders consistent", () => {
    const locales = localeDirectories()
      .filter((locale) => locale !== "en")
      .sort();

    for (const namespace of knowledgeNamespaces) {
      const expectedEntries = flattenEntries(readLocaleNamespace("en", namespace)).filter(([key]) =>
        isKnowledgeKey(key),
      );
      for (const locale of locales) {
        const localeEntries = new Map(flattenEntries(readLocaleNamespace(locale, namespace)));
        const placeholderMismatches = expectedEntries
          .map(([key, value]) => {
            const expected = interpolationPlaceholders(value);
            const actual = interpolationPlaceholders(localeEntries.get(key));
            return expected.join(",") === actual.join(",")
              ? null
              : { key, expected, actual };
          })
          .filter(Boolean);

        expect(
          placeholderMismatches,
          `${locale}/${namespace} has mismatched knowledge i18n placeholders`,
        ).toEqual([]);
      }
    }
  });
});
