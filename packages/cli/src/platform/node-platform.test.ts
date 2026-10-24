import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodePlatformService } from "./node-platform.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function createEnvironment() {
  const root = await mkdtemp(join(tmpdir(), "readany-node-platform-"));
  temporaryRoots.push(root);
  const appData = join(root, "Roaming");
  const xdgDataHome = join(root, "xdg-data");
  const env: NodeJS.ProcessEnv = { APPDATA: appData, XDG_DATA_HOME: xdgDataHome };
  const defaultRoot =
    process.platform === "win32"
      ? join(appData, "com.readany.app")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support", "com.readany.app")
        : join(xdgDataHome, "com.readany.app");
  return { root, env, defaultRoot };
}

describe("NodePlatformService data directories", () => {
  it("uses the platform data root without READANY_HOME", async () => {
    const { env, defaultRoot } = await createEnvironment();
    const platform = createNodePlatformService(env);
    expect(await platform.getAppDataDir()).toBe(defaultRoot);
    expect(await platform.getDataDir()).toBe(defaultRoot);
  });

  it.skipIf(process.platform === "darwin")(
    "reads the configured desktop data root without READANY_HOME",
    async () => {
      const { root, env, defaultRoot } = await createEnvironment();
      const dataRoot = join(root, "custom library");
      await mkdir(defaultRoot, { recursive: true });
      await writeFile(
        join(defaultRoot, "desktop-data-root.json"),
        JSON.stringify({ dataRoot: `file://${dataRoot}/` }),
        "utf8",
      );
      const platform = createNodePlatformService(env);
      expect(await platform.getAppDataDir()).toBe(defaultRoot);
      expect(await platform.getDataDir()).toBe(dataRoot);
    },
  );

  it("preserves the READANY_HOME override", async () => {
    const { root, env } = await createEnvironment();
    const home = join(root, "override");
    const platform = createNodePlatformService({ ...env, READANY_HOME: home });
    expect(await platform.getAppDataDir()).toBe(resolve(home));
    expect(await platform.getDataDir()).toBe(resolve(home));
  });
});
