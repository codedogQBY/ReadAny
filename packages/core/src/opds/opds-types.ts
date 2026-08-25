import type { BookFormat } from "../types/book";
import type { OpdsAcquisitionRelation } from "./opds-relations";

export interface OpdsLink {
  rel: string[];
  url: string;
  type?: string;
  title?: string;
}

export interface OpdsAcquisition extends OpdsLink {
  format: BookFormat | null;
  /** Normalized semantics for parsed links. Optional for legacy callers constructing view models. */
  relation?: OpdsAcquisitionRelation;
}

export interface OpdsPublication {
  id?: string;
  title: string;
  authors: string[];
  publisher?: string;
  language?: string;
  identifier?: string;
  published?: string;
  description?: string;
  subjects: string[];
  images: OpdsLink[];
  acquisitions: OpdsAcquisition[];
  readingOrder: OpdsLink[];
}

export interface OpdsNavigationItem {
  title: string;
  url: string;
}

export interface OpdsFacet {
  title: string;
  links: OpdsLink[];
}

export type OpdsSearchDescriptor =
  | {
      kind: "template";
      urlTemplate: string;
      title?: string;
      type?: string;
    }
  | {
      kind: "openSearch";
      descriptorUrl: string;
      title?: string;
      type?: string;
    };

export interface OpdsFeed {
  title: string;
  subtitle?: string;
  navigation: OpdsNavigationItem[];
  publications: OpdsPublication[];
  groups: OpdsFeed[];
  facets: OpdsFacet[];
  nextUrl?: string;
  previousUrl?: string;
  search?: OpdsSearchDescriptor;
}

export interface OpdsCredentials {
  username: string;
  password: string;
  catalogOrigin: string;
}

export type OpdsErrorCode =
  | "unauthorized"
  | "unsupported-auth"
  | "insecure-url"
  | "unreachable"
  | "invalid-catalog"
  | "cancelled"
  | "too-large"
  | "unsupported-acquisition"
  | "download-failed"
  | "asset-too-large"
  | "download-in-progress"
  | "import-failed";
