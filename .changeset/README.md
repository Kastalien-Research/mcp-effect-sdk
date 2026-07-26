# Changesets

This folder holds [changesets](https://github.com/changesets/changesets): one
Markdown file per user-visible change, describing the semver bump and the
release note.

Add one with `pnpm changeset` whenever a pull request changes published
behaviour — the public API surface, wire behaviour, protocol coverage, or a bug
users can observe. Purely internal work (docs, tests, check scripts, refactors
with no surface change) does not need one.

`pnpm changeset version` consumes the pending files into `CHANGELOG.md` and the
`package.json` version. `pnpm release` publishes.
