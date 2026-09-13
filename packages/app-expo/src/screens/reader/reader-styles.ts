/**
 * Styles for ReaderScreen — aggregated from sub-modules.
 * Keep this file as a single import point for backward compatibility.
 */
import type { ThemeColors } from "@/styles/theme";
import { makeToolbarStyles } from "./styles/reader-base-styles";
import { makeSheetStyles } from "./styles/reader-sheet-styles";
import { makeNoteStyles } from "./styles/reader-note-styles";

export const makeStyles = (colors: ThemeColors) => ({
  ...makeToolbarStyles(colors),
  ...makeSheetStyles(colors),
  ...makeNoteStyles(colors),
});
