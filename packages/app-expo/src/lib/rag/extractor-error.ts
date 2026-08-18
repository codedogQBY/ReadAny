export type BookExtractionErrorCategory =
  | "drm-protected"
  | "malformed"
  | "unsupported-format"
  | "unknown";

const MOBI_FAMILY = new Set(["mobi", "azw", "azw3"]);
const PROTECTION_EVIDENCE = /\b(?:encrypt(?:ed|ion)?|drm|protected)\b/i;
const GENERIC_MALFORMED_EVIDENCE =
  /\b(?:truncat(?:ed|ion)|invalid\s+(?:(?:pdb|mobi)\s+)?record(?:\s+(?:offset|structure|header|index))?|record\s+(?:offset|structure|header|index))\b/i;
const MOBI_PARSER_MALFORMED_EVIDENCE =
  /^(?:Invalid (?:HUFF|CDIC|INDX) record|Invalid TAGX section|Invalid EXTH header|Missing MOBI header|Missing FDST record|Record index out of bounds|Offset is outside (?:the )?bounds of (?:the )?DataView)$/i;
const UNSUPPORTED_FORMAT_EVIDENCE = /\bunsupported\s+(?:book\s+)?format\b/i;

const MESSAGE_KEYS: Record<BookExtractionErrorCategory, { title: string; description: string }> = {
  "drm-protected": {
    title: "vectorize.protectedBookTitle",
    description: "vectorize.protectedBookDesc",
  },
  malformed: {
    title: "vectorize.malformedBookTitle",
    description: "vectorize.malformedBookDesc",
  },
  "unsupported-format": {
    title: "vectorize.unsupportedFormatTitle",
    description: "vectorize.unsupportedFormatDesc",
  },
  unknown: {
    title: "vectorize.extractionFailedTitle",
    description: "vectorize.extractionFailedDesc",
  },
};

export function classifyBookExtractionError(
  error: unknown,
  format: string | undefined,
): BookExtractionErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  const parserMessage = message.replace(/^(?:Error|RangeError):\s*/i, "");
  const normalizedFormat = format?.trim().toLowerCase();

  if (
    normalizedFormat &&
    MOBI_FAMILY.has(normalizedFormat) &&
    PROTECTION_EVIDENCE.test(parserMessage)
  ) {
    return "drm-protected";
  }
  if (
    GENERIC_MALFORMED_EVIDENCE.test(parserMessage) ||
    MOBI_PARSER_MALFORMED_EVIDENCE.test(parserMessage)
  )
    return "malformed";
  if (UNSUPPORTED_FORMAT_EVIDENCE.test(parserMessage)) return "unsupported-format";
  return "unknown";
}

export class BookExtractionError extends Error {
  readonly category: BookExtractionErrorCategory;
  override readonly cause: unknown;

  constructor(error: unknown, format: string | undefined) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "BookExtractionError";
    this.category = classifyBookExtractionError(error, format);
    this.cause = error;
  }
}

export function toBookExtractionError(
  error: unknown,
  format: string | undefined,
): BookExtractionError {
  return error instanceof BookExtractionError ? error : new BookExtractionError(error, format);
}

export function getBookExtractionErrorMessageKeys(category: BookExtractionErrorCategory) {
  return MESSAGE_KEYS[category];
}
