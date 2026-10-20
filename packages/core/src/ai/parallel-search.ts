import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { getPlatformService } from "../services/platform";

const ENDPOINT = "https://search.parallel.ai/mcp";
const USER_AGENT = "ReadAny/1.0 (+https://github.com/codedogQBY/ReadAny)";
const REQUEST_TIMEOUT_MS = 25_000;

export interface WebSearchContext {
  conversationId: string;
  modelName: string;
  signal?: AbortSignal;
}

// Cache promises rather than mutable client context: concurrent calls for one
// thread share its ID, while interleaved threads cannot overwrite each other.
const conversationSessions = new Map<string, Promise<string>>();

export function createSearchSessionId(): string {
  // Opaque correlation ID, not a credential. Works in native runtimes without
  // the browser crypto global; never includes book text or a user's identity.
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function getSessionId(conversationId: string): Promise<string> {
  let pending = conversationSessions.get(conversationId);
  if (!pending) {
    pending = (async () => {
      const platform = getPlatformService();
      const key = `parallel-search-session:${conversationId}`;
      const saved = await platform.kvGetItem(key);
      if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
      const id = createSearchSessionId();
      await platform.kvSetItem(key, id);
      return id;
    })().finally(() => {
      conversationSessions.delete(conversationId);
    });
    conversationSessions.set(conversationId, pending);
  }
  return pending;
}

/** Use the SDK's HTTP transport with ReadAny's native network permissions. */
export async function callParallelTool(
  name: "web_search" | "web_fetch",
  args: Record<string, unknown>,
  context: WebSearchContext,
): Promise<unknown> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  context.signal?.addEventListener("abort", cancel, { once: true });
  if (context.signal?.aborted) cancel();
  const timer = setTimeout(cancel, REQUEST_TIMEOUT_MS);
  const client = new Client({ name: "ReadAny", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: async (input, init) => {
      if (init?.signal?.aborted) cancel();
      init?.signal?.addEventListener("abort", cancel, { once: true });
      const headers = new Headers(init?.headers);
      headers.set("User-Agent", USER_AGENT);
      return getPlatformService().fetch(String(input), {
        ...init,
        headers: Object.fromEntries(headers),
        signal: controller.signal,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    },
  });
  try {
    const sessionId = await getSessionId(context.conversationId);
    if (controller.signal.aborted) throw new Error("Web search cancelled or timed out.");
    await client.connect(transport, { signal: controller.signal, timeout: REQUEST_TIMEOUT_MS });
    const result = CallToolResultSchema.parse(
      await client.callTool(
        {
          name,
          arguments: {
            ...args,
            session_id: sessionId,
            ...(context.modelName && context.modelName.length <= 100
              ? { model_name: context.modelName }
              : {}),
          },
        },
        undefined,
        { signal: controller.signal, timeout: REQUEST_TIMEOUT_MS },
      ),
    );
    if (result.isError) {
      const message = result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      throw new Error(message || "Parallel could not complete the request.");
    }
    return result.structuredContent ?? { content: result.content };
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", cancel);
    await client.close();
  }
}
