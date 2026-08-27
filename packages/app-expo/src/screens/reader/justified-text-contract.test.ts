import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("justified EPUB text setting", () => {
  it("persists a default-on optional setting and migrates existing readers", () => {
    const bookTypes = readSource("packages/core/src/types/book.ts");
    const settingsStore = readSource("packages/core/src/stores/settings-store.ts");

    expect(bookTypes).toMatch(/justifyBodyText\?: boolean/);
    expect(settingsStore).toMatch(/justifyBodyText: true/);
    expect(settingsStore).toMatch(
      /readSettings\?\.justifyBodyText === undefined[\s\S]*?readSettings:\s*\{[\s\S]*?justifyBodyText: true/,
    );
  });

  it("exposes the toggle and carries it through every full reader payload", () => {
    const settingsPanel = readSource(
      "packages/app-expo/src/screens/reader/ReaderSettingsPanel.tsx",
    );
    const readerBridge = readSource("packages/app-expo/src/hooks/use-reader-bridge.ts");

    expect(settingsPanel).toMatch(/t\("reader\.justifyBodyText"/);
    expect(settingsPanel).toMatch(
      /onUpdateSetting\(\s*"justifyBodyText",\s*readSettings\.justifyBodyText === false\s*\)/,
    );
    expect(readerBridge.match(/justifyBodyText\?: boolean/g)).toHaveLength(2);
    expect(readerBridge).toContain("function withJustifiedTextSetting");
    expect(readerBridge).toContain(
      "useSettingsStore.getState().readSettings.justifyBodyText !== false",
    );
    expect(readerBridge.match(/withJustifiedTextSetting\(/g)).toHaveLength(3);
  });

  it("provides reader copy in every supported locale", () => {
    const expected = {
      en: ["Justify body text", "Align ordinary prose to both page edges"],
      es: ["Justificar el texto", "Alinea la prosa normal con ambos bordes de la página"],
      fr: ["Justifier le texte", "Aligne le texte courant sur les deux bords de la page"],
      ja: ["本文を両端揃え", "通常の本文をページの両端に揃えます"],
      ko: ["본문 양쪽 맞춤", "일반 본문을 페이지 양쪽 가장자리에 맞춥니다"],
      zh: ["正文两端对齐", "将普通正文与页面两侧对齐"],
      "zh-TW": ["正文兩端對齊", "將一般正文與頁面兩側對齊"],
    } as const;

    for (const [locale, [label, description]] of Object.entries(expected)) {
      const messages = JSON.parse(
        readSource(`packages/core/src/i18n/locales/${locale}/reader.json`),
      ) as { reader: Record<string, string> };
      expect(messages.reader.justifyBodyText).toBe(label);
      expect(messages.reader.justifyBodyTextDesc).toBe(description);
    }
  });

  it("inlines and invokes the justification helper across reader lifecycle events", () => {
    const template = readSource("packages/app-expo/assets/reader/reader.template.html");
    const builtReader = readSource("packages/app-expo/assets/reader/reader.html");
    const buildScript = readSource("packages/app-expo/scripts/build-reader.js");

    expect(template).toContain("__READANY_JUSTIFIED_TEXT_INSERT_POINT_6c18f4d2__");
    expect(template).toContain("let currentJustifyBodyText = true");
    expect(template).toContain("settings.justifyBodyText !== undefined");
    expect(template).toContain("syncJustifiedTextForAllDocs()");
    expect(template).toContain("globalThis.ReadAnyJustifiedText?.apply(");
    expect(buildScript).toContain('"justified-text.js"');
    expect(buildScript).toContain("JUSTIFIED_TEXT_MARKER");
    // The built reader carries the @layer justify fallback and pins
    // author-aligned <br> blocks; the old marker-based *marking* logic is gone
    // (the marker string survives only as a cleanup constant).
    expect(builtReader).toContain("@layer readany-justify");
    expect(builtReader).toContain("justifyBodyText");
    expect(builtReader).toContain("preserveAlignedBrContainers");
    expect(builtReader).not.toContain("setAttribute(marker");
  });
});
