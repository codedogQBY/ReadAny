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
const JUSTIFIED_TEXT = path.resolve(ASSETS_DIR, "justified-text.js");

// ES2020+ runtime polyfills for older Android WebViews. Must be ES5-compatible
// (runs before the bundle on devices that may lack modern APIs).
const POLYFILLS = `/* ReadAny WebView runtime polyfills */
(function () {
  if (typeof String.prototype.replaceAll !== "function") {
    String.prototype.replaceAll = function (search, replace) {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError("String.prototype.replaceAll called with a non-global RegExp");
        return this.replace(search, replace);
      }
      return this.split(String(search)).join(String(replace));
    };
  }
  if (typeof Array.prototype.at !== "function") {
    Array.prototype.at = function (index) {
      var n = Math.trunc(index) || 0;
      if (n < 0) n += this.length;
      return n < 0 || n >= this.length ? undefined : this[n];
    };
  }
  if (typeof String.prototype.at !== "function") {
    String.prototype.at = function (index) {
      var n = Math.trunc(index) || 0;
      if (n < 0) n += this.length;
      return n < 0 || n >= this.length ? undefined : this[n];
    };
  }
  if (typeof Object.fromEntries !== "function") {
    Object.fromEntries = function (entries) {
      var obj = {};
      for (var i = 0; i < entries.length; i++) {
        var kv = entries[i];
        obj[kv[0]] = kv[1];
      }
      return obj;
    };
  }
  if (typeof Promise.allSettled !== "function") {
    Promise.allSettled = function (promises) {
      return Promise.all(Array.prototype.slice.call(promises).map(function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: "fulfilled", value: value }; },
          function (reason) { return { status: "rejected", reason: reason }; }
        );
      }));
    };
  }
  if (typeof structuredClone !== "function") {
    (typeof globalThis !== "undefined" ? globalThis : window).structuredClone = function (value) {
      return JSON.parse(JSON.stringify(value));
    };
  }
  if (typeof Intl !== "undefined" && typeof Intl.Locale !== "function") {
    var ShimLocale = function (tag) {
      var parts = String(tag).split("-");
      this.language = parts[0] || "";
      var dir = "ltr";
      if (/^(zh|ja|ko|ar|he|ur|fa)$/i.test(this.language)) dir = "rtl";
      this.textInfo = function () { return { direction: dir }; };
      this.getTextInfo = this.textInfo;
    };
    Intl.Locale = ShimLocale;
  }
})();
window.__bundleStart = 1;
`;

async function buildReader() {
  // Create a temporary entry point
  // IMPORTANT: window.makeBook is assigned FIRST and synchronously. Heavy format
  // engines (zip/EPUB/PDF) are loaded lazily in a non-blocking promise chain so a
  // failure in one of them (e.g. pdf.js on an old WebView) can never prevent the
  // reader kernel from becoming available.
  const entryContent = `
    import { makeBook, View } from "${FOLIATE_DIR.replace(/\\/g, "/")}/view.js";
    import { Overlayer } from "${FOLIATE_DIR.replace(/\\/g, "/")}/overlayer.js";
    import * as CFI from "${FOLIATE_DIR.replace(/\\/g, "/")}/epubcfi.js";

    window.makeBook = makeBook;
    window.Overlayer = Overlayer;
    window.CFI = CFI;

    // Placeholders — filled in by the async engine loader below
    window._zipJs = null;
    window._EPUB = null;
    window._makePDFFromURL = null;
    window._extractPDFChapters = null;

    if (!customElements.get('foliate-view')) {
      customElements.define('foliate-view', View);
    }

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'foliate-loaded' }));
    }

    // Lazy-load zip.js / EPUB / PDF engines without blocking the reader kernel.
    // Each import is converted by esbuild to a Promise-based lazy require, so a
    // failing engine (e.g. pdf.js on an old WebView) is contained here and the
    // reader still works — it only loses lazy Range loading / PDF features.
    Promise.resolve()
      .then(() => import("${FOLIATE_DIR.replace(/\\/g, "/")}/vendor/zip.js"))
      .then((m) => {
        window._zipJs = { configure: m.configure, ZipReader: m.ZipReader, BlobReader: m.BlobReader, TextWriter: m.TextWriter, BlobWriter: m.BlobWriter };
        return import("${FOLIATE_DIR.replace(/\\/g, "/")}/epub.js");
      })
      .then((m) => {
        window._EPUB = m.EPUB;
        return import("${FOLIATE_DIR.replace(/\\/g, "/")}/pdf.js");
      })
      .then((m) => {
        window._makePDFFromURL = m.makePDFFromURL;
        window._extractPDFChapters = m.extractPDFChapters;
      })
      .catch((err) => {
        try { console.warn('[Reader] Lazy engine init failed:', err); } catch (_) {}
      });
  `;

  const entryFile = path.resolve(__dirname, "../.foliate-entry.mjs");
  fs.writeFileSync(entryFile, entryContent);

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "iife",
      target: "es2017",
      minify: true,
      write: false,
      resolveExtensions: [".js", ".mjs"],
    });

    const bundledJS = POLYFILLS + "\n" + result.outputFiles[0].text;

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
