import { access, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute } from "node:path";
import { convertWordNetDirectory } from "../src/dictionary/wordnet-converter.js";

interface Arguments {
  inputDirectory: string;
  output: string;
}

function usage(message: string): never {
  throw new Error(
    `${message}\nUsage: dictionary:convert-wordnet --input-directory absolute-dict-path --output absolute-jsonl-path`,
  );
}

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      usage(`Invalid argument: ${flag ?? ""}`);
    }
    const key = flag.slice(2);
    if (key !== "input-directory" && key !== "output") usage(`Unexpected argument: ${flag}`);
    if (values.has(key)) usage(`Duplicate argument: ${flag}`);
    values.set(key, value);
  }
  const inputDirectory = values.get("input-directory");
  const output = values.get("output");
  if (!inputDirectory) usage("Missing required argument: --input-directory");
  if (!output) usage("Missing required argument: --output");
  return { inputDirectory, output };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (!isAbsolute(args.inputDirectory)) usage("--input-directory must be an absolute path");
  if (!isAbsolute(args.output)) usage("--output must be an absolute path");
  if (extname(args.output) !== ".jsonl") usage("--output must be a .jsonl path");
  if (!(await stat(args.inputDirectory)).isDirectory()) {
    usage("--input-directory must identify a directory");
  }
  await Promise.all([access(args.inputDirectory), stat(dirname(args.output))]);
  const stats = await convertWordNetDirectory({
    inputDirectory: args.inputDirectory,
    outputPath: args.output,
  });
  process.stdout.write(`${JSON.stringify(stats)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
