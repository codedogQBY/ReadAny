# UI / UX / UE Governance

PR-000 establishes governance only and makes no broad visual changes.

Every later user-facing PR must use the project-approved `apple-design` and `emil-design-eng`
skills. A PR that changes motion or animation must also use `review-animations`. The PR evidence
must record which skills were actually used; it must never claim skill usage that did not occur.

User-facing work must:

- respect reduced-motion preferences;
- intentionally design loading, empty, error, and active states;
- use motion to support comprehension rather than decoration;
- preserve desktop information density and reading focus; and
- treat interaction and visual quality as correctness requirements.

Apple design principles may inform interaction quality, but implementations must not copy Apple
branding, SF Symbols, trade dress, or pixel-level UI.

For PR-000, these skills are recorded as not applicable because no user-facing UI or motion was
changed.
