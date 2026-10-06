import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("AI streaming keep-awake ownership", () => {
  it("owns the native wake claim from the shared streaming-session state", () => {
    const component = read("packages/app-expo/src/components/chat/AIStreamingKeepAwake.tsx");

    expect(component).toContain('import { useKeepAwake } from "expo-keep-awake"');
    expect(component).toContain('import { useChatStore } from "@/stores/chat-store"');
    expect(component).toContain("hasActiveAIStream(state.streamingSessions)");
    expect(component).toContain('useKeepAwake("readany-ai-stream")');
  });

  it("mounts one owner at app scope beside other global hosts", () => {
    const app = read("packages/app-expo/src/App.tsx");

    expect(app).toContain("import { AIStreamingKeepAwake }");
    expect(app).toMatch(
      /<RootNavigator\s*\/>[\s\S]*<AIStreamingKeepAwake\s*\/>[\s\S]*<UpdateDialog\s*\/>/,
    );
  });
});
