/**
 * Message processing pipeline
 * - Citation reference injection
 * - 8-message sliding window
 * - Context assembly
 */
import type { Message, Thread, SemanticContext } from "@/types";
import { buildSystemPrompt } from "./system-prompt";
import type { Book, Skill } from "@/types";

interface PipelineConfig {
  slidingWindowSize: number; // default 8
}

interface PipelineContext {
  book: Book | null;
  semanticContext: SemanticContext | null;
  enabledSkills: Skill[];
  isVectorized: boolean;
  userLanguage: string;
}

interface ProcessedMessages {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const DEFAULT_CONFIG: PipelineConfig = {
  slidingWindowSize: 8,
};

/** Process a thread into messages ready for AI API call */
export function processMessages(
  thread: Thread,
  context: PipelineContext,
  config: PipelineConfig = DEFAULT_CONFIG,
): ProcessedMessages {
  const systemPrompt = buildSystemPrompt(context);

  // Apply sliding window — keep last N messages
  const windowedMessages = applySlidingWindow(
    thread.messages,
    config.slidingWindowSize,
  );

  // Process citations in messages
  const processed = windowedMessages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: injectCitations(m),
    }));

  return { systemPrompt, messages: processed };
}

/** Apply sliding window, keeping system messages + last N user/assistant pairs */
function applySlidingWindow(
  messages: Message[],
  windowSize: number,
): Message[] {
  if (messages.length <= windowSize) return messages;
  return messages.slice(-windowSize);
}

/** Inject citation references into message content */
function injectCitations(message: Message): string {
  if (!message.citations || message.citations.length === 0) {
    return message.content;
  }

  let content = message.content;
  for (const citation of message.citations) {
    // Append citation references at the end
    content += `\n\n> [${citation.chapterTitle}]: "${citation.text}"`;
  }
  return content;
}
