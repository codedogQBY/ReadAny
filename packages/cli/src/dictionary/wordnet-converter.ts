import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareDictionarySelection } from "@readany/core/dictionary";

const WORDNET_DATA_FILES = [
  { fileName: "data.noun", partOfSpeech: "noun", synsetTypes: new Set(["n"]) },
  { fileName: "data.verb", partOfSpeech: "verb", synsetTypes: new Set(["v"]) },
  { fileName: "data.adj", partOfSpeech: "adjective", synsetTypes: new Set(["a", "s"]) },
  { fileName: "data.adv", partOfSpeech: "adverb", synsetTypes: new Set(["r"]) },
] as const;

const WORDNET_EXCEPTION_FILES = [
  { fileName: "noun.exc", partOfSpeech: "noun" },
  { fileName: "verb.exc", partOfSpeech: "verb" },
  { fileName: "adj.exc", partOfSpeech: "adjective" },
  { fileName: "adv.exc", partOfSpeech: "adverb" },
] as const;

type PartOfSpeech = (typeof WORDNET_DATA_FILES)[number]["partOfSpeech"];

interface PendingWordNetEntry {
  word: string;
  partOfSpeech: PartOfSpeech;
  definitions: string[];
  definitionSet: Set<string>;
  forms: Map<string, string>;
  exceptionForms: Set<string>;
}

const WORDNET_POINTER_SYMBOLS = new Set([
  "!",
  "@",
  "@i",
  "~",
  "~i",
  "#m",
  "#s",
  "#p",
  "%m",
  "%s",
  "%p",
  "=",
  "+",
  ";c",
  "-c",
  ";r",
  "-r",
  ";u",
  "-u",
  "*",
  ">",
  "^",
  "$",
  "&",
  "<",
  "\\",
]);

const IRREGULAR_THIRD_PERSON_VERBS = new Set(["be", "have"]);

export interface WordNetConversionOptions {
  inputDirectory: string;
  outputPath: string;
}

export interface WordNetConversionStats {
  records: number;
  senses: number;
  aliases: number;
}

export async function convertWordNetDirectory(
  options: WordNetConversionOptions,
): Promise<WordNetConversionStats> {
  const entries = new Map<string, PendingWordNetEntry>();

  for (const dataFile of WORDNET_DATA_FILES) {
    const path = join(options.inputDirectory, dataFile.fileName);
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line || /^\s/.test(line)) continue;
      const parsed = parseDataRow(path, index + 1, line, dataFile.synsetTypes);
      for (const word of parsed.words) {
        const selection = prepareDictionarySelection(word);
        if (!selection.ok || selection.language !== "en") continue;
        const canonical = selection.key;
        const key = entryKey(dataFile.partOfSpeech, canonical);
        let entry = entries.get(key);
        if (!entry) {
          entry = {
            word: canonical,
            partOfSpeech: dataFile.partOfSpeech,
            definitions: [],
            definitionSet: new Set(),
            forms: new Map(),
            exceptionForms: new Set(),
          };
          entries.set(key, entry);
        }
        if (!entry.definitionSet.has(parsed.definition)) {
          entry.definitionSet.add(parsed.definition);
          entry.definitions.push(parsed.definition);
        }
      }
    }
  }

  for (const exceptionFile of WORDNET_EXCEPTION_FILES) {
    const path = join(options.inputDirectory, exceptionFile.fileName);
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      const tokens = line.trim().split(/\s+/);
      if (tokens.length < 2) throw formatError(path, index + 1, "invalid exception row");
      const inflected = normalizeLemma(tokens[0]);
      for (const baseToken of tokens.slice(1)) {
        const base = normalizeLemma(baseToken);
        const selection = prepareDictionarySelection(base);
        const aliasSelection = prepareDictionarySelection(inflected);
        if (
          !selection.ok ||
          selection.language !== "en" ||
          !aliasSelection.ok ||
          aliasSelection.language !== "en"
        ) {
          continue;
        }
        const entry = entries.get(entryKey(exceptionFile.partOfSpeech, selection.key));
        if (!entry) continue;
        entry.exceptionForms.add(aliasSelection.key);
        addAlias(entry, aliasSelection.key, "wordnet-exception");
      }
    }
  }

  for (const entry of entries.values()) {
    if (!/^[a-z]+$/u.test(entry.word)) continue;
    if (entry.partOfSpeech === "noun" && entry.exceptionForms.size === 0) {
      addAlias(entry, regularNounPlural(entry.word), "plural");
    }
    if (entry.partOfSpeech === "verb" && !IRREGULAR_THIRD_PERSON_VERBS.has(entry.word)) {
      addAlias(entry, regularVerbThirdPerson(entry.word), "present");
    }
  }

  const output = createWriteStream(options.outputPath, { encoding: "utf8", flags: "wx" });
  let outputError: unknown;
  output.on("error", (error) => {
    outputError = error;
  });
  for (const entry of entries.values()) {
    const record = {
      word: entry.word,
      lang_code: "en",
      pos: entry.partOfSpeech,
      senses: entry.definitions.map((definition) => ({ glosses: [definition] })),
      forms: [...entry.forms].map(([form, tag]) => ({ form, tags: [tag] })),
    };
    if (!output.write(`${JSON.stringify(record)}\n`)) await once(output, "drain");
    if (outputError) throw outputError;
  }
  output.end();
  await once(output, "close");
  if (outputError) throw outputError;

  return {
    records: entries.size,
    senses: [...entries.values()].reduce((sum, entry) => sum + entry.definitions.length, 0),
    aliases: [...entries.values()].reduce((sum, entry) => sum + entry.forms.size, 0),
  };
}

function parseDataRow(
  path: string,
  lineNumber: number,
  line: string,
  expectedSynsetTypes: ReadonlySet<string>,
): { words: string[]; definition: string } {
  const separator = line.indexOf("|");
  if (separator < 0) throw formatError(path, lineNumber, "missing gloss separator");
  const fields = line.slice(0, separator).trim().split(/\s+/);
  let cursor = 0;
  const take = (name: string): string => {
    const value = fields[cursor];
    if (value === undefined) throw formatError(path, lineNumber, `missing ${name}`);
    cursor += 1;
    return value;
  };

  if (!/^\d{8}$/.test(take("synset offset")))
    throw formatError(path, lineNumber, "invalid synset offset");
  if (!/^\d{2}$/.test(take("lexicographer file number")))
    throw formatError(path, lineNumber, "invalid lexicographer file number");
  const synsetType = take("synset type");
  if (!expectedSynsetTypes.has(synsetType)) {
    throw formatError(path, lineNumber, `unexpected synset type ${synsetType}`);
  }
  const wordCountText = take("word count");
  if (!/^[0-9a-f]{2}$/i.test(wordCountText)) {
    throw formatError(path, lineNumber, "invalid hexadecimal word count");
  }
  const wordCount = Number.parseInt(wordCountText, 16);
  if (wordCount === 0) throw formatError(path, lineNumber, "synset has no words");
  const words: string[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    const rawWord = take(`word ${index + 1}`);
    if (!/^[\x21-\x7e]+$/u.test(rawWord))
      throw formatError(path, lineNumber, `invalid word ${index + 1}`);
    const lexId = take(`lex id ${index + 1}`);
    if (!/^[0-9a-f]$/iu.test(lexId))
      throw formatError(path, lineNumber, `invalid lex id ${index + 1}`);
    const word = normalizeLemma(rawWord);
    if (word) words.push(word);
  }
  if (words.length === 0) throw formatError(path, lineNumber, "synset has no words");

  const pointerCountText = take("pointer count");
  if (!/^\d{3}$/u.test(pointerCountText))
    throw formatError(path, lineNumber, "invalid pointer count");
  const pointerCount = Number.parseInt(pointerCountText, 10);
  for (let index = 0; index < pointerCount; index += 1) {
    const symbol = take(`pointer ${index + 1} symbol`);
    if (!WORDNET_POINTER_SYMBOLS.has(symbol))
      throw formatError(path, lineNumber, `invalid pointer ${index + 1} symbol`);
    if (!/^\d{8}$/u.test(take(`pointer ${index + 1} synset offset`)))
      throw formatError(path, lineNumber, `invalid pointer ${index + 1} synset offset`);
    if (!/^[nvar]$/u.test(take(`pointer ${index + 1} part of speech`)))
      throw formatError(path, lineNumber, `invalid pointer ${index + 1} part of speech`);
    const sourceTarget = take(`pointer ${index + 1} source/target`);
    if (!/^[0-9a-f]{4}$/iu.test(sourceTarget))
      throw formatError(path, lineNumber, `invalid pointer ${index + 1} source/target`);
    const sourceWord = Number.parseInt(sourceTarget.slice(0, 2), 16);
    if (sourceWord > wordCount)
      throw formatError(path, lineNumber, `pointer ${index + 1} source word is out of range`);
  }

  if (synsetType === "v") {
    const frameCountText = take("verb frame count");
    if (!/^\d{2}$/u.test(frameCountText))
      throw formatError(path, lineNumber, "invalid verb frame count");
    const frameCount = Number.parseInt(frameCountText, 10);
    for (let index = 0; index < frameCount; index += 1) {
      if (take(`verb frame ${index + 1} marker`) !== "+")
        throw formatError(path, lineNumber, `invalid verb frame ${index + 1} marker`);
      if (!/^\d{2}$/u.test(take(`verb frame ${index + 1} number`)))
        throw formatError(path, lineNumber, `invalid verb frame ${index + 1} number`);
      const wordNumber = take(`verb frame ${index + 1} word number`);
      if (!/^[0-9a-f]{2}$/iu.test(wordNumber))
        throw formatError(path, lineNumber, `invalid verb frame ${index + 1} word number`);
      if (Number.parseInt(wordNumber, 16) > wordCount)
        throw formatError(path, lineNumber, `verb frame ${index + 1} word is out of range`);
    }
  }
  if (cursor !== fields.length)
    throw formatError(path, lineNumber, "unexpected token before gloss");

  const gloss = line.slice(separator + 1).trim();
  const exampleStart = gloss.search(/;\s*"/u);
  const definition = (exampleStart >= 0 ? gloss.slice(0, exampleStart) : gloss).trim();
  if (!definition) throw formatError(path, lineNumber, "synset has no definition");
  return { words, definition };
}

function normalizeLemma(value: string): string {
  return value
    .replace(/\((?:a|p|ip)\)$/u, "")
    .replaceAll("_", " ")
    .normalize("NFKC")
    .trim();
}

function entryKey(partOfSpeech: PartOfSpeech, word: string): string {
  return `${partOfSpeech}\0${word}`;
}

function addAlias(entry: PendingWordNetEntry, alias: string, tag: string): void {
  if (alias !== entry.word && !entry.forms.has(alias)) entry.forms.set(alias, tag);
}

function regularNounPlural(word: string): string {
  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/u.test(word)) return `${word}es`;
  return `${word}s`;
}

function regularVerbThirdPerson(word: string): string {
  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ies`;
  if (word === "do" || word === "go" || /(?:s|x|z|ch|sh)$/u.test(word)) return `${word}es`;
  return `${word}s`;
}

function formatError(path: string, lineNumber: number, message: string): Error {
  return new Error(`Invalid WordNet data in ${path} at line ${lineNumber}: ${message}`);
}
