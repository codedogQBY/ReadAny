import { AppState } from "react-native";
import { createBackgroundAwareTimers } from "./background-timers-core";

const timers = createBackgroundAwareTimers({
  isActive: () => AppState.currentState === "active",
  subscribe: (listener) => {
    const subscription = AppState.addEventListener("change", (state) => {
      listener(state === "active");
    });
    return () => subscription.remove();
  },
});

/** Like `setTimeout`-based waiting, but does not hang while the screen is off. */
export const waitUnlessBackground = timers.wait;
/** Yield to the event loop between batches without hanging while the screen is off. */
export const yieldToUiUnlessBackground = timers.yieldToUi;
