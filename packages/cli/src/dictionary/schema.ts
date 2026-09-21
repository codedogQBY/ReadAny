export const DICTIONARY_SCHEMA_VERSION = 1 as const;

export const DICTIONARY_SCHEMA_SQL = `
PRAGMA journal_mode = DELETE;
PRAGMA synchronous = OFF;
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  language TEXT NOT NULL CHECK (language IN ('en', 'zh')),
  headword TEXT NOT NULL,
  simplified TEXT,
  traditional TEXT,
  pronunciation TEXT,
  part_of_speech TEXT NOT NULL
);
CREATE TABLE senses (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  sense_order INTEGER NOT NULL,
  definition TEXT NOT NULL,
  PRIMARY KEY (entry_id, sense_order)
) WITHOUT ROWID;
CREATE TABLE lookup (
  lookup_key TEXT NOT NULL,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  rank INTEGER NOT NULL,
  PRIMARY KEY (lookup_key, entry_id)
) WITHOUT ROWID;
CREATE INDEX lookup_key_rank_idx ON lookup(lookup_key, rank, entry_id);
`;
