# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
Markdown file per user-visible change, describing the semver bump and the
release note.

Add one with `pnpm changeset` whenever a pull request changes published
behaviour — the public API surface, wire behaviour, protocol coverage, or a bug
users can observe. Purely internal work (docs, tests, check scripts, refactors
with no surface change) does not need one.

`pnpm changeset version` consumes pending files into `CHANGELOG.md` and updates
the package version. The initial `1.0.0` notes were consolidated directly into
the root changelog so the unpublished package was not incorrectly advanced to
`1.1.0`. Subsequent releases use the normal changesets flow. `pnpm release` runs
the complete verification gate and publishes with registry provenance.
