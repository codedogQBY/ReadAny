import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertWordNetDirectory } from "./wordnet-converter.js";

const fixtureDirectory = resolve(import.meta.dirname, "fixtures/wordnet");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("convertWordNetDirectory", () => {
  it("converts WordNet synsets and conservative inflections to deterministic builder JSONL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-wordnet-converter-"));
    temporaryDirectories.push(directory);
    const firstOutput = join(directory, "first.jsonl");
    const secondOutput = join(directory, "second.jsonl");

    const firstStats = await convertWordNetDirectory({
      inputDirectory: fixtureDirectory,
      outputPath: firstOutput,
    });
    const secondStats = await convertWordNetDirectory({
      inputDirectory: fixtureDirectory,
      outputPath: secondOutput,
    });

    const firstBytes = await readFile(firstOutput, "utf8");
    expect(await readFile(secondOutput, "utf8")).toBe(firstBytes);
    expect(secondStats).toEqual(firstStats);
    const records = firstBytes
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(firstStats).toEqual({ records: 14, senses: 15, aliases: 15 });
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          word: "desire",
          lang_code: "en",
          pos: "noun",
          senses: [
            { glosses: ["a strong feeling of wanting something"] },
            { glosses: ["something that is wanted"] },
          ],
          forms: [{ form: "desires", tags: ["plural"] }],
        }),
        expect.objectContaining({
          word: "desire",
          pos: "verb",
          senses: [{ glosses: ["feel or have a desire for"] }],
          forms: [{ form: "desires", tags: ["present"] }],
        }),
        expect.objectContaining({
          word: "child",
          pos: "noun",
          forms: [{ form: "children", tags: ["wordnet-exception"] }],
        }),
        expect.objectContaining({ word: "good", pos: "adjective" }),
        expect.objectContaining({ word: "ice cream", pos: "noun", forms: [] }),
        expect.objectContaining({
          word: "go",
          pos: "verb",
          forms: [
            { form: "went", tags: ["wordnet-exception"] },
            { form: "goes", tags: ["present"] },
          ],
        }),
        expect.objectContaining({
          word: "do",
          pos: "verb",
          forms: [
            { form: "did", tags: ["wordnet-exception"] },
            { form: "does", tags: ["present"] },
          ],
        }),
        expect.objectContaining({
          word: "have",
          pos: "verb",
          forms: [{ form: "has", tags: ["wordnet-exception"] }],
        }),
        expect.objectContaining({
          word: "be",
          pos: "verb",
          forms: [{ form: "is", tags: ["wordnet-exception"] }],
        }),
        expect.objectContaining({
          word: "tattoo",
          pos: "noun",
          forms: [{ form: "tattoos", tags: ["plural"] }],
        }),
        expect.objectContaining({
          word: "tattoo",
          pos: "verb",
          forms: [{ form: "tattoos", tags: ["present"] }],
        }),
      ]),
    );
    expect(firstBytes).not.toContain("tattooes");
    expect(firstBytes).not.toContain("his desire was obvious");
    expect(firstBytes).not.toContain("the house was his desire");
    expect(firstBytes).not.toContain("I desire a quiet room");
  });

  it.each([
    ["malformed lex id", "data.noun", "city 0 000", "city zz 000"],
    ["missing pointer count", "data.noun", "city 0 000", "city 0"],
    ["malformed pointer", "data.noun", "city 0 000", "city 0 001 @ nope n 0000"],
    ["malformed verb frame", "data.verb", "go 0 000 00", "go 0 000 01 ? 01 00"],
    ["unexpected trailing token", "data.noun", "city 0 000", "city 0 000 surprise"],
  ])(
    "rejects %s instead of accepting a partial data-row parse",
    async (_name, fileName, from, to) => {
      const directory = await mkdtemp(join(tmpdir(), "readany-wordnet-grammar-"));
      temporaryDirectories.push(directory);
      const inputDirectory = join(directory, "wordnet");
      await cp(fixtureDirectory, inputDirectory, { recursive: true });
      const path = join(inputDirectory, fileName);
      const source = await readFile(path, "utf8");
      await writeFile(path, source.replace(from, to), "utf8");

      await expect(
        convertWordNetDirectory({ inputDirectory, outputPath: join(directory, "output.jsonl") }),
      ).rejects.toThrow(new RegExp(`${fileName.replace(".", "\\.")}.*line`, "i"));
    },
  );

  it("rejects a malformed WordNet data row with its file and line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-wordnet-invalid-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "wordnet.jsonl");

    await expect(
      convertWordNetDirectory({
        inputDirectory: resolve(import.meta.dirname, "fixtures/wordnet-invalid"),
        outputPath,
      }),
    ).rejects.toThrow(/data\.noun.*line/i);
  });

  it("exposes a validated release-side conversion command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-wordnet-command-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "wordnet.jsonl");
    const scriptPath = resolve(import.meta.dirname, "../../scripts/convert-wordnet.ts");
    const tsxPath = resolve(import.meta.dirname, "../../../../node_modules/tsx/dist/cli.mjs");

    const result = spawnSync(
      process.execPath,
      [tsxPath, scriptPath, "--input-directory", fixtureDirectory, "--output", outputPath],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ records: 14, senses: 15, aliases: 15 });
    expect(existsSync(outputPath)).toBe(true);
  });
});
