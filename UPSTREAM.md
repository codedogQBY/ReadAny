# Upstream provenance

This repository is developed as a public fork of
[`codedogQBY/ReadAny`](https://github.com/codedogQBY/ReadAny), licensed under
GPL-3.0-or-later. ReadAny attribution, copyright notices, and the original license must be
preserved.

## Pinned baseline

- Upstream remote: `https://github.com/codedogQBY/ReadAny.git`
- Upstream branch: `main`
- PR-000 baseline: `3f8826c37391721289f4d6db47bacc0c73788572`
- Observed: 2026-08-11 (Asia/Shanghai)

## Synchronizing with upstream

Keep `origin` pointed at the public fork and `upstream` pointed at ReadAny. Update the fork's
public `main` without rewriting history:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

If a published feature branch needs a newer upstream commit, merge the reviewed upstream state
into it. Do not force-push or rebase in ways that erase or rewrite public review history.
