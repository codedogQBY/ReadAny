/**
 * Reader library — document loading, rendering, and utilities
 *
 * The old renderer abstraction (DocumentRenderer, EPUBRenderer, PDFRenderer,
 * renderer-factory) has been replaced by the unified architecture:
 *
 * DocumentLoader → BookDoc → FoliateViewer → <foliate-view>
 *
 * All formats are handled by foliate-js through a single rendering path.
 */
export { DocumentLoader, getDirection, isFixedLayoutFormat } from "./document-loader";
export type { BookDoc, BookFormat, BookMetadata, TOCItem, SectionItem } from "./document-loader";
export { registerIframeEventHandlers } from "./iframe-event-handlers";
