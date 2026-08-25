import { describe, expect, it } from "vitest";
import en from "./locales/en/library.json";
import es from "./locales/es/library.json";
import fr from "./locales/fr/library.json";
import ja from "./locales/ja/library.json";
import ko from "./locales/ko/library.json";
import zhTW from "./locales/zh-TW/library.json";
import zh from "./locales/zh/library.json";

const REQUIRED_KEYS = [
  "alreadyImported",
  "authAnonymous",
  "authMissing",
  "authSecure",
  "authSession",
  "available",
  "back",
  "books",
  "browseCatalog",
  "builtIn",
  "builtInLocked",
  "catalog",
  "catalogActionFailed",
  "catalogsLoadFailed",
  "catalogsSubtitle",
  "catalogsTitle",
  "cancel",
  "chooseFormat",
  "close",
  "collections",
  "continue",
  "delete",
  "deleteCatalog",
  "deleteDescription",
  "deleteTitle",
  "disabled",
  "done",
  "downloadAndImport",
  "downloadFormat",
  "downloading",
  "downloadingProgress",
  "downloadTitle",
  "editCatalog",
  "editCredentials",
  "empty",
  "emptyHint",
  "enabled",
  "hiddenPresets",
  "hideCatalog",
  "hidePassword",
  "imported",
  "importing",
  "loadFailed",
  "loading",
  "loadingCatalogs",
  "loadingHint",
  "noCompatibleFormat",
  "next",
  "previous",
  "publicationDetails",
  "readerEyebrow",
  "readerIntro",
  "refresh",
  "restore",
  "restoreCatalog",
  "searchPlaceholder",
  "search",
  "retry",
  "save",
  "showMore",
  "showPassword",
  "toggleCatalog",
  "unknownAuthor",
  "unsupportedExplanation",
  "form.addTitle",
  "form.anonymous",
  "form.authentication",
  "form.basic",
  "form.credentialsInUrl",
  "form.editTitle",
  "form.enabled",
  "form.enabledHint",
  "form.invalidUrl",
  "form.localHttpTitle",
  "form.localHttpWarning",
  "form.name",
  "form.namePlaceholder",
  "form.password",
  "form.passwordMissing",
  "form.passwordRequiredForIdentityChange",
  "form.passwordSessionOnly",
  "form.passwordStoredSecurely",
  "form.passwordUnchanged",
  "form.publicHttpBlocked",
  "form.saveFailed",
  "form.subtitle",
  "form.url",
  "form.username",
  "errors.asset-too-large",
  "errors.cancelled",
  "errors.download-failed",
  "errors.download-in-progress",
  "errors.import-failed",
  "errors.insecure-url",
  "errors.invalid-catalog",
  "errors.too-large",
  "errors.unauthorized",
  "errors.unreachable",
  "errors.unsupported-acquisition",
  "errors.unsupported-auth",
] as const;

type JsonObject = Record<string, unknown>;

const resources = { en, es, fr, ja, ko, zh, "zh-TW": zhTW } as const;

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") output[path] = child;
    else Object.assign(output, flatten(child, path));
  }
  return output;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)].map((match) => match[1]).sort();
}

describe("OPDS locale contract", () => {
  const english = flatten((en.library as JsonObject).opds);

  it("defines every required user-facing key in English", () => {
    expect(Object.keys(english).sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  for (const [locale, resource] of Object.entries(resources)) {
    it(`${locale} has exact non-empty key and placeholder parity`, () => {
      const actual = flatten((resource.library as JsonObject).opds);
      expect(Object.keys(actual).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english)) {
        expect(actual[key]?.trim(), `${locale}:${key}`).not.toBe("");
        expect(placeholders(actual[key]), `${locale}:${key}`).toEqual(placeholders(english[key]));
      }
    });
  }
});
