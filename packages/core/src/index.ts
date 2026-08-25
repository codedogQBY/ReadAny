/**
 * @readany/core — Shared platform-agnostic business logic
 */

// Types
export * from "./types";

// Utils
export {
  cn,
  debounce,
  throttle,
  eventBus,
  convertToMessageV2,
  mergeMessagesWithStreaming,
} from "./utils";
export type { EventMap } from "./utils";

// Services (platform abstraction)
export type {
  IPlatformService,
  IDatabase,
  IWebSocket,
  FilePickerOptions,
  WebSocketOptions,
  UpdateInfo,
} from "./services";
export { setPlatformService, getPlatformService } from "./services";

// i18n
export { default as i18n, initI18nLanguage, changeAndPersistLanguage } from "./i18n";

// Import services
export { WebDavImportService } from "./import/webdav-import-service";
export {
  createEmptyImportBooksResult,
  createImportDuplicateIndex,
  findDuplicateBookByHash,
  findLikelyDuplicateBook,
  normalizeImportIdentity,
  stripBookExtension,
} from "./import/import-dedupe";
export {
  DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
  WEBDAV_IMPORT_SUPPORTED_EXTENSIONS,
  WEBDAV_IMPORT_TEMPORARY_CONFIG_KEY,
  WEBDAV_IMPORT_TEMPORARY_SECRET_KEY,
  getWebDavImportExtension,
  isImportableWebDavBookName,
  normalizeWebDavImportPath,
  normalizeWebDavImportRoot,
} from "./import/webdav-import-types";
export type {
  PersistedWebDavImportInput,
  WebDavImportEntry,
  WebDavImportListing,
  WebDavImportSource,
  WebDavImportSourceKind,
} from "./import/webdav-import-types";
export type { ImportBooksResult, ImportDuplicateIndex } from "./import/import-dedupe";

// OPDS catalogs
export {
  OPDS_BUILT_IN_CATALOGS,
  OPDS_CATALOG_STORAGE_KEY,
  OpdsCatalogStore,
  canPreserveOpdsCatalogPassword,
  opdsCatalogSecretKey,
  type OpdsCatalog,
  type OpdsCatalogAuth,
  type OpdsCatalogInput,
  type OpdsCatalogStorage,
  type OpdsCatalogUpdate,
  type OpdsPasswordStorage,
} from "./opds/opds-catalog-store";
export { OpdsClient, OpdsError, type OpdsAssetResponse } from "./opds/opds-client";
export {
  OPDS_MAX_ACQUISITION_BYTES,
  createExclusiveOpdsDownloadRunner,
  downloadOpdsAcquisition,
  listSupportedAcquisitions,
  sanitizeOpdsFileName,
  toBookMeta,
  type DownloadOpdsAcquisitionInput,
  type DownloadOpdsAcquisitionResult,
  type OpdsDownloadProgress,
  type SupportedOpdsAcquisition,
} from "./opds/opds-acquisition";
export { parseOpdsDocument } from "./opds/opds-parser";
export {
  classifyOpdsAcquisitionRelation,
  type OpdsAcquisitionRelation,
  type OpdsAcquisitionRelationKind,
} from "./opds/opds-relations";
export { classifyOpdsUrl } from "./opds/opds-security";
export { createOpdsRuntime } from "./opds/opds-runtime";
export * from "./opds/opds-view-state";
export { createOpdsBackController } from "./opds/opds-back-controller";
export {
  createOpdsCoverCache,
  readOpdsCover,
  type OpdsCoverLease,
  type OpdsCoverValue,
} from "./opds/opds-cover-cache";
export {
  opdsDescriptionToPlainText,
  sanitizeOpdsDescription,
} from "./opds/opds-sanitize";
export type {
  OpdsAcquisition,
  OpdsCredentials,
  OpdsErrorCode,
  OpdsFacet,
  OpdsFeed,
  OpdsLink,
  OpdsNavigationItem,
  OpdsPublication,
  OpdsSearchDescriptor,
} from "./opds/opds-types";

// EPUB services
export { inspectEpubBytes } from "./epub/inspect";
export type {
  EpubInspectManifestItem,
  EpubInspectResult,
  EpubInspectSpineItem,
  EpubInspectTocItem,
} from "./epub/inspect";
export { createEpubDraft } from "./epub/draft";
export type {
  EpubDraftCreateResult,
  EpubDraftHistoryEntry,
  EpubDraftManifest,
} from "./epub/draft";
export { readEpubChapterFromBookFile, readEpubChapterFromDraft } from "./epub/chapter";
export type { EpubChapterReadResult } from "./epub/chapter";
export { searchKnowledge } from "./knowledge/search";
export type {
  KnowledgeSearchHit,
  KnowledgeSearchResult,
  KnowledgeSearchSource,
} from "./knowledge/search";
