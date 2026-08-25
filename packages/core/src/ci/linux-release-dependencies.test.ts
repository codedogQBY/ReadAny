import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(
  new URL("../../../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

describe("Linux Tauri release dependencies", () => {
  it.each(["pkg-config", "libdbus-1-dev"])("installs %s before the Ubuntu build", (dependency) => {
    const ubuntuInstall = releaseWorkflow.match(
      /- name: Install dependencies \(Ubuntu only\)[\s\S]*?sudo apt-get install -y ([^\n]+)/,
    );

    expect(ubuntuInstall?.[1]?.split(/\s+/)).toContain(dependency);
    expect(releaseWorkflow.indexOf(dependency)).toBeLessThan(
      releaseWorkflow.indexOf("uses: tauri-apps/tauri-action@v0"),
    );
  });
});
