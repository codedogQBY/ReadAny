import { access, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute } from "node:path";
import {
  type DictionaryPackDescriptor,
  type DictionarySource,
  parseDictionaryManifest,
} from "@readany/core/dictionary";
import { buildDictionaryPack } from "../src/dictionary/pack-builder.js";

const REQUIRED_FLAGS = [
  "language",
  "input",
  "output",
  "version",
  "source-edition",
  "license",
  "source-date",
  "source-archive-url",
  "attribution-url",
  "license-file",
  "creator-attribution",
  "asset-url",
  "descriptor",
] as const;

type RequiredFlag = (typeof REQUIRED_FLAGS)[number];
type ParsedArguments = Record<RequiredFlag, string>;

function usage(message: string): never {
  throw new Error(
    `${message}\nUsage: dictionary:build --language en|zh --input absolute-jsonl-path --output absolute-sqlite-path --version semver --source-edition wordnet-3.1|enwiktionary|zhwiktionary --license "WordNet 3.1 License"|"CC BY-SA 4.0" --source-date YYYY-MM-DD --source-archive-url https-url --attribution-url https-url --license-file absolute-txt-path --creator-attribution text --asset-url https-url --descriptor absolute-json-path`,
  );
}

function parseArguments(argv: string[]): ParsedArguments {
  const values = new Map<RequiredFlag, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--")) usage(`Unexpected argument: ${flag ?? ""}`);
    const key = flag.slice(2) as RequiredFlag;
    if (!REQUIRED_FLAGS.includes(key) || !value || value.startsWith("--")) {
      usage(`Invalid argument: ${flag}`);
    }
    if (values.has(key)) usage(`Duplicate argument: ${flag}`);
    values.set(key, value);
  }

  for (const key of REQUIRED_FLAGS) {
    if (!values.has(key)) usage(`Missing required argument: --${key}`);
  }
  return Object.fromEntries(values) as ParsedArguments;
}

function validateUrl(value: string, name: string): void {
  try {
    if (new URL(value).protocol !== "https:") usage(`${name} must be an https URL`);
  } catch {
    usage(`${name} must be an https URL`);
  }
}

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) usage("--source-date must use YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    usage("--source-date must use YYYY-MM-DD");
  }
}

function validateSemver(value: string): void {
  const numericIdentifier = "(?:0|[1-9]\\d*)";
  const prereleaseIdentifier = `(?:${numericIdentifier}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
  const prerelease = `(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?`;
  const build = "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
  if (
    !new RegExp(
      `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}${prerelease}${build}$`,
    ).test(value)
  ) {
    usage("--version must be a semver value");
  }
}

async function validatePaths(args: ParsedArguments): Promise<void> {
  for (const [name, path] of [
    ["--input", args.input],
    ["--license-file", args["license-file"]],
    ["--output", args.output],
    ["--descriptor", args.descriptor],
  ] as const) {
    if (!isAbsolute(path)) usage(`${name} must be an absolute path`);
  }
  if (extname(args.input) !== ".jsonl") usage("--input must be a .jsonl path");
  if (extname(args["license-file"]) !== ".txt") usage("--license-file must be a .txt path");
  if (extname(args.output) !== ".sqlite") usage("--output must be a .sqlite path");
  if (extname(args.descriptor) !== ".json") usage("--descriptor must be a .json path");
  await Promise.all([access(args.input), access(args["license-file"])]);
  await Promise.all([stat(dirname(args.output)), stat(dirname(args.descriptor))]);
}

function validateArguments(args: ParsedArguments): DictionarySource {
  if (args.language !== "en" && args.language !== "zh") usage("--language must be en or zh");
  validateSemver(args.version);
  validateDate(args["source-date"]);
  validateUrl(args["source-archive-url"], "--source-archive-url");
  validateUrl(args["attribution-url"], "--attribution-url");
  validateUrl(args["asset-url"], "--asset-url");
  if (!args["creator-attribution"].trim()) usage("--creator-attribution must not be empty");
  if (
    args.language === "en" &&
    args["source-edition"] === "wordnet-3.1" &&
    args.license === "WordNet 3.1 License"
  ) {
    return { language: "en", sourceEdition: "wordnet-3.1", license: "WordNet 3.1 License" };
  }
  if (
    args.language === "en" &&
    args["source-edition"] === "enwiktionary" &&
    args.license === "CC BY-SA 4.0"
  ) {
    return { language: "en", sourceEdition: "enwiktionary", license: "CC BY-SA 4.0" };
  }
  if (
    args.language === "zh" &&
    args["source-edition"] === "zhwiktionary" &&
    args.license === "CC BY-SA 4.0"
  ) {
    return { language: "zh", sourceEdition: "zhwiktionary", license: "CC BY-SA 4.0" };
  }
  usage("--language, --source-edition, and --license must be a supported combination");
}

function validateDescriptor(descriptor: DictionaryPackDescriptor): DictionaryPackDescriptor {
  const englishPlaceholder = {
    ...descriptor,
    language: "en",
    sourceEdition: "wordnet-3.1",
    license: "WordNet 3.1 License",
  } as const;
  const chinesePlaceholder = {
    ...descriptor,
    language: "zh",
    sourceEdition: "zhwiktionary",
    license: "CC BY-SA 4.0",
  } as const;
  const manifest = parseDictionaryManifest({
    manifestVersion: 1,
    packs:
      descriptor.language === "en"
        ? { en: descriptor, zh: chinesePlaceholder }
        : { en: englishPlaceholder, zh: descriptor },
  });
  return manifest.packs[descriptor.language];
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const source = validateArguments(args);
  await validatePaths(args);
  const licenseNotice = (await readFile(args["license-file"], "utf8")).trim();
  if (!licenseNotice) usage("--license-file must contain a license notice");
  const descriptor = validateDescriptor(
    await buildDictionaryPack({
      ...source,
      inputPath: args.input,
      outputPath: args.output,
      version: args.version,
      sourceDumpDate: args["source-date"],
      sourceArchiveUrl: args["source-archive-url"],
      attributionUrl: args["attribution-url"],
      licenseNotice,
      creatorAttribution: args["creator-attribution"].trim(),
      assetUrl: args["asset-url"],
    }),
  );
  await writeFile(args.descriptor, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(descriptor)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
