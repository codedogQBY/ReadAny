import { type SessionEvent, createSessionDetector } from "@/lib/reader/session-detector";
import { useReadingSessionStore } from "@/stores/reading-session-store";
import { useAppStore } from "@/stores/app-store";
/**
 * useReadingSession — reading session state machine hook
 */
import { useCallback, useEffect, useRef } from "react";

// Save session every 5 minutes
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000;

export function useReadingSession(bookId: string | null, tabId?: string) {
  const { startSession, pauseSession, resumeSession, stopSession, updateActiveTime, saveCurrentSession } =
    useReadingSessionStore();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isTabActive = tabId ? activeTabId === tabId : true;

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

  // Handle tab active/inactive transitions — save session when switching away
  const wasActiveRef = useRef(isTabActive);
  useEffect(() => {
    if (wasActiveRef.current && !isTabActive) {
      // Switching away from this reader tab — save current session to DB
      saveCurrentSession();
      sendEvent({ type: "visibility", visible: false });
    } else if (!wasActiveRef.current && isTabActive) {
      // Switching back to this reader tab — resume
      sendEvent({ type: "activity" });
    }
    wasActiveRef.current = isTabActive;
  }, [isTabActive, saveCurrentSession, sendEvent]);

  // Track user activity
  useEffect(() => {
    if (!bookId) return;

    const onActivity = () => {
      // Only track activity when this reader tab is active
      if (useAppStore.getState().activeTabId === tabId || !tabId) {
        sendEvent({ type: "activity" });
      }
    };
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

    // Active time counter — only increment when ACTIVE and tab is visible
    const timer = setInterval(() => {
      const currentTabId = useAppStore.getState().activeTabId;
      const isCurrentTabActive = tabId ? currentTabId === tabId : true;
      const currentState = detectorRef.current.currentState;
      
      // Check for idle
      const idleDuration = Date.now() - lastActivityRef.current;
      if (idleDuration >= 30000) { // 30 seconds idle threshold
        sendEvent({ type: "idle", duration: idleDuration });
      }
      
      // Only count time when active AND this tab is the active tab
      if (currentState === "ACTIVE" && isCurrentTabActive) {
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
  }, [bookId, tabId, sendEvent, updateActiveTime, stopSession, saveCurrentSession]);

  return { sendEvent };
}
