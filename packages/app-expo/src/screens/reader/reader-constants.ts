/**
 * Constants and utility types shared by ReaderScreen and its sub-modules.
 */
import { Dimensions } from "react-native";

export const SCREEN_WIDTH = Dimensions.get("window").width;
export const SCREEN_HEIGHT = Dimensions.get("window").height;
export const CONTROLS_TIMEOUT = 4000;

export const FONT_THEMES = [
  { id: "system", labelKey: "reader.fontThemeSystem", fallback: "System" },
  { id: "literata", labelKey: "reader.fontThemeLiterata", fallback: "Literata" },
];

export function formatReaderClock(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
