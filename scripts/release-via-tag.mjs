// Deliberately dependency-free: this script ships inside the published
// tarball (see test/packaging/wp5h-packed-core-consumer.test.mjs) and must
// fail closed even when run before `npm install`/`pnpm install` has resolved
// any dependency, `effect` included. Do not add imports here.
console.error(
  [
    "Direct publication is disabled.",
    "Push the signed v1.0.0 tag after the tagged commit passes qualification;",
    ".github/workflows/release.yml publishes the exact tested tarball."
  ].join(" ")
)
throw new Error("Direct publication is disabled; release through the signed tag workflow.")
