#!/usr/bin/env python3
"""Close the loop between the Effect language service and the model.

The `@effect/language-service` plugin in tsconfig.json only serves an editor's
tsserver; Claude Code never runs tsserver, and node_modules/typescript is
unpatched, so `npm run typecheck` emits zero Effect diagnostics. Without this
hook the model only sees Effect diagnostics if it remembers to shell out.

After each Edit/Write of a TypeScript file, run the language service scoped to
that one file (~1.5s, vs ~7s project-wide) and inject the result back as
context. Errors and warnings are listed in full; message-severity diagnostics
are rolled up by rule name to keep the injection small.

Gotcha worth preserving: `--file` is silently IGNORED when `--project` is also
passed — the CLI falls back to checking the whole project. Pass `--file` alone;
it resolves the nearest tsconfig on its own, picking up the plugin's severity
configuration.

Never breaks a session — always exits 0."""
import json, os, pathlib, subprocess, sys

CHECKED_SUFFIXES = (".ts", ".mts", ".cts")
SKIP_PARTS = {"node_modules", "dist", "servers", ".worktrees", "backfill"}
MAX_LISTED = 15
TIMEOUT_SECONDS = 45


def target_file(data):
    """Absolute path of the edited file, or None if it isn't ours to check."""
    resp = data.get("tool_response")
    inp = data.get("tool_input")
    raw = None
    if isinstance(resp, dict):
        raw = resp.get("filePath")
    if not raw and isinstance(inp, dict):
        raw = inp.get("file_path")
    if not raw:
        return None

    path = pathlib.Path(str(raw))
    if not path.is_absolute() or not path.exists():
        return None
    if path.name.endswith(".d.ts") or path.suffix not in CHECKED_SUFFIXES:
        return None
    if SKIP_PARTS & set(path.parts):
        return None

    root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())).resolve()
    try:
        path.resolve().relative_to(root)
    except ValueError:
        return None  # outside this project — a different tsconfig owns it
    return path.resolve(), root


def run_diagnostics(path, root):
    cli = root / "node_modules" / ".bin" / "effect-language-service"
    if not cli.exists():
        return None
    proc = subprocess.run(
        [str(cli), "diagnostics", "--file", str(path), "--format", "json"],
        cwd=str(root), capture_output=True, text=True, timeout=TIMEOUT_SECONDS,
    )
    if not proc.stdout.strip():
        return None
    return json.loads(proc.stdout).get("diagnostics", [])


def render(diags, path, root):
    """Return context text, or None when there is nothing worth injecting."""
    rel = os.path.relpath(path, root)
    # The CLI reports on the file's whole program; keep only this file's rows.
    mine = [d for d in diags if d.get("file") == str(path)]
    if not mine:
        return None

    loud = [d for d in mine if d.get("severity") in ("error", "warning")]
    quiet = [d for d in mine if d.get("severity") not in ("error", "warning")]

    lines = [f"Effect language service on {rel}:"]
    for d in loud[:MAX_LISTED]:
        lines.append(
            f"  {d.get('severity')} {d.get('name')} "
            f"({rel}:{d.get('line')}:{d.get('column')}) {d.get('message')}"
        )
    if len(loud) > MAX_LISTED:
        lines.append(f"  ... and {len(loud) - MAX_LISTED} more errors/warnings.")

    if quiet:
        rollup = {}
        for d in quiet:
            rollup[d.get("name")] = rollup.get(d.get("name"), 0) + 1
        summary = ", ".join(f"{n}x{c}" for n, c in sorted(rollup.items()))
        lines.append(f"  suggestions (not listed): {summary}")

    lines.append(
        "  Diagnostics on lines you did not touch may predate this edit — fix "
        "what your change introduced. Full detail: "
        f"`pnpm run effect:file -- {rel}`."
    )
    return "\n".join(lines)


def main():
    data = json.load(sys.stdin)
    resolved = target_file(data)
    if not resolved:
        return
    path, root = resolved

    diags = run_diagnostics(path, root)
    if not diags:
        return
    ctx = render(diags, path, root)
    if not ctx:
        return

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": ctx,
        }
    }))


try:
    main()
except Exception:
    pass
sys.exit(0)
