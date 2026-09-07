/**
 * Build-environment flags for the context-menu suppression path.
 *
 * Production builds suppress the WebView's native context menu globally
 * (main.tsx, ContextMenu, iframe-event-handlers); dev builds keep it so the
 * native menu (Inspect Element etc.) stays available for debugging.
 */
export const shouldSuppressNativeContextMenu = !import.meta.env.DEV;
