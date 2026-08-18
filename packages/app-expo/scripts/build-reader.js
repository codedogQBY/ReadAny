/**
 * Build script to bundle foliate-js into a self-contained reader.html
 * for use in React Native WebView.
 *
 * Run: node scripts/build-reader.js
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const FOLIATE_DIR = path.resolve(__dirname, "../../foliate-js");
const ASSETS_DIR = path.resolve(__dirname, "../assets/reader");
const TEMPLATE = path.resolve(ASSETS_DIR, "reader.template.html");
const OUTPUT = path.resolve(ASSETS_DIR, "reader.html");
const EXTRACTION_SESSIONS = path.resolve(__dirname, "../src/lib/rag/reader-extraction-sessions.ts");
const JUSTIFIED_TEXT = path.resolve(ASSETS_DIR, "justified-text.js");

async function buildReader() {
  // Create a temporary entry point
  const entryContent = `
    import { makeBook, View } from "${FOLIATE_DIR.replace(/\\/g, "/")}/view.js";
    import { Overlayer } from "${FOLIATE_DIR.replace(/\\/g, "/")}/overlayer.js";
    import * as CFI from "${FOLIATE_DIR.replace(/\\/g, "/")}/epubcfi.js";
    import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from "${FOLIATE_DIR.replace(/\\/g, "/")}/vendor/zip.js";
    import { EPUB } from "${FOLIATE_DIR.replace(/\\/g, "/")}/epub.js";
    import { extractPDFChapters, makePDFFromURL } from "${FOLIATE_DIR.replace(/\\/g, "/")}/pdf.js";
    import { ReaderExtractionSessions } from "${EXTRACTION_SESSIONS.replace(/\\/g, "/")}";

    window.makeBook = makeBook;
    window.Overlayer = Overlayer;
    window.CFI = CFI;

    // Expose zip.js and EPUB for lazy Range-based loading in reader template
    window._zipJs = { configure, ZipReader, BlobReader, TextWriter, BlobWriter };
    window._EPUB = EPUB;
    window._makePDFFromURL = makePDFFromURL;
    window._extractPDFChapters = extractPDFChapters;
    window.ReaderExtractionSessions = ReaderExtractionSessions;

    if (!customElements.get('foliate-view')) {
      customElements.define('foliate-view', View);
    }

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'foliate-loaded' }));
    }
  `;

  const entryFile = path.resolve(__dirname, "../.foliate-entry.mjs");
  fs.writeFileSync(entryFile, entryContent);

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: true,
      write: false,
      resolveExtensions: [".js", ".mjs"],
    });

    const bundledJS = result.outputFiles[0].text;

    // Read the template HTML and reader-side helper sources (never modified)
    const template = fs.readFileSync(TEMPLATE, "utf-8");
    const justifiedText = fs.readFileSync(JUSTIFIED_TEXT, "utf-8");

    const JUSTIFIED_TEXT_MARKER = "<!-- __READANY_JUSTIFIED_TEXT_INSERT_POINT_6c18f4d2__ -->";
    const justifiedTextParts = template.split(JUSTIFIED_TEXT_MARKER);
    if (justifiedTextParts.length !== 2) {
      throw new Error("Reader template must contain exactly one justified-text marker");
    }
    const templateWithJustifiedText = `${justifiedTextParts[0]}<script>\n${justifiedText}\n</script>${justifiedTextParts[1]}`;

    // Replace the placeholder with the bundled code
    // Use split/join instead of replace to avoid $ replacement patterns in JS bundle
    const MARKER = "<!-- __READANY_FOLIATE_BUNDLE_INSERT_POINT_7f3a9b2e__ -->";
    const parts = templateWithJustifiedText.split(MARKER);
    if (parts.length !== 2) {
      throw new Error("Reader template must contain exactly one Foliate bundle marker");
    }
    const html = `${parts[0]}<script>\n${bundledJS}\n</script>${parts.slice(1).join(MARKER)}`;

    // Write to output file (separate from template)
    fs.writeFileSync(OUTPUT, html);
    console.log(`Built reader.html (${Math.round(html.length / 1024)}KB)`);
  } finally {
    if (fs.existsSync(entryFile)) fs.unlinkSync(entryFile);
  }
}

buildReader().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
