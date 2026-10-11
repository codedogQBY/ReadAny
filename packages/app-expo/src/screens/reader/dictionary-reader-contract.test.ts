import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readerScreen = readFileSync(resolve(import.meta.dirname, "..", "ReaderScreen.tsx"), "utf8");

describe("ReaderScreen dictionary selection contract", () => {
  it("owns the selected definition text separately from selection and translation state", () => {
    expect(readerScreen).toContain('const [definitionText, setDefinitionText] = useState("");');
    expect(readerScreen).toContain("const [showDefinition, setShowDefinition] = useState(false);");
    expect(readerScreen).toMatch(
      /onDefine=\{\(\) => \{\s*setDefinitionText\(selectionPopoverSelection\.text\);\s*setShowDefinition\(true\);\s*setSelection\(null\);\s*\}\}/,
    );
    expect(readerScreen).toMatch(
      /<DefinitionSheet\s+visible=\{showDefinition\}\s+text=\{definitionText\}/,
    );
  });

  it("clears definition state when its sheet closes and exposes dictionary management", () => {
    expect(readerScreen).toMatch(
      /onClose=\{\(\) => \{\s*setShowDefinition\(false\);\s*setDefinitionText\(""\);\s*\}\}/,
    );
    expect(readerScreen).toMatch(
      /onManageDictionaries=\{\(\) => \{\s*setShowDefinition\(false\);\s*setDefinitionText\(""\);\s*navigation\.navigate\("DictionarySettings" as never\);\s*\}\}/,
    );
  });
});
