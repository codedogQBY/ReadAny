/** Knowledge base types: documents, links, attachments, and card templates. */

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };

export type KnowledgeDocumentType =
  | "book_home"
  | "folder"
  | "standalone_note"
  | "highlight_note"
  | "review"
  | "summary"
  | "imported_markdown";

export type KnowledgeSourceKind =
  | "book"
  | "highlight"
  | "note"
  | "cfi"
  | "ai_message"
  | "external"
  | "obsidian";

export type KnowledgeLinkTargetKind =
  | "book"
  | "highlight"
  | "document"
  | "cfi"
  | "url"
  | "ai_message"
  | "obsidian";

export type KnowledgeLinkRelation =
  | "source"
  | "references"
  | "backlink"
  | "related"
  | "contains"
  | "generated_from";

export type KnowledgeAttachmentKind = "image" | "audio" | "video" | "pdf" | "file";

export interface KnowledgeDocument {
  id: string;
  bookId?: string;
  parentId?: string;
  type: KnowledgeDocumentType;
  title: string;
  contentJson: JSONValue;
  contentMd: string;
  contentSchemaVersion: number;
  excerpt?: string;
  summaryMd?: string;
  summarySourceFingerprint?: string;
  summarySourceUpdatedAt?: number;
  summaryUpdatedAt?: number;
  tags: string[];
  sourceKind?: KnowledgeSourceKind;
  sourceId?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface KnowledgeLink {
  id: string;
  fromDocumentId: string;
  toKind: KnowledgeLinkTargetKind;
  toId: string;
  relation: KnowledgeLinkRelation;
  label?: string;
  cfi?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeAttachment {
  id: string;
  documentId?: string;
  kind: KnowledgeAttachmentKind;
  fileName: string;
  mimeType?: string;
  localPath?: string;
  remotePath?: string;
  size: number;
  hash?: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeCardTemplate {
  id: string;
  name: string;
  version: number;
  schemaJson: JSONValue;
  builtIn: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export const EMPTY_TIPTAP_DOCUMENT: JSONValue = {
  type: "doc",
  content: [],
};
