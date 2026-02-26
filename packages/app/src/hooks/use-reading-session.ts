import { type SessionEvent, createSessionDetector } from "@/lib/reader/session-detector";
import { useReadingSessionStore } from "@/stores/reading-session-store";
/**
 * useReadingSession — reading session state machine hook
 */
import { useCallback, useEffect, useRef } from "react";

export function useReadingSession(bookId: string | null) {
  const { startSession, pauseSession, resumeSession, stopSession, updateActiveTime } =
    useReadingSessionStore();
  const detectorRef = useRef(
    createSessionDetector(undefined, (_from, to) => {
      switch (to) {
        case "ACTIVE":
          if (_from === "STOPPED") startSession(bookId ?? "");
          else resumeSession();
          break;
        case "PAUSED":
          pauseSession();
          break;
        case "STOPPED":
          stopSession();
          break;
      }
    }),
  );

  // Activity tracking
  const sendEvent = useCallback((event: SessionEvent) => {
    detectorRef.current.processEvent(event);
  }, []);

  // Track user activity
  useEffect(() => {
    if (!bookId) return;

    const onActivity = () => sendEvent({ type: "activity" });
    const onVisibility = () => sendEvent({ type: "visibility", visible: !document.hidden });

    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onActivity);
    document.addEventListener("visibilitychange", onVisibility);

    // Start session
    sendEvent({ type: "activity" });

    // Active time counter
    const timer = setInterval(() => {
      updateActiveTime();
    }, 1000);

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
      sendEvent({ type: "close" });
    };
  }, [bookId, sendEvent, updateActiveTime]);

  return { sendEvent };
}
