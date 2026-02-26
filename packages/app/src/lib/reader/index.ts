/**
 * Reader library — document rendering, navigation, and annotation
 *
 * NOTE: Renderer classes (EPUBRenderer, PDFRenderer) are NOT re-exported here
 * to preserve dynamic import code splitting (#1). Use renderer-factory instead.
 */
export { createRenderer, createRendererForFile, detectFormat } from "./renderer-factory";
export type {
  DocumentRenderer,
  Location,
  Selection,
  TOCItem,
  AnnotationMark,
  RendererEvents,
} from "./document-renderer";
export type { SupportedFormat } from "./renderer-factory";
