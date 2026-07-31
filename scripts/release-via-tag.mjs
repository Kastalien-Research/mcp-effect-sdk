// Deliberately dependency-free: this script ships inside the published
// tarball (see test/packaging/wp5h-packed-core-consumer.test.mjs) and must
// fail closed even when run before `npm install`/`pnpm install` has resolved
// any dependency, `effect` included. Do not add imports here.
const workflowInvocation = process.argv[2] === "--workflow-version" && process.argv.length === 4
const lifecycleInvocation = process.env.npm_lifecycle_event === "prepublishOnly"
const version = workflowInvocation ? process.argv[3] : process.env.npm_package_version
const expectedTag = typeof version === "string" ? `v${version}` : undefined
const releaseChecks = [
  ["release guard invocation", workflowInvocation || lifecycleInvocation],
  ["stable package version", typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)],
  ["MCP_RELEASE_CHANNEL", process.env.MCP_RELEASE_CHANNEL === "github-actions-tag"],
  ["GITHUB_ACTIONS", process.env.GITHUB_ACTIONS === "true"],
  ["GITHUB_EVENT_NAME", process.env.GITHUB_EVENT_NAME === "push"],
  ["GITHUB_REF_TYPE", process.env.GITHUB_REF_TYPE === "tag"],
  ["GITHUB_REF_NAME", expectedTag !== undefined && process.env.GITHUB_REF_NAME === expectedTag],
  ["GITHUB_REF", expectedTag !== undefined && process.env.GITHUB_REF === `refs/tags/${expectedTag}`],
  ["GITHUB_REPOSITORY", process.env.GITHUB_REPOSITORY === "Kastalien-Research/mcp-effect-sdk"],
  ["GITHUB_SHA", /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? "")],
  ["GITHUB_RUN_ID", /^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID ?? "")],
  ["ACTIONS_ID_TOKEN_REQUEST_URL", /^https:\/\//.test(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "")]
]

if (releaseChecks.every(([, passed]) => passed)) {
  console.log(`Authorized ${expectedTag} publication from the tag-triggered GitHub Actions release workflow.`)
} else {
  const failed = releaseChecks.filter(([, passed]) => !passed).map(([name]) => name)
  console.error(
    [
      "Direct publication is disabled.",
      "Push the signed release tag after the tagged commit passes qualification;",
      ".github/workflows/release.yml publishes the exact tested tarball.",
      failed.length === 0 ? "" : `Failed release context: ${failed.join(", ")}.`
    ]
      .filter(Boolean)
      .join(" ")
  )
  throw new Error("Direct publication is disabled; release through the signed tag workflow.")
}
