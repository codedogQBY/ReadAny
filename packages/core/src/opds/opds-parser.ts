/// <reference path="./foliate-opds.d.ts" />

import { DOMParser } from "@xmldom/xmldom";
import { SYMBOL, getFeed } from "foliate-js/opds.js";
import type { BookFormat } from "../types/book";
import { classifyOpdsAcquisitionRelation } from "./opds-relations";
import { sanitizeOpdsDescription } from "./opds-sanitize";
import type {
  OpdsAcquisition,
  OpdsFeed,
  OpdsLink,
  OpdsPublication,
  OpdsSearchDescriptor,
} from "./opds-types";

const ATOM_NAMESPACE = "http://www.w3.org/2005/Atom";
const IMAGE_RELS = new Set([
  "cover",
  "thumbnail",
  "http://opds-spec.org/cover",
  "http://opds-spec.org/image",
  "http://opds-spec.org/thumbnail",
  "http://opds-spec.org/image/thumbnail",
]);

const FORMAT_BY_MEDIA_TYPE: Readonly<Record<string, BookFormat>> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw",
  "application/x-fictionbook+xml": "fb2",
  "application/x-cbz": "cbz",
  "application/vnd.comicbook+zip": "cbz",
  "text/plain": "txt",
  "application/x-umd": "umd",
};

const SUPPORTED_EXTENSIONS = new Set<BookFormat>([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "fb2",
  "fbz",
  "txt",
  "umd",
]);

type UnknownRecord = Record<PropertyKey, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid OPDS 2 catalog");
  return value;
}

function isLocalizableString(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([language, text]) => language.length > 0 && typeof text === "string" && text.length > 0,
    )
  );
}

function localizableString(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (!isLocalizableString(value) || !isRecord(value)) return undefined;
  const entries = Object.entries(value).sort(([left], [right]) => {
    if (left.toLowerCase() === "en") return -1;
    if (right.toLowerCase() === "en") return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return entries[0]?.[1] as string | undefined;
}

function requiredLocalizableString(value: unknown): string {
  const normalized = localizableString(value);
  if (!normalized) throw new Error("Invalid OPDS 2 catalog");
  return normalized;
}

function normalizeRel(value: unknown): string[] {
  if (typeof value === "string") return value.trim().split(/\s+/).filter(Boolean);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function isAcquisitionRelation(rel: string): boolean {
  return classifyOpdsAcquisitionRelation([rel]) !== undefined;
}

function isAcquisitionLink(value: unknown): value is UnknownRecord {
  return isRecord(value) && normalizeRel(value.rel).some(isAcquisitionRelation);
}

function resolveUrl(href: string, documentUrl: string, templated = false): string {
  try {
    if (!templated) return new URL(href, documentUrl).href;

    const expressions: string[] = [];
    const protectedHref = href.replace(/\{[^}]+}/g, (expression) => {
      expressions.push(expression);
      return `__OPDS_TEMPLATE_${expressions.length - 1}__`;
    });
    let resolved = new URL(protectedHref, documentUrl).href;
    expressions.forEach((expression, index) => {
      resolved = resolved.replace(`__OPDS_TEMPLATE_${index}__`, expression);
    });
    return resolved;
  } catch {
    throw new Error("Invalid OPDS catalog URL");
  }
}

function mapLink(value: unknown, documentUrl: string): OpdsLink | undefined {
  if (!isRecord(value)) return undefined;
  const href = optionalString(value.href) ?? optionalString(value.url);
  if (!href) return undefined;
  const rel = normalizeRel(value.rel);
  const link: OpdsLink = {
    rel,
    url: resolveUrl(href, documentUrl),
  };
  const type = optionalString(value.type);
  const title = optionalString(value.title);
  if (type) link.type = type;
  if (title) link.title = title;
  return link;
}

function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getMetadata(value: UnknownRecord): UnknownRecord {
  return isRecord(value.metadata) ? value.metadata : {};
}

function normalizeNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    if (!isRecord(item)) return [];
    const name = localizableString(item.name);
    return name ? [name] : [];
  });
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string");
  if (isRecord(value)) return optionalString(value.name);
  return undefined;
}

function normalizeSubjects(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    if (!isRecord(item)) return [];
    const name =
      localizableString(item.name) ?? optionalString(item.label) ?? optionalString(item.code);
    return name ? [name] : [];
  });
}

function getDescription(metadata: UnknownRecord, documentUrl: string): string | undefined {
  const description = optionalString(metadata.description);
  if (description) return sanitizeOpdsDescription(description, documentUrl);

  const content = metadata[SYMBOL.CONTENT];
  if (!isRecord(content)) return undefined;
  const value = optionalString(content.value);
  return value ? sanitizeOpdsDescription(value, documentUrl) : undefined;
}

function getBookFormat(type: string | undefined, url: string): BookFormat | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/, 1)[0] ?? "";
  }
  const extension = pathname.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase() as BookFormat | undefined;
  if (extension && SUPPORTED_EXTENSIONS.has(extension)) return extension;

  const mediaType = type?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType ? (FORMAT_BY_MEDIA_TYPE[mediaType] ?? null) : null;
}

function mapAcquisition(value: unknown, documentUrl: string): OpdsAcquisition | undefined {
  const link = mapLink(value, documentUrl);
  if (!link || !isAcquisitionLink(value)) return undefined;
  const relation = classifyOpdsAcquisitionRelation(link.rel);
  if (!relation) return undefined;
  return { ...link, format: getBookFormat(link.type, link.url), relation };
}

function mapPublication(value: unknown, documentUrl: string): OpdsPublication {
  if (!isRecord(value)) throw new Error("Invalid OPDS 2 catalog");
  const metadata = getMetadata(value);
  const title = requiredLocalizableString(metadata.title);
  const rawLinks = asRecords(value.links);
  const acquisitions = rawLinks.flatMap((item) => {
    const acquisition = mapAcquisition(item, documentUrl);
    return acquisition ? [acquisition] : [];
  });
  const imageValues = Array.isArray(value.images)
    ? value.images
    : rawLinks.filter((link) => normalizeRel(link.rel).some((rel) => IMAGE_RELS.has(rel)));
  const images = imageValues.flatMap((item) => {
    const image = mapLink(item, documentUrl);
    return image ? [image] : [];
  });
  const readingOrder = asRecords(value.readingOrder).flatMap((item) => {
    const link = mapLink(item, documentUrl);
    return link ? [link] : [];
  });

  const identifier = optionalString(metadata.identifier);
  const publication: OpdsPublication = {
    title,
    authors: normalizeNames(metadata.author),
    subjects: normalizeSubjects(metadata.subject),
    images,
    acquisitions,
    readingOrder,
  };
  const id = optionalString(value.id) ?? identifier;
  const publisher = normalizeNames(metadata.publisher)[0];
  const language = firstString(metadata.language);
  const published = optionalString(metadata.published);
  const description = getDescription(metadata, documentUrl);
  if (id) publication.id = id;
  if (publisher) publication.publisher = publisher;
  if (language) publication.language = language;
  if (identifier) publication.identifier = identifier;
  if (published) publication.published = published;
  if (description) publication.description = description;
  return publication;
}

function findLink(links: UnknownRecord[], relName: string): UnknownRecord | undefined {
  return links.find((link) => normalizeRel(link.rel).includes(relName));
}

function mapSearch(links: UnknownRecord[], documentUrl: string): OpdsSearchDescriptor | undefined {
  const link = findLink(links, "search");
  if (!link) return undefined;
  const href = optionalString(link.href);
  if (!href) return undefined;
  const type = optionalString(link.type);
  const title = optionalString(link.title);
  if (link.templated === true || href.includes("{")) {
    return {
      kind: "template",
      urlTemplate: resolveUrl(href, documentUrl, true),
      ...(title ? { title } : {}),
      ...(type ? { type } : {}),
    };
  }
  if (type?.split(";", 1)[0]?.trim().toLowerCase() === "application/opensearchdescription+xml") {
    return {
      kind: "openSearch",
      descriptorUrl: resolveUrl(href, documentUrl),
      ...(title ? { title } : {}),
      type,
    };
  }
  return undefined;
}

function mapFeed(value: unknown, documentUrl: string): OpdsFeed {
  if (!isRecord(value)) throw new Error("Invalid OPDS 2 catalog");
  const metadata = getMetadata(value);
  const title = requiredLocalizableString(metadata.title);
  const links = asRecords(value.links);
  const next = findLink(links, "next");
  const previous = findLink(links, "previous");
  const nextHref = next ? optionalString(next.href) : undefined;
  const previousHref = previous ? optionalString(previous.href) : undefined;

  const feed: OpdsFeed = {
    title,
    navigation: asRecords(value.navigation).map((item) => ({
      title: requiredString(item.title),
      url: resolveUrl(requiredString(item.href), documentUrl),
    })),
    publications: asRecords(value.publications).map((publication) =>
      mapPublication(publication, documentUrl),
    ),
    groups: asRecords(value.groups).map((group) => mapFeed(group, documentUrl)),
    facets: asRecords(value.facets).map((facet) => ({
      title: requiredLocalizableString(getMetadata(facet).title),
      links: asRecords(facet.links).flatMap((item) => {
        const link = mapLink(item, documentUrl);
        return link ? [link] : [];
      }),
    })),
  };
  const subtitle = localizableString(metadata.subtitle);
  const search = mapSearch(links, documentUrl);
  if (subtitle) feed.subtitle = subtitle;
  if (nextHref) feed.nextUrl = resolveUrl(nextHref, documentUrl);
  if (previousHref) feed.previousUrl = resolveUrl(previousHref, documentUrl);
  if (search) feed.search = search;
  return feed;
}

function validateArrayProperty(value: UnknownRecord, name: string): void {
  if (name in value && !Array.isArray(value[name])) throw new Error("Invalid OPDS 2 catalog");
}

function getArrayProperty(value: UnknownRecord, name: string): unknown[] {
  validateArrayProperty(value, name);
  const property = value[name];
  return Array.isArray(property) ? property : [];
}

function validateLink(value: unknown): void {
  if (!isRecord(value) || typeof value.href !== "string" || value.href.length === 0) {
    throw new Error("Invalid OPDS 2 catalog");
  }
  if ("type" in value && typeof value.type !== "string") {
    throw new Error("Invalid OPDS 2 catalog");
  }
  if ("title" in value && typeof value.title !== "string") {
    throw new Error("Invalid OPDS 2 catalog");
  }
  if (
    "rel" in value &&
    typeof value.rel !== "string" &&
    !(Array.isArray(value.rel) && value.rel.every((item) => typeof item === "string"))
  ) {
    throw new Error("Invalid OPDS 2 catalog");
  }
}

function validateNavigation(value: UnknownRecord): void {
  for (const item of getArrayProperty(value, "navigation")) {
    validateLink(item);
    if (!isRecord(item) || typeof item.title !== "string")
      throw new Error("Invalid OPDS 2 catalog");
  }
}

function validatePublication(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.metadata) || !isLocalizableString(value.metadata.title)) {
    throw new Error("Invalid OPDS 2 catalog");
  }
  const links = getArrayProperty(value, "links");
  for (const link of links) validateLink(link);
  for (const image of getArrayProperty(value, "images")) validateLink(image);
  const readingOrder = getArrayProperty(value, "readingOrder");
  for (const link of readingOrder) validateLink(link);
  if (!links.some(isAcquisitionLink) && readingOrder.length === 0) {
    throw new Error("Invalid OPDS 2 catalog");
  }
}

function validateGroup(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.metadata) || !isLocalizableString(value.metadata.title)) {
    throw new Error("Invalid OPDS 2 catalog");
  }
  if ("groups" in value || "facets" in value) throw new Error("Invalid OPDS 2 catalog");
  for (const link of getArrayProperty(value, "links")) validateLink(link);

  const hasNavigation = "navigation" in value;
  const hasPublications = "publications" in value;
  if (hasNavigation === hasPublications) throw new Error("Invalid OPDS 2 catalog");
  if (hasNavigation) {
    validateNavigation(value);
    if (getArrayProperty(value, "navigation").length === 0)
      throw new Error("Invalid OPDS 2 catalog");
  } else {
    const publications = getArrayProperty(value, "publications");
    if (publications.length === 0) throw new Error("Invalid OPDS 2 catalog");
    for (const publication of publications) validatePublication(publication);
  }
}

function validateFeed(value: unknown): asserts value is UnknownRecord {
  if (!isRecord(value) || !isRecord(value.metadata) || !isLocalizableString(value.metadata.title)) {
    throw new Error("Invalid OPDS 2 catalog");
  }
  for (const name of ["links", "navigation", "publications", "groups", "facets"]) {
    validateArrayProperty(value, name);
  }
  const links = getArrayProperty(value, "links");
  for (const link of links) validateLink(link);
  if (!links.some((link) => isRecord(link) && normalizeRel(link.rel).includes("self"))) {
    throw new Error("Invalid OPDS 2 catalog");
  }

  const navigation = getArrayProperty(value, "navigation");
  const publications = getArrayProperty(value, "publications");
  const groups = getArrayProperty(value, "groups");
  if (navigation.length + publications.length + groups.length === 0) {
    throw new Error("Invalid OPDS 2 catalog");
  }

  validateNavigation(value);
  for (const publication of getArrayProperty(value, "publications")) {
    validatePublication(publication);
  }
  for (const group of groups) validateGroup(group);
  for (const facet of getArrayProperty(value, "facets")) {
    if (
      !isRecord(facet) ||
      !isRecord(facet.metadata) ||
      !isLocalizableString(facet.metadata.title)
    ) {
      throw new Error("Invalid OPDS 2 catalog");
    }
    const facetLinks = getArrayProperty(facet, "links");
    if (facetLinks.length === 0) throw new Error("Invalid OPDS 2 catalog");
    for (const link of facetLinks) validateLink(link);
  }
}

function removeDoctypeAndEntityReferences(body: string): string {
  const withoutDoctype = body.replace(/<!DOCTYPE(?:[^<>\[]|\[[\s\S]*?\])*>/gi, "");
  return withoutDoctype.replace(/&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_][\w.:-]*;/g, "");
}

function getElementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function hasOnlyNamespaceLessAtomStructure(root: Element): boolean {
  const feedElements = new Set([
    "id",
    "title",
    "updated",
    "author",
    "link",
    "category",
    "contributor",
    "generator",
    "icon",
    "logo",
    "rights",
    "subtitle",
    "entry",
  ]);
  const entryElements = new Set([
    "id",
    "title",
    "updated",
    "author",
    "link",
    "category",
    "content",
    "contributor",
    "published",
    "rights",
    "source",
    "summary",
  ]);
  const feedChildren = getElementChildren(root);
  if (
    feedChildren.some(
      (child) => feedElements.has(child.localName) && (child.namespaceURI || null) !== null,
    )
  ) {
    return false;
  }
  return feedChildren
    .filter((child) => child.localName === "entry" && (child.namespaceURI || null) === null)
    .every((entry) =>
      getElementChildren(entry).every(
        (child) => !entryElements.has(child.localName) || (child.namespaceURI || null) === null,
      ),
    );
}

function parseMediaType(value: string): { type: string; parameters: Map<string, string> } {
  const [rawType = "", ...rawParameters] = value.split(";");
  const parameters = new Map<string, string>();
  for (const parameter of rawParameters) {
    const separator = parameter.indexOf("=");
    if (separator < 0) continue;
    const name = parameter.slice(0, separator).trim().toLowerCase();
    const rawValue = parameter.slice(separator + 1).trim();
    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    parameters.set(name, unquoted.trim().toLowerCase());
  }
  return { type: rawType.trim().toLowerCase(), parameters };
}

interface DirectAtomLink {
  element: Element;
  owner: "feed" | "entry";
}

function getDirectAtomLinks(root: Element): DirectAtomLink[] {
  const namespace = root.namespaceURI || null;
  const belongsToFeed = (element: Element, localName: string) =>
    element.localName === localName && (element.namespaceURI || null) === namespace;
  const feedChildren = getElementChildren(root);
  return [
    ...feedChildren
      .filter((child) => belongsToFeed(child, "link"))
      .map((element) => ({ element, owner: "feed" as const })),
    ...feedChildren
      .filter((child) => belongsToFeed(child, "entry"))
      .flatMap((entry) =>
        getElementChildren(entry)
          .filter((child) => belongsToFeed(child, "link"))
          .map((element) => ({ element, owner: "entry" as const })),
      ),
  ];
}

function hasValidAtomHref(link: Element, documentUrl: string): boolean {
  const href = link.getAttribute("href")?.trim();
  if (!href) return false;
  try {
    new URL(href, documentUrl);
    return true;
  } catch {
    return false;
  }
}

function parseXml(body: string, documentUrl: string): OpdsFeed {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(removeDoctypeAndEntityReferences(body), "application/xml");
  const root = document.documentElement;
  const rootNamespace = root.namespaceURI || null;
  const namespaceIsSupported = rootNamespace === null || rootNamespace === ATOM_NAMESPACE;
  const namespaceLessChildrenAreCompatible =
    rootNamespace !== null || hasOnlyNamespaceLessAtomStructure(root);
  if (
    errors.length > 0 ||
    root.localName !== "feed" ||
    !namespaceIsSupported ||
    !namespaceLessChildrenAreCompatible
  ) {
    throw new Error("Invalid OPDS XML document");
  }

  const hasOpdsSemantics = getDirectAtomLinks(root).some(({ element, owner }) => {
    if (!hasValidAtomHref(element, documentUrl)) return false;
    const rel = (element.getAttribute("rel") ?? "").trim().split(/\s+/).filter(Boolean);
    const media = parseMediaType(element.getAttribute("type") ?? "");
    return (
      (owner === "entry" && classifyOpdsAcquisitionRelation(rel) !== undefined) ||
      (media.type === "application/atom+xml" &&
        media.parameters.get("profile") === "opds-catalog") ||
      (rel.includes("search") && media.type === "application/opensearchdescription+xml") ||
      rel.includes("http://opds-spec.org/facet")
    );
  });
  if (!hasOpdsSemantics) throw new Error("Invalid OPDS XML document");

  try {
    const normalized = getFeed(document as unknown as Document);
    return mapFeed(normalized, documentUrl);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid OPDS XML document") throw error;
    throw new Error("Invalid OPDS XML document");
  }
}

function parseJson(body: string, documentUrl: string): OpdsFeed {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Invalid OPDS JSON document");
  }
  validateFeed(value);
  return mapFeed(value, documentUrl);
}

export function parseOpdsDocument(
  body: string,
  contentType: string,
  documentUrl: string,
): OpdsFeed {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/opds+json" || mediaType === "application/json") {
    return parseJson(body, documentUrl);
  }
  return parseXml(body, documentUrl);
}
