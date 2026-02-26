/**
 * Renderer Factory — creates the appropriate renderer based on file format
 */
import type { DocumentRenderer } from "./document-renderer";
import { EPUBRenderer } from "./epub-renderer";

export type SupportedFormat = "epub" | "pdf" | "mobi" | "txt" | "docx" | "cbz";

/** Detect file format from extension */
export function detectFormat(filename: string): SupportedFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "epub":
      return "epub";
    case "pdf":
      return "pdf";
    case "mobi":
    case "azw":
    case "azw3":
      return "mobi";
    case "txt":
      return "txt";
    case "docx":
      return "docx";
    case "cbz":
    case "cbr":
      return "cbz";
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

/** Create a renderer instance for the given format */
export function createRenderer(format: SupportedFormat): DocumentRenderer {
  switch (format) {
    case "epub":
      return new EPUBRenderer();
    case "pdf":
      // TODO: Implement PDFRenderer
      throw new Error("PDF renderer is not yet implemented");
    case "mobi":
      // MOBI files need to be converted to EPUB first
      throw new Error("MOBI format requires conversion to EPUB");
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/** Create a renderer by detecting the format from a filename */
export function createRendererForFile(filename: string): DocumentRenderer {
  const format = detectFormat(filename);
  return createRenderer(format);
}
