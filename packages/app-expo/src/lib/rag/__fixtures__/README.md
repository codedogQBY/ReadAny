# MOBI-family integration fixtures

These are byte-for-byte Project Gutenberg downloads of ebook 11, *Alice's Adventures in Wonderland* by Lewis Carroll. They were retrieved on 2026-08-16 and are used only to prove ReadAny's real foliate MOBI-family extraction path.

| Fixture | Official acquisition URL | Resolved Project Gutenberg file | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| `gutenberg-11.mobi` | <https://www.gutenberg.org/ebooks/11.kindle.images> | <https://www.gutenberg.org/cache/epub/11/pg11-images.mobi> | 240,898 | `4cc3901c405178935a0d4b25ac03bdafc776e0ec3ce81b24482844f2a47ecd13` |
| `gutenberg-11.azw3` | <https://www.gutenberg.org/ebooks/11.kf8.images> | <https://www.gutenberg.org/cache/epub/11/pg11-images-kf8.mobi> | 256,060 | `fffee390f393ecf004f65c7fcd2cbefb3ee2652ff6f3fa8daa09c8a9a5644df0` |

## Byte identity

Both files have the Palm Database type/creator bytes `BOOKMOBI` and PalmDOC encryption value `0` (unencrypted). The older-Kindle download declares MOBI version 6. The KF8 download declares MOBI version 8 and is stored here with the `.azw3` extension so the integration test covers ReadAny's AZW3 input path without converting or modifying the source bytes.

Project Gutenberg currently publishes the KF8 acquisition with a `.mobi` filename. The Library of Congress format description records that Amazon registered `application/vnd.amazon.mobi8-ebook` for the MOBI version that uses the `.azw3` extension: <https://www.loc.gov/preservation/digital/formats/fdd/fdd000472.shtml>. That byte-level version evidence, rather than a fabricated conversion, is why the untouched KF8 download is the AZW3 fixture.

## Rights and repository suitability

Project Gutenberg's ebook page identifies this title as public domain in the USA: <https://www.gutenberg.org/ebooks/11>. Each fixture includes the Project Gutenberg License and its distribution terms in the ebook text. The two fixtures total 496,958 bytes (about 485 KiB), small enough for deterministic upstream integration coverage while retaining real MOBI v6 and KF8 containers, metadata, sections, compression, and images.
