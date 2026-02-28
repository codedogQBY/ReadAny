import { type SessionEvent, createSessionDetector } from "@/lib/reader/session-detector";
import { useReadingSessionStore } from "@/stores/reading-session-store";
/**
 * useReadingSession — reading session state machine hook
 */
import { useCallback, useEffect, useRef } from "react";

// Save session every 5 minutes
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000;

export function useReadingSession(bookId: string | null) {
  const { startSession, pauseSession, resumeSession, stopSession, updateActiveTime, saveCurrentSession } =
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

  // Track last activity time for idle detection
  const lastActivityRef = useRef(Date.now());
  const lastSaveRef = useRef(Date.now());

  // Activity tracking
  const sendEvent = useCallback((event: SessionEvent) => {
    if (event.type === "activity") {
      lastActivityRef.current = Date.now();
    }
    detectorRef.current.processEvent(event);
  }, []);

  // Track user activity
  useEffect(() => {
    if (!bookId) return;

    const onActivity = () => sendEvent({ type: "activity" });
    const onVisibility = () => sendEvent({ type: "visibility", visible: !document.hidden });
    
    // Save before page unload
    const onBeforeUnload = () => {
      stopSession();
    };

    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("scroll", onActivity);
    window.addEventListener("click", onActivity);
    window.addEventListener("touchstart", onActivity);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    // Start session
    sendEvent({ type: "activity" });

    // Active time counter — only increment when ACTIVE
    const timer = setInterval(() => {
      const currentState = detectorRef.current.currentState;
      
      // Check for idle
      const idleDuration = Date.now() - lastActivityRef.current;
      if (idleDuration >= 30000) { // 30 seconds idle threshold
        sendEvent({ type: "idle", duration: idleDuration });
      }
      
      // Only count time when active
      if (currentState === "ACTIVE") {
        updateActiveTime();
        
        // Auto-save periodically
        if (Date.now() - lastSaveRef.current >= AUTO_SAVE_INTERVAL) {
          lastSaveRef.current = Date.now();
          saveCurrentSession();
        }
      }
    }, 1000);

    return () => {
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener("touchstart", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(timer);
      sendEvent({ type: "close" });
    };
  }, [bookId, sendEvent, updateActiveTime, stopSession, saveCurrentSession]);

  return { sendEvent };
}
