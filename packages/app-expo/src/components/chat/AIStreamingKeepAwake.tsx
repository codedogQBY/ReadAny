import { useKeepAwake } from "expo-keep-awake";

import { useChatStore } from "@/stores/chat-store";
import { hasActiveAIStream } from "./ai-streaming-keep-awake-state";

function ActiveAIKeepAwakeClaim() {
  useKeepAwake("readany-ai-stream");
  return null;
}

export function AIStreamingKeepAwake() {
  const isActive = useChatStore((state) => hasActiveAIStream(state.streamingSessions));
  return isActive ? <ActiveAIKeepAwakeClaim /> : null;
}
