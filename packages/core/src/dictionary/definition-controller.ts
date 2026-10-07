import {
  type DictionaryEntry,
  type DictionaryLanguage,
  type DictionaryPackDescriptor,
  prepareDictionarySelection,
} from "./index";

export type DefinitionState =
  | { kind: "idle" }
  | { kind: "loading"; displayText: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "missing-pack"; language: DictionaryLanguage; descriptor: DictionaryPackDescriptor }
  | { kind: "downloading"; language: DictionaryLanguage; progress: number }
  | { kind: "verifying"; language: DictionaryLanguage }
  | { kind: "result"; displayText: string; entries: DictionaryEntry[] }
  | { kind: "no-match"; displayText: string }
  | { kind: "error"; message: string };

export interface DefinitionControllerDependencies {
  lookup(text: string): Promise<DictionaryEntry[]>;
  install(
    descriptor: DictionaryPackDescriptor,
    onProgress: (progress: number) => void,
    onVerifying?: () => void,
  ): Promise<void>;
  getDescriptor(language: DictionaryLanguage): DictionaryPackDescriptor | undefined;
}

type DefinitionStateListener = (state: DefinitionState) => void;

interface DictionaryError extends Error {
  code?: string;
}

export class DefinitionController {
  private requestToken = 0;
  private selectedText: string | null = null;
  private readonly listeners = new Set<DefinitionStateListener>();

  state: DefinitionState = { kind: "idle" };

  constructor(private readonly dependencies: DefinitionControllerDependencies) {}

  subscribe(listener: DefinitionStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(text: string): Promise<void> {
    const token = ++this.requestToken;
    this.selectedText = text;
    await this.lookupSelection(text, token);
  }

  async retry(): Promise<void> {
    if (!this.selectedText) return;
    await this.open(this.selectedText);
  }

  async download(): Promise<void> {
    if (this.state.kind !== "missing-pack" || !this.selectedText) return;

    const { descriptor, language } = this.state;
    const text = this.selectedText;
    const token = this.requestToken;
    this.setState({ kind: "downloading", language, progress: 0 });

    try {
      await this.dependencies.install(
        descriptor,
        (progress) => {
          if (this.isCurrent(token)) {
            this.setState({ kind: "downloading", language, progress: clampProgress(progress) });
          }
        },
        () => {
          if (this.isCurrent(token)) this.setState({ kind: "verifying", language });
        },
      );
    } catch (error) {
      if (this.isCurrent(token)) this.setState({ kind: "error", message: messageOf(error) });
      return;
    }

    if (this.isCurrent(token)) await this.lookupSelection(text, token);
  }

  close(): void {
    this.requestToken += 1;
    this.selectedText = null;
    this.setState({ kind: "idle" });
  }

  private async lookupSelection(text: string, token: number): Promise<void> {
    const selection = prepareDictionarySelection(text);
    if (!selection.ok) {
      if (this.isCurrent(token)) this.setState({ kind: "unsupported", reason: selection.reason });
      return;
    }

    this.setState({ kind: "loading", displayText: selection.displayText });
    try {
      const entries = await this.dependencies.lookup(text);
      if (!this.isCurrent(token)) return;
      this.setState(
        entries.length > 0
          ? { kind: "result", displayText: selection.displayText, entries }
          : { kind: "no-match", displayText: selection.displayText },
      );
    } catch (error) {
      if (!this.isCurrent(token)) return;
      const dictionaryError = error as DictionaryError;
      if (dictionaryError.code === "pack-not-installed") {
        const descriptor = this.dependencies.getDescriptor(selection.language);
        if (descriptor) {
          this.setState({ kind: "missing-pack", language: selection.language, descriptor });
          return;
        }
      }
      if (dictionaryError.code === "unsupported-selection") {
        this.setState({ kind: "unsupported", reason: "unsupported-selection" });
        return;
      }
      this.setState({ kind: "error", message: messageOf(error) });
    }
  }

  private isCurrent(token: number): boolean {
    return token === this.requestToken;
  }

  private setState(state: DefinitionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
