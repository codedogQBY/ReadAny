/**
 * Reader library — document rendering, navigation, and annotation
 */
export { EPUBRenderer } from "./epub-renderer";
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
