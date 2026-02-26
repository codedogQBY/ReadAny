/**
 * Renderer Factory — creates the appropriate renderer based on file format
 * Uses dynamic imports for code splitting — only loads the renderer needed.
 * 
 * Note: All formats (EPUB, MOBI, CBZ, PDF) now use foliate-js <foliate-view>
 * for unified rendering behavior and consistent user experience.
 */
import type { DocumentRenderer } from "./document-renderer";

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

/** Create a renderer instance for the given format (async — uses dynamic import) */
export async function createRenderer(format: SupportedFormat): Promise<DocumentRenderer> {
  switch (format) {
    case "epub":
    case "mobi":
    case "cbz":
    case "pdf": {
      // All formats use foliate-js for unified rendering
      const { EPUBRenderer } = await import("./epub-renderer");
      return new EPUBRenderer();
    }
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/** Create a renderer by detecting the format from a filename (async) */
export async function createRendererForFile(filename: string): Promise<DocumentRenderer> {
  const format = detectFormat(filename);
  return createRenderer(format);
}
