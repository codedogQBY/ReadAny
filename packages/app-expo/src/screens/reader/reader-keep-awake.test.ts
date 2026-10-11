import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const readSource = (relativePath: string) =>
  readFileSync(resolve(repositoryRoot, relativePath), "utf8");

describe("Android reader keep-awake setting", () => {
  it("persists as opt-in and is exposed only in Android reader settings", () => {
    const bookTypes = readSource("packages/core/src/types/book.ts");
    const readerSettings = readSource(
      "packages/app-expo/src/screens/reader/ReaderSettingsPanel.tsx",
    );
    const generalSettings = readSource(
      "packages/app-expo/src/screens/settings/AppearanceSettingsScreen.tsx",
    );

    expect(bookTypes).toContain("keepScreenOnWhileReading?: boolean");
    expect(readerSettings).toContain('Platform.OS === "android"');
    expect(readerSettings).toContain(
      'onUpdateSetting("keepScreenOnWhileReading", !keepScreenOnWhileReading)',
    );
    expect(readerSettings.indexOf('t("settings.volumeButtonsPageTurn")')).toBeLessThan(
      readerSettings.indexOf('t("settings.keepScreenOnWhileReading"'),
    );
    expect(generalSettings).not.toContain("keepScreenOnWhileReading");
  });

  it("uses the native keep-awake claim only while the reader is focused", () => {
    const owner = readSource("packages/app-expo/src/screens/reader/ReaderKeepAwake.tsx");
    const reader = readSource("packages/app-expo/src/screens/ReaderScreen.tsx");

    expect(owner).toContain('import { useKeepAwake } from "expo-keep-awake"');
    expect(owner).toContain('Platform.OS !== "android" || !enabled || !isFocused');
    expect(owner).toContain('useKeepAwake("readany-reader")');
    expect(reader).toContain("enabled={readSettings.keepScreenOnWhileReading === true}");
    expect(reader).toContain("isFocused={isFocused}");
  });
});
