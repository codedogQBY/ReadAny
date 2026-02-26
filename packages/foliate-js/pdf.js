/**
 * PDF adapter for foliate-js
 * Converts PDF pages into foliate-js book format for rendering with fixed-layout renderer
 */
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
// Use CDN for worker to avoid version mismatch issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs`;

/**
 * Create a foliate-js compatible book object from a PDF file
 * @param {File|Blob} file - The PDF file
 * @returns {Object} A book object compatible with foliate-js
 */
export const makePDF = async (file) => {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const numPages = pdfDoc.numPages;
  const cache = new Map();
  const urls = new Map();

  // Get page dimensions for metadata
  const firstPage = await pdfDoc.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });

  // Render a single page to canvas and return as blob URL
  const renderPage = async (pageNum, scale = 1) => {
    const cacheKey = `${pageNum}-${scale}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;
    const renderScale = scale * pixelRatio;

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width * pixelRatio;
    canvas.height = viewport.height * pixelRatio;

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport: page.getViewport({ scale: renderScale }),
    }).promise;

    // Create blob URL for the canvas image
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    const src = URL.createObjectURL(blob);

    // Create an HTML page that contains the image
    const pageHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
  <style>
    html, body { margin: 0; padding: 0; }
    img { display: block; width: 100%; height: auto; }
  </style>
</head>
<body>
  <img src="${src}" width="${viewport.width}" height="${viewport.height}">
</body>
</html>`;

    const pageBlob = new Blob([pageHtml], { type: "text/html" });
    const pageUrl = URL.createObjectURL(pageBlob);

    urls.set(cacheKey, [src, pageUrl]);
    cache.set(cacheKey, pageUrl);

    return pageUrl;
  };

  // Get text content for a page (for searching)
  const getTextContent = async (pageNum) => {
    const page = await pdfDoc.getPage(pageNum);
    return page.getTextContent();
  };

  // Get outline/bookmarks
  const getOutline = async () => {
    try {
      const outline = await pdfDoc.getOutline();
      if (!outline) return [];

      const result = [];
      for (const item of outline) {
        let pageNum = 1;
        if (item.dest) {
          try {
            const dest =
              typeof item.dest === "string"
                ? await pdfDoc.getDestination(item.dest)
                : item.dest;
            if (dest) {
              const ref = dest[0];
              pageNum = (await pdfDoc.getPageIndex(ref)) + 1;
            }
          } catch {
            // ignore
          }
        }
        result.push({
          label: item.title,
          href: `page-${pageNum}`,
          subitems: item.items
            ? await parseOutlineItems(item.items, pdfDoc)
            : undefined,
        });
      }
      return result;
    } catch {
      return [];
    }
  };

  // Helper for recursive outline parsing
  const parseOutlineItems = async (items, pdfDoc) => {
    const result = [];
    for (const item of items) {
      let pageNum = 1;
      if (item.dest) {
        try {
          const dest =
            typeof item.dest === "string"
              ? await pdfDoc.getDestination(item.dest)
              : item.dest;
          if (dest) {
            const ref = dest[0];
            pageNum = (await pdfDoc.getPageIndex(ref)) + 1;
          }
        } catch {
          // ignore
        }
      }
      result.push({
        label: item.title,
        href: `page-${pageNum}`,
        subitems: item.items
          ? await parseOutlineItems(item.items, pdfDoc)
          : undefined,
      });
    }
    return result;
  };

  // Build the book object
  const book = {};

  // Cover: first page as image
  book.getCover = async () => {
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  };

  // Metadata
  const metadata = await pdfDoc.getMetadata().catch(() => null);
  book.metadata = {
    title: metadata?.info?.Title || file.name.replace(/\.pdf$/i, ""),
    author: metadata?.info?.Author || undefined,
    subject: metadata?.info?.Subject || undefined,
    creator: metadata?.info?.Creator || undefined,
    producer: metadata?.info?.Producer || undefined,
  };

  // Sections - one per page
  book.sections = Array.from({ length: numPages }, (_, i) => ({
    id: `page-${i + 1}`,
    load: () => renderPage(i + 1),
    unload: () => {
      const key = `${i + 1}-1`;
      urls.get(key)?.forEach?.(URL.revokeObjectURL);
      urls.delete(key);
      cache.delete(key);
    },
    size: 1, // Each page counts as 1 for progress
    createDocument: async () => {
      // For text search, return a document with the text content
      const textContent = await getTextContent(i + 1);
      const text = textContent.items.map((item) => item.str).join(" ");
      const parser = new DOMParser();
      return parser.parseFromString(
        `<!DOCTYPE html><html><body><p>${text}</p></body></html>`,
        "text/html"
      );
    },
  }));

  // Table of contents
  book.toc = await getOutline();

  // If no outline, create a simple page list
  if (book.toc.length === 0) {
    // Create page list entries (every 10 pages)
    const step = Math.max(1, Math.floor(numPages / 20));
    book.toc = [];
    for (let i = 1; i <= numPages; i += step) {
      book.toc.push({ label: `Page ${i}`, href: `page-${i}` });
    }
  }

  // Page list for direct page navigation
  book.pageList = Array.from({ length: numPages }, (_, i) => ({
    label: `${i + 1}`,
    href: `page-${i + 1}`,
  }));

  // Rendition properties - use fixed layout
  book.rendition = {
    layout: "pre-paginated",
    spread: "auto",
    viewport: { width: viewport.width, height: viewport.height },
  };

  // Navigation methods
  book.resolveHref = (href) => {
    const match = href.match(/page-(\d+)/);
    if (match) {
      const pageNum = parseInt(match[1], 10);
      return { index: pageNum - 1 };
    }
    return { index: 0 };
  };

  book.splitTOCHref = (href) => {
    const match = href.match(/page-(\d+)/);
    if (match) {
      return [href, null];
    }
    return [href, null];
  };

  book.getTOCFragment = (doc, id) => {
    return doc.documentElement;
  };

  // Cleanup
  book.destroy = () => {
    for (const arr of urls.values()) {
      for (const url of arr) {
        URL.revokeObjectURL(url);
      }
    }
    pdfDoc.destroy().catch(() => {});
  };

  // Store reference for later use
  book._pdfDoc = pdfDoc;
  book._renderPage = renderPage;

  return book;
};
