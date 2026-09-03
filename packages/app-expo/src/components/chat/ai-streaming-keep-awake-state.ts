export function hasActiveAIStream(sessions: Record<string, { isStreaming: boolean }>): boolean {
  return Object.values(sessions).some((session) => session.isStreaming);
}
