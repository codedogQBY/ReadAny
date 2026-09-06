import {
  type DictionaryDatabaseAdapter,
  type DictionaryDatabaseConnection,
  DictionaryLookupError,
} from "./dictionary-database";
import { type DictionaryEntry, type DictionaryLanguage, prepareDictionarySelection } from "./index";

const LOOKUP_SQL = `
  WITH matched AS (
    SELECT lookup.entry_id, lookup.rank
    FROM lookup
    INNER JOIN entries ON entries.id = lookup.entry_id
    WHERE lookup.lookup_key = ? AND entries.language = ?
    ORDER BY lookup.rank ASC, lookup.entry_id ASC
    LIMIT 20
  )
  SELECT
    e.id AS entry_id,
    e.language,
    e.headword,
    e.simplified,
    e.traditional,
    e.pronunciation,
    e.part_of_speech,
    matched.rank,
    s.sense_order,
    s.definition
  FROM matched
  INNER JOIN entries e ON e.id = matched.entry_id
  INNER JOIN senses s ON s.entry_id = e.id
  ORDER BY matched.rank ASC, e.id ASC, s.sense_order ASC
`;

interface DictionaryLookupRow {
  entry_id: number;
  language: DictionaryLanguage;
  headword: string;
  simplified: string | null;
  traditional: string | null;
  pronunciation: string | null;
  part_of_speech: string;
  rank: number;
  sense_order: number;
  definition: string;
}

export type DictionaryPackPathResolver = (
  language: DictionaryLanguage,
) => string | null | Promise<string | null>;

export type DictionaryPackInvalidator = (language: DictionaryLanguage) => Promise<void> | void;

export class DictionaryLookupService {
  private readonly connections = new Map<
    DictionaryLanguage,
    Promise<DictionaryDatabaseConnection>
  >();

  constructor(
    private readonly database: DictionaryDatabaseAdapter,
    private readonly resolvePackPath: DictionaryPackPathResolver,
    private readonly invalidatePack: DictionaryPackInvalidator = () => {},
  ) {}

  async lookup(text: string): Promise<DictionaryEntry[]> {
    const selection = prepareDictionarySelection(text);
    if (!selection.ok) {
      throw new DictionaryLookupError(
        "unsupported-selection",
        `Dictionary lookup does not support this selection: ${selection.reason}`,
      );
    }

    const absolutePath = await this.resolvePackPath(selection.language);
    if (!absolutePath) {
      throw new DictionaryLookupError(
        "pack-not-installed",
        `The ${selection.language} dictionary pack is not installed`,
      );
    }

    try {
      const database = await this.connectionFor(selection.language, absolutePath);
      const rows = await database.getAllAsync<DictionaryLookupRow>(
        LOOKUP_SQL,
        selection.key,
        selection.language,
      );
      return this.entriesFromRows(rows);
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      try {
        await this.close(selection.language);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      try {
        await this.invalidatePack(selection.language);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      if (error instanceof Error && cleanupErrors.length > 0) {
        (error as Error & { cleanupErrors?: unknown[] }).cleanupErrors = cleanupErrors;
      }
      throw error;
    }
  }

  async close(language?: DictionaryLanguage): Promise<void> {
    const languages = language ? [language] : [...this.connections.keys()];
    await Promise.all(
      languages.map(async (currentLanguage) => {
        const connection = this.connections.get(currentLanguage);
        if (!connection) return;
        this.connections.delete(currentLanguage);
        await (await connection).closeAsync();
      }),
    );
  }

  private connectionFor(
    language: DictionaryLanguage,
    absolutePath: string,
  ): Promise<DictionaryDatabaseConnection> {
    const existing = this.connections.get(language);
    if (existing) return existing;

    const opening = this.database.open(language, absolutePath);
    this.connections.set(language, opening);
    void opening.catch(() => {
      if (this.connections.get(language) === opening) {
        this.connections.delete(language);
      }
    });
    return opening;
  }

  private entriesFromRows(rows: DictionaryLookupRow[]): DictionaryEntry[] {
    const entries = new Map<number, DictionaryEntry>();
    for (const row of rows) {
      let entry = entries.get(row.entry_id);
      if (!entry) {
        entry = {
          id: row.entry_id,
          language: row.language,
          headword: row.headword,
          simplified: row.simplified ?? undefined,
          traditional: row.traditional ?? undefined,
          pronunciation: row.pronunciation ?? undefined,
          partOfSpeech: row.part_of_speech,
          senses: [],
        };
        entries.set(row.entry_id, entry);
      }
      entry.senses.push({ order: row.sense_order, definition: row.definition });
    }
    return [...entries.values()];
  }
}
