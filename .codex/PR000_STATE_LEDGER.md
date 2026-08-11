# PR-000 State Ledger

Last updated: 2026-08-11 (Asia/Shanghai)

## Immutable task authority

- Task: PR-000 — Open-source Development Baseline
- Objective: establish a Windows-first, upstream-syncable, GitHub-reviewable development baseline for the AI Adaptive Agentic Learning Desktop without adding learning features.
- Authoritative prompt: `C:\Users\Administrator\Downloads\AI_READING_PR000_OPEN_SOURCE_BASELINE_CODEX_PROMPT(1).md`
- Upstream repository: `https://github.com/codedogQBY/ReadAny`
- Repository path: `D:\读书学习辅助`
- Branch: `chore/pr000-open-source-baseline`
- Upstream `main` observed at task start: `3f8826c37391721289f4d6db47bacc0c73788572`
- Base full SHA: `3f8826c37391721289f4d6db47bacc0c73788572`
- Current HEAD: `3f8826c37391721289f4d6db47bacc0c73788572`

## Frozen scope

- Add upstream provenance and synchronization policy.
- Add the frozen OSS integration registry without downloading or integrating additional projects.
- Add the concise project charter.
- Add concise UI/UX/UE design governance for later user-facing PRs.
- Establish and verify the real Windows development/build spine.
- Add or correct minimum real Windows pull-request CI.
- Preserve GPL-3.0-or-later licensing, copyright, and ReadAny attribution.

## Prohibited scope

- No Read-Box, DeepTutor, The Knowledge Guy, or Gutendex integration.
- No Learner Model, Goal Agent, Reward Engine, Visual Learning, account, cloud sync, or learning feature implementation.
- No ReadAny RAG or ebook parser replacement.
- No broad UI redesign, mobile restructuring, final branding, or speculative future abstractions.
- No reset, rebase, force push, destructive branch replacement, or public-history rewrite.

## Git and GitHub state

- `upstream`: `https://github.com/codedogQBY/ReadAny.git`
- `origin`: `https://github.com/dongxuelian11/ReadAny.git`
- GitHub CLI account: `dongxuelian11`; authentication re-verified PASS on 2026-08-11 with `repo` and `workflow` scopes.
- Public fork: PASS — `https://github.com/dongxuelian11/ReadAny` is PUBLIC, `isFork=true`, parent `codedogQBY/ReadAny`, and fork `main` is `3f8826c37391721289f4d6db47bacc0c73788572`.
- PR URL/state: NOT_RUN.
- CI checks: NOT_RUN.

## Materially changed files

- `.codex/PR000_STATE_LEDGER.md` — created as the mandatory compaction-recovery authority.
- `.github/workflows/pr-windows.yml` — adds real Windows PR lint, test, typecheck/frontend build, and NSIS production-build jobs.
- `UPSTREAM.md` — records upstream identity, exact baseline, attribution, and non-rewriting sync policy.
- `INTEGRATIONS.lock.json` — records required future integrations and reference watchlist without vendoring or unverified pins/licenses.
- `docs/PROJECT_CHARTER.md` — freezes the concise product principles.
- `docs/UI_UX_GOVERNANCE.md` — freezes required design-skill and interaction-quality governance for later user-facing PRs.
- `packages/app/src-tauri/tauri.ci.conf.json` — limits PR builds to a real NSIS installer and disables release-only updater signing artifacts while preserving normal release configuration.

## Completed

- PASS — read the authoritative execution prompt.
- PASS — observed upstream `main` directly with `git ls-remote`.
- PASS — cloned upstream into the empty workspace.
- PASS — verified cloned HEAD exactly matches the observed upstream SHA.
- PASS — renamed the cloned remote from `origin` to `upstream` after approved Git metadata access.
- PASS — created the required branch from the exact pinned base after approved Git metadata access.
- PASS — inspected repository scripts, existing workflows, GPL-3.0-or-later license/attribution, and Rust/Tauri configuration.
- PASS — added the required provenance, integration registry, project charter, UI/UX governance, PR CI workflow, and bounded Tauri PR-build override locally.
- PASS — completed the baseline install, lint, real test commands, frontend build, and Windows desktop build investigation with failures classified below.
- PASS — recovery on 2026-08-11 reread the authoritative prompt and ledger, then re-verified branch, HEAD, log, remotes, live upstream SHA, GitHub identity, fork absence, PR absence, and material files before continuing.
- PASS — created the real public GitHub fork and configured it as `origin`; preserved `codedogQBY/ReadAny` as `upstream`.
- PASS — completed bounded post-change regression verification: Core 566/566, Expo 3/3, and frontend build passed; lint and CLI reproduced their exact pre-existing Windows baseline failures without new counts or failure classes.

## Pending / next action

- PENDING — commit, push, create PR, and inspect CI.
- PASS — refreshed the Git index stat cache; `packages/app/src-tauri/Cargo.toml` is clean and has no staged or unstaged content change.
- PASS — reviewed the complete staged diff and confirmed that it contains only the seven intended PR-000 files.
- PASS — validated both JSON files, parsed the workflow YAML, and passed `git diff --cached --check`.
- Next bounded action: commit the reviewed PR-000 change set.

## Test and build truth

| Gate | Status | Evidence |
| --- | --- | --- |
| Upstream SHA observation | PASS | `git ls-remote ... refs/heads/main` returned `3f8826c37391721289f4d6db47bacc0c73788572`. |
| Clone/base match | PASS | `git rev-parse HEAD` matched the observed SHA. |
| Node version | PASS | `node --version` = `v24.16.0`. |
| pnpm version | PASS | Global `11.16.0`; baseline commands use repository-pinned `9.15.0` via Corepack. |
| Rust version | PASS | `rustc 1.96.0 (ac68faa20 2026-05-25)`; `cargo 1.96.0 (30a34c682 2026-05-25)`; `stable-x86_64-pc-windows-msvc`. |
| Dependency installation | PASS | `corepack pnpm install --frozen-lockfile` completed in 50.2s for all 8 workspace projects. Optional `dtrace-provider` native rebuild could not detect VS but its install script intentionally suppressed the error and pnpm exited 0. |
| Lint/typecheck | FAIL | `corepack pnpm lint` exited 1 before PR-000 implementation (`BASELINE_FAILURE`): Biome checked 889 files, reported 1,621 errors and 284 warnings. Visible causes include CRLF formatting differences on the Windows checkout and committed `packages/app/public/vendor/pdfjs/pdf.worker.mjs` exceeding Biome's 1 MiB maximum. No fixes applied. |
| Automated tests | FAIL | Core: PASS, 75 files/566 tests. Expo: PASS, 2 files/3 tests. CLI: `BASELINE_FAILURE`, 5/7 files and 124/135 tests passed; 11 failures remained after an approved unsandboxed rerun and concern Windows Unix/Darwin path simulation plus symlink creation. PR-000 changes no CLI source/tests. |
| Windows desktop production build | PASS | Baseline `pnpm tauri build` compiled Rust release and produced `app.exe`, MSI, and NSIS, then exited 1 because release-only updater signing lacked `TAURI_SIGNING_PRIVATE_KEY` (`BASELINE_FAILURE`). The PR-only NSIS/no-updater-artifact config was then verified with `pnpm --filter app tauri build --config src-tauri/tauri.ci.conf.json --ci`: exit 0 and `ReadAny_1.3.5_x64-setup.exe` produced. |
| Post-change regression verification | FAIL (`BASELINE_FAILURE`) | Re-run on 2026-08-11: lint reproduced 1,621 errors/284 warnings; CLI reproduced 11 failures with 124/135 passing. Core PASS 566/566, Expo PASS 3/3, frontend production build PASS. The bounded PR-only Windows Tauri NSIS build had already passed after the CI override was created. |
| Pull-request CI | NOT_RUN | PR not yet created. |

## Recovery protocol

After compaction/restart: reread the authoritative prompt, reread this ledger, inspect `git status`, branch/HEAD, log/diff, and remotes, then reconcile any PR/check state before continuing. Fail closed on disagreement; never infer success from missing context.
