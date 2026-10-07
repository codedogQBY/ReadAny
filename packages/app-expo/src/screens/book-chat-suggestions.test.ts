import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const screensDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(screensDir, "../../../..");
const suggestionKey = 't("chat.suggestions.reviewChapterNotes")';

const clients = [
  resolve(repoRoot, "packages/app/src/components/chat/ChatPanel.tsx"),
  resolve(screensDir, "BookChatScreen.tsx"),
] as const;

const localizedCopy = {
  en: "Review my notes for this chapter",
  zh: "点评我对本章的笔记",
  "zh-TW": "點評我對本章的筆記",
  ja: "この章のメモをレビュー",
  ko: "이 챕터에 대한 내 노트 검토",
  fr: "Relire mes notes sur ce chapitre",
  es: "Revisar mis notas de este capítulo",
} as const;

describe("book chat suggestions", () => {
  for (const client of clients) {
    it(`${client} offers chapter note review`, () => {
      expect(readFileSync(client, "utf8")).toContain(suggestionKey);
    });
  }

  for (const [locale, copy] of Object.entries(localizedCopy)) {
    it(`${locale} provides the chapter note review copy`, () => {
      const messages = JSON.parse(
        readFileSync(
          resolve(repoRoot, `packages/core/src/i18n/locales/${locale}/chat.json`),
          "utf8",
        ),
      ) as { chat: { suggestions: { reviewChapterNotes?: string } } };

      expect(messages.chat.suggestions.reviewChapterNotes).toBe(copy);
    });
  }
});
