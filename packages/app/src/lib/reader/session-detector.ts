/**
 * Reading session detector — state machine (ACTIVE → PAUSED → STOPPED)
 */
import type { SessionDetectorConfig, SessionState } from "@/types";

const DEFAULT_CONFIG: SessionDetectorConfig = {
  pauseThreshold: 5 * 60 * 1000, // 5 minutes
  stopThreshold: 30 * 60 * 1000, // 30 minutes
  minSessionDuration: 30 * 1000, // 30 seconds
};

export type SessionEvent =
  | { type: "activity" } // user interaction detected
  | { type: "idle"; duration: number } // idle time in ms
  | { type: "visibility"; visible: boolean } // window visibility change
  | { type: "close" }; // window closing

export interface SessionDetector {
  currentState: SessionState;
  processEvent: (event: SessionEvent) => SessionState;
  reset: () => void;
}

/** Create a session detector state machine */
export function createSessionDetector(
  config: SessionDetectorConfig = DEFAULT_CONFIG,
  onStateChange?: (from: SessionState, to: SessionState) => void,
): SessionDetector {
  let currentState: SessionState = "STOPPED";

  function transition(newState: SessionState): SessionState {
    if (newState !== currentState) {
      const prev = currentState;
      currentState = newState;
      onStateChange?.(prev, newState);
    }
    return currentState;
  }

  function processEvent(event: SessionEvent): SessionState {
    switch (currentState) {
      case "STOPPED":
        if (event.type === "activity") {
          return transition("ACTIVE");
        }
        break;

      case "ACTIVE":
        if (event.type === "idle" && event.duration >= config.stopThreshold) {
          return transition("STOPPED");
        }
        if (event.type === "idle" && event.duration >= config.pauseThreshold) {
          return transition("PAUSED");
        }
        if (event.type === "visibility" && !event.visible) {
          return transition("PAUSED");
        }
        if (event.type === "close") {
          return transition("STOPPED");
        }
        break;

      case "PAUSED":
        if (event.type === "activity") {
          return transition("ACTIVE");
        }
        if (event.type === "idle" && event.duration >= config.stopThreshold) {
          return transition("STOPPED");
        }
        if (event.type === "close") {
          return transition("STOPPED");
        }
        break;
    }

    return currentState;
  }

  return {
    get currentState() {
      return currentState;
    },
    processEvent,
    reset: () => {
      currentState = "STOPPED";
    },
  };
}
