import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Reading settings navigation", () => {
  it("exposes the shared reader settings from Me", () => {
    const profile = read("packages/app-expo/src/screens/ProfileScreen.tsx");
    const navigator = read("packages/app-expo/src/navigation/RootNavigator.tsx");
    const screen = read("packages/app-expo/src/screens/settings/ReadingSettingsScreen.tsx");

    expect(profile).toContain('route: "ReadingSettings"');
    expect(navigator).toContain("ReadingSettings: undefined");
    expect(navigator).toContain('name="ReadingSettings"');
    expect(screen).toContain("<ReaderSettingsPanel");
    expect(screen).toContain("embedded");
    expect(screen).toContain("updateReadSettings({ [key]: value }");
  });
});
