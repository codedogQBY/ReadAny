import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { sanitizeOpdsDescription } from "./opds-sanitize";

const ALLOWED_ELEMENTS = new Set(["p", "br", "em", "strong", "ul", "ol", "li", "blockquote", "a"]);

function getSanitizedElements(output: string): Element[] {
  const xml = `<root>${output.replace(/<br>/g, "<br/>")}</root>`;
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(document.getElementsByTagName("*")).slice(1) as unknown as Element[];
}

describe("sanitizeOpdsDescription", () => {
  it("retains only the safe description markup allowlist", () => {
    const input = `<div class="wrapper">
      <p onclick="steal()">Hello<br><em>there</em> <strong>reader</strong></p>
      <ul><li>One</li><li><span>Two</span></li></ul>
      <ol><li>Three</li></ol>
      <blockquote cite="https://evil.test">Quoted</blockquote>
    </div>`;

    expect(sanitizeOpdsDescription(input)).toBe(
      "\n      <p>Hello<br><em>there</em> <strong>reader</strong></p>\n      <ul><li>One</li><li>Two</li></ul>\n      <ol><li>Three</li></ol>\n      <blockquote>Quoted</blockquote>\n    ",
    );
  });

  it("removes executable and remotely embedded content", () => {
    const input =
      '<p>Safe<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test"></iframe><img src="https://evil.test/pixel" onerror="steal()"> tail</p>';

    const result = sanitizeOpdsDescription(input);
    expect(result).toBe("<p>Safe tail</p>");
    expect(result).not.toMatch(/script|style|iframe|img|onerror|evil\.test|alert/i);
  });

  it.each([
    ["relative", "chapters/1", "https://catalog.test/root/chapters/1"],
    ["root relative", "/books/1", "https://catalog.test/books/1"],
    ["fragment", "#details", "https://catalog.test/root/feed#details"],
    ["http", "http://catalog.test/books/1", "http://catalog.test/books/1"],
    ["https", "https://catalog.test/books/1", "https://catalog.test/books/1"],
  ])("resolves a safe %s link", (_name, href, expected) => {
    expect(
      sanitizeOpdsDescription(
        `<a href="${href}" title="removed">Book</a>`,
        "https://catalog.test/root/feed",
      ),
    ).toBe(`<a href="${expected}" target="_blank" rel="noopener noreferrer">Book</a>`);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "j&#97;vascript:alert(1)",
    "java&#x0A;script:alert(1)",
    "java&#9;script:alert(1)",
    "data:text/html,evil",
    "file:///etc/passwd",
    "//evil.test",
  ])("removes an unsafe link scheme: %s", (href) => {
    expect(sanitizeOpdsDescription(`<a href="${href}">Book</a>`, "https://catalog.test/feed")).toBe(
      "<a>Book</a>",
    );
  });

  it("produces only allowlisted elements, attributes, and anchor protocols", () => {
    const result = sanitizeOpdsDescription(
      `<div class="wrapper"><p style="color:red" onclick="steal()">Safe<br><em>em</em><strong>strong</strong></p>
      <ul><li>one</li></ul><ol><li>two</li></ol><blockquote cite="evil">quote</blockquote>
      <a href="chapter/1" title="removed" target="_blank">safe link</a>
      <a href="j&#97;vascript:steal()" onmouseover="steal()">unsafe link</a>
      <script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test"></iframe>
      <object data="https://evil.test"></object><embed src="https://evil.test"><img src="https://evil.test/pixel">
      <svg><a href="https://evil.test">svg link</a></svg><math><mi>x</mi></math></div>`,
      "https://catalog.test/root/feed",
    );

    const elements = getSanitizedElements(result);
    expect(elements.length).toBeGreaterThan(0);
    for (const element of elements) {
      expect(ALLOWED_ELEMENTS.has(element.localName)).toBe(true);
      for (const attribute of Array.from(element.attributes)) {
        expect(element.localName).toBe("a");
        expect(["href", "target", "rel"]).toContain(attribute.name);
      }
      const href = element.getAttribute("href");
      if (href) expect(["http:", "https:"]).toContain(new URL(href).protocol);
    }
    expect(result).not.toMatch(
      /script|style=|onclick|onmouseover|iframe|object|embed|img|svg|math|evil\.test/i,
    );
  });

  it("escapes plain text that resembles markup", () => {
    expect(sanitizeOpdsDescription("2 < 3 & 5 > 4")).toBe("2 &lt; 3 &amp; 5 &gt; 4");
  });
});
