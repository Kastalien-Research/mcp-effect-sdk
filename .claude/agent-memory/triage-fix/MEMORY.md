- [Effect-foundation collector ENOENT pattern](project_effect-foundation-collector.md)
  — collectSourceFiles crashes on git-tracked-but-deleted files; skip missing
  files, don't touch the index; also note the import-context regex fix for
  @effect/rpc false positives.
- [Zero-dependency scripts pattern](feedback_zero_dependency_scripts.md) — some scripts/*.mjs must never import npm deps because test harnesses run them with no node_modules
- [Stale fail-closed markers](project_stale_fail_closed_markers.md) — check-conformance-evidence.mjs/governance tests assert literal source strings that go stale when a script's implementation idiom changes
