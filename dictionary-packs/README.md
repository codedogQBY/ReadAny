# ReadAny offline dictionary packs v1

These are optional, one-time downloads used for on-device definition lookup.
They are not bundled into the app and lookup never falls back to AI or a web
definition service.

## Exact user-download sizes

| Language | Coverage/source | Entries | Bytes | MiB | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| English | WordNet 3.1 | 154,404 | 29,069,312 | 27.722656 | `90adbeab5ee325b31f2e34bbfa7c5b699932c900bfd1efdfc62eabd9e004ee0e` |
| Chinese | Chinese Wiktionary 2026-09-01 | 77,256 | 11,866,112 | 11.316406 | `d50218459f78a5e7bcba819fbb7db699271bdaf30757dc8b2443cb1e37bc11b1` |

Downloading both packs is 40,935,424 bytes (39.039062 MiB). Each real SQLite
pack is below the 150 MiB hard stop used for this release. The release URLs in
`manifest.json` point to the published `dictionary-packs-v1` assets. The initial
packs are hosted by contributor cha1latte; they are data downloads, not app updates.
The app reads manifest updates from the official repository after this feature
is merged and falls back to its bundled manifest when offline. Maintainers can
move assets by updating the manifest URLs while preserving the verified hashes.
An alternate manifest can be selected at build time with
`EXPO_PUBLIC_DICTIONARY_MANIFEST_URL` (mobile) or `VITE_DICTIONARY_MANIFEST_URL`
(desktop). The published packs are available in the [contributor release](https://github.com/cha1latte/ReadAny/releases/tag/dictionary-packs-v1) for maintainers to migrate.

WordNet gives strong ordinary English vocabulary in a compact download, but has
less slang, newer language, proper-name coverage, and obscure material than the
full English Wiktionary source that was rejected for this initial release after
its pinned extraction projected a multi-day run.

## Pinned sources and provenance

### English

- Official source: `https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz`
- Archive bytes: 16,358,468
- Archive SHA-256: `3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a`
- Source edition: WordNet 3.1
- Source date: 2011-05-26, recorded from the archive's top-level directory and
  exception-file timestamps; WordNet 3.1 remains the authoritative edition identity
- License: WordNet 3.1 License; see `LICENSE-WORDNET-3.1.txt`
- Converted JSONL: 154,404 records, 206,143 definitions, 66,893 aliases
- Converted JSONL bytes: 30,477,132
- Converted JSONL SHA-256: `65f632bef5671e85f649f510eef13d90d752d11dcedc252de65f48a6d2f0d359`

### Chinese

- Official source: `https://dumps.wikimedia.org/zhwiktionary/20260901/zhwiktionary-20260901-pages-articles.xml.bz2`
- Dump bytes: 284,272,376
- Dump SHA-256: `516d870bb8ddaa461e013cfb0d477229501c9b8f97fd56c8a7098f42e3586a22`
- Source edition/date: Chinese Wiktionary, 2026-09-01
- License: CC BY-SA 4.0; see `LICENSE-WIKTIONARY.txt`
- Extractor: Wiktextract commit `1939b1f8b1ae5d6989b8cbaea91c639b1b5dcbef`
- Extracted JSONL: 245,518 language-matching data records, of which 80,623
  contain at least one non-empty gloss
- Accepted SQLite entries: 77,256; senses: 105,182; lookup rows: 129,666
- Wiktextract hard redirects and same-language soft redirects contribute 10,113
  rank-1 lookup rows across 7,801 aliases that were absent from the prior pack.
  Redirect chains resolve only to existing canonical entries; cycles, missing
  targets, and unsupported-language aliases do not create lookup rows.

## Deterministic transformation

The WordNet converter reads `data.noun`, `data.verb`, `data.adj`, and `data.adv`
using the complete official database-row grammar: fixed-width offsets and
counts, hexadecimal lexical IDs, every pointer record, verb frame counts and
records, and exact pre-gloss token consumption. It converts
underscore-separated lemmas to display spaces, removes adjective syntactic
markers, groups definitions by lemma and part of speech, and omits quoted usage
examples. It attaches aliases from the four WordNet exception files. For
single-token nouns without an official noun exception, it uses conservative
plural rules: consonant-`y` to `-ies`, sibilants to `-es`, and otherwise `-s`.
For verbs it adds only third-person singular: `do`/`go` and sibilants use
`-es`, consonant-`y` uses `-ies`, and other verbs use `-s`; the official
exceptions supply irregular `be` and `have` forms. Thus `goes`, `does`, `has`,
`is`, and `tattoos` are present while `tattooes` is absent. It does not guess
past tense, gerunds, participles, or comparative/superlative forms.

The shared pack builder retains:

- language, canonical headword, and part of speech;
- every non-empty definition;
- WordNet exception and conservative regular aliases for English;
- the first available `zh-pron` and Simplified/Traditional aliases for Chinese;
- Chinese Wiktextract hard/soft redirects, including chains whose final target
  is an existing same-language canonical entry;
- canonical lookup rank 0 and alias rank 1; and
- source edition/date, distinct source-archive, asset, and human-readable
  attribution URLs, transformation identity, creator attribution, and the
  complete source-specific license/notice text in SQLite metadata.

The v1 schema has no examples, translations, audio, images, or AI-generated
data. WordNet semantic relations and verb frames are also not represented.

## Reproduction commands

```powershell
pnpm --filter @readany/cli dictionary:convert-wordnet -- --input-directory ./dictionary-source/wordnet-3.1\dict --output ./dictionary-source/en-wordnet-3.1.jsonl

pnpm --filter @readany/cli dictionary:build -- --language en --input ./dictionary-source/en-wordnet-3.1.jsonl --output ./dictionary-source/readany-dictionary-en-v1.sqlite --version 1.0.0 --source-edition wordnet-3.1 --license "WordNet 3.1 License" --source-date 2011-05-26 --source-archive-url https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz --attribution-url https://wordnet.princeton.edu/license-and-commercial-use --license-file ./dictionary-packs/LICENSE-WORDNET-3.1.txt --creator-attribution "WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved." --asset-url https://github.com/cha1latte/ReadAny/releases/download/dictionary-packs-v1/readany-dictionary-en-v1.sqlite --descriptor ./dictionary-source/en-descriptor.json

pnpm --filter @readany/cli dictionary:build -- --language zh --input ./dictionary-source/zh-20260901.jsonl --output ./dictionary-source/readany-dictionary-zh-v1.sqlite --version 1.0.0 --source-edition zhwiktionary --license "CC BY-SA 4.0" --source-date 2026-09-01 --source-archive-url https://dumps.wikimedia.org/zhwiktionary/20260901/zhwiktionary-20260901-pages-articles.xml.bz2 --attribution-url https://zh.wiktionary.org/wiki/Wiktionary:%E7%89%88%E6%9D%83%E4%BF%A1%E6%81%AF --license-file ./dictionary-packs/LICENSE-WIKTIONARY.txt --creator-attribution "Wiktionary contributors." --asset-url https://github.com/cha1latte/ReadAny/releases/download/dictionary-packs-v1/readany-dictionary-zh-v1.sqlite --descriptor ./dictionary-source/zh-descriptor.json
```

Before publication, each descriptor must exactly match an independent local
file-size and SHA-256 check. `manifest.json` and the app's bundled manifest must
remain byte-identical and must pass the shared strict manifest parser.

## Desktop and mobile integration

Both apps use the same bundled manifest in
`packages/core/src/dictionary/dictionary-manifest.json`, selection normalization,
lookup SQL, validation, pack lifecycle, and store logic. Mobile uses Expo SQLite
and filesystem adapters. Desktop stores packs under the Tauri app-data directory's
`dictionaries` folder and runs read-only SQLite queries in a blocking native task.
Each native query closes its file handle, and the desktop adapter waits for pending
queries before pack replacement or removal.

On desktop, select an English or Chinese word and choose **Define**. A missing
pack prompts for an explicit download. **Settings > Dictionaries** supports
downloading, updating, repairing, and removing packs. Installed lookups work offline.

Desktop checks: `pnpm --filter app test:dictionary`, `pnpm --filter app exec tsc --noEmit`,
and `cargo test --locked dictionary::tests` from `packages/app/src-tauri`.

Desktop pack downloads stream directly from the existing native HTTP client into
a buffered file writer, with progress events limited to ten per second. The UI
shows a separate verification phase before activating a pack. Both apps refresh
the catalog and installed-pack status when the Dictionaries settings page opens.

A local Windows debug-preview comparison on 2026-09-06 measured the same English
pack (29,069,312 bytes) at 13.67 seconds through the original JavaScript chunk loop
and 1.58 seconds through native streaming. One full checksum/schema verification
pass took 0.59 and 0.61 seconds respectively. Progress callbacks fell from 1,776 to
13. Both files matched the published SHA-256. These are single-run measurements
on the same machine and connection, not a guaranteed download time.
