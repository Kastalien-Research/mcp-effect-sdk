#!/usr/bin/env python3
"""Claude Code Stop Hook — LangSmith Tracing Integration.
Sends Claude Code traces to LangSmith after each response.
Adapted from https://github.com/langchain-ai/tracing-claude-code
"""

import json
import os
import re
import sys
import time
import uuid
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Config
LOG_FILE = os.path.expanduser("~/.claude/state/hook.log")


def _is_credential(key):
    """Only *_API_KEY vars hold secrets.

    The placeholder vocabulary below ("todo", "placeholder", ...) is a
    credential heuristic. Applied to CC_LANGSMITH_PROJECT or
    TRACE_TO_LANGSMITH it would silently override an ambient value that is
    perfectly legitimate — a project really can be named "placeholder".
    """
    return key.endswith("_API_KEY")


def _is_unusable(value, secret=False):
    """True when a value is present but cannot be what the caller needs.

    Mirrors `dev-processes/harness/env.ts::isMalformedSecret`. A *present but
    malformed* ambient value is the failure this exists for: `.claude/
    settings.json` once carried `"LANGSMITH_API_KEY": "$LANGSMITH_API_KEY"`,
    and that block does not expand `$VAR`, so every session inherited the
    literal 18-character string. Because the fallback below only filled vars
    that were *unset*, the broken value shadowed the real key in `.env` and
    403'd 121 uploads across three days without anyone noticing.

    An unexpanded "$VAR" is never a legitimate value for anything, so that
    check applies to every var. The placeholder vocabulary is credential-only.
    """
    if value is None:
        return True
    v = value.strip()
    if not v:
        return True
    # Unexpanded shell references: "$FOO" or "${FOO}".
    if re.fullmatch(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?", v):
        return True
    if secret and re.fullmatch(r"(changeme|your[-_]?key|xxx+|todo|placeholder)", v, re.I):
        return True
    return False


def _first_usable_key(*names):
    """First usable credential among `names`, in precedence order.

    Filtering has to happen at SELECTION, not only at load: `.env` may define
    LANGSMITH_API_KEY while a malformed CC_LANGSMITH_API_KEY sits in the
    ambient environment. Nothing in `.env` replaces that alias, so a plain
    `a or b` would hand back the broken higher-precedence value.
    """
    for name in names:
        value = os.environ.get(name)
        if not _is_unusable(value, secret=True):
            return value.strip()
    return ""


def _load_dotenv_fallback():
    """Fill LangSmith vars from the gitignored project .env when absent from
    the environment (hooks don't inherit shell dotfiles).

    A well-formed ambient value always wins — that is normal precedence. An
    UNUSABLE one loses to `.env` rather than silently shadowing it.
    """
    root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    try:
        with open(os.path.join(root, ".env"), encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip().removeprefix("export ").strip()
                if not key.startswith(("LANGSMITH_", "CC_LANGSMITH_", "TRACE_TO_LANGSMITH")):
                    continue
                secret = _is_credential(key)
                value = value.strip().strip("'\"")
                if _is_unusable(os.environ.get(key), secret) and not _is_unusable(value, secret):
                    os.environ[key] = value
    except OSError:
        pass


_load_dotenv_fallback()
DEBUG = os.environ.get("CC_LANGSMITH_DEBUG", "").lower() == "true"
TRACE_ENABLED = os.environ.get("TRACE_TO_LANGSMITH", "").lower() == "true"
API_KEY = _first_usable_key("CC_LANGSMITH_API_KEY", "LANGSMITH_API_KEY")
PROJECT = os.environ.get("CC_LANGSMITH_PROJECT", "recruiter-sourcing")
API_BASE = "https://api.smith.langchain.com"
STATE_FILE = os.environ.get("STATE_FILE", os.path.expanduser("~/.claude/state/langsmith_state.json"))

CURRENT_TURN_ID: Optional[str] = None

# HTTP codes from failed uploads this invocation. Surfaced to the user at exit:
# these previously went only to a log file, and a malformed LANGSMITH_API_KEY
# silently 403'd every batch for two days (2026-07-24..26) before anyone noticed.
UPLOAD_FAILURES: list = []


def log(level: str, msg: str):
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a") as f:
            f.write(f"{ts} [{level}] {msg}\n")
    except Exception:
        pass


def debug(msg: str):
    if DEBUG:
        log("DEBUG", msg)


def api_call(method: str, endpoint: str, data: str) -> Optional[str]:
    try:
        result = subprocess.run(
            ["curl", "-s", "--max-time", "60", "-w", "\n%{http_code}",
             "-X", method,
             "-H", f"x-api-key: {API_KEY}",
             "-H", "Content-Type: application/json",
             "-d", data,
             f"{API_BASE}{endpoint}"],
            capture_output=True, text=True, timeout=65
        )
        lines = result.stdout.strip().rsplit("\n", 1)
        if len(lines) == 2:
            response, http_code = lines
        else:
            response, http_code = "", lines[0] if lines else "0"

        code = int(http_code) if http_code.isdigit() else 0
        if code < 200 or code >= 300:
            log("ERROR", f"API call failed: {method} {endpoint} HTTP {code}: {response[:200]}")
            return None
        return response
    except Exception as e:
        log("ERROR", f"API call exception: {e}")
        return None


def get_microseconds() -> str:
    return str(int(time.time() * 1000000) % 1000000).zfill(6)


def new_uuid() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def dotted_timestamp() -> str:
    dt = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"{dt}{get_microseconds()}Z"


def iso_to_dotted(ts: str) -> str:
    """Convert ISO timestamp to dotted_order format."""
    if not ts:
        return dotted_timestamp()
    # Remove dashes/colons, handle milliseconds
    cleaned = ts.replace("-", "").replace(":", "")
    # Handle .NNNz -> NNN000Z
    if "." in cleaned:
        parts = cleaned.split(".")
        frac = parts[1].rstrip("Zz")
        cleaned = parts[0] + frac.ljust(6, "0") + "Z"
    elif cleaned.endswith("Z") or cleaned.endswith("z"):
        cleaned = cleaned[:-1] + "000000Z"
    return cleaned


def load_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {}
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def get_content(msg: dict) -> Any:
    if isinstance(msg, dict):
        if "message" in msg:
            return msg["message"].get("content")
        return msg.get("content")
    return None


def is_tool_result(msg: dict) -> bool:
    content = get_content(msg)
    if isinstance(content, list):
        return any(
            isinstance(c, dict) and c.get("type") == "tool_result"
            for c in content
        )
    return False


def format_content(msg: dict) -> list:
    content = get_content(msg)
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        result = []
        for item in content:
            if isinstance(item, dict):
                t = item.get("type")
                if t == "text":
                    result.append({"type": "text", "text": item.get("text", "")})
                elif t == "thinking":
                    result.append({"type": "thinking", "thinking": item.get("thinking", "")})
                elif t == "tool_use":
                    result.append({"type": "tool_call", "name": item.get("name"), "args": item.get("input"), "id": item.get("id")})
                else:
                    result.append(item)
            elif isinstance(item, str):
                result.append({"type": "text", "text": item})
            else:
                result.append(item)
        return result if result else [{"type": "text", "text": ""}]
    return [{"type": "text", "text": ""}]


def get_tool_uses(msg: dict) -> list:
    content = get_content(msg)
    if not isinstance(content, list):
        return []
    return [c for c in content if isinstance(c, dict) and c.get("type") == "tool_use"]


def get_usage_from_msg(msg: dict) -> Optional[dict]:
    if isinstance(msg, dict):
        m = msg.get("message", msg)
        return m.get("_usage") or m.get("usage")
    return None


def find_tool_result(tool_id: str, tool_results: list) -> dict:
    for msg in tool_results:
        content = get_content(msg)
        if not isinstance(content, list):
            continue
        for c in content:
            if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") == tool_id:
                rc = c.get("content")
                if isinstance(rc, list):
                    text = " ".join(item.get("text", "") for item in rc if isinstance(item, dict) and item.get("type") == "text")
                elif isinstance(rc, str):
                    text = rc
                else:
                    text = json.dumps(rc) if rc else "No result"
                return {"result": text, "timestamp": msg.get("timestamp")}
    return {"result": "No result", "timestamp": None}


def merge_assistant_parts(parts: list) -> dict:
    if not parts:
        return {}
    base = parts[0].copy()

    # Merge content from all parts
    all_content = []
    for part in parts:
        content = get_content(part)
        if isinstance(content, str):
            all_content.append({"type": "text", "text": content})
        elif isinstance(content, list):
            all_content.extend(content)

    # Merge adjacent text blocks
    merged = []
    buf = None
    for item in all_content:
        if isinstance(item, dict) and item.get("type") == "text":
            if buf:
                buf["text"] += item.get("text", "")
            else:
                buf = dict(item)
        else:
            if buf:
                merged.append(buf)
                buf = None
            merged.append(item)
    if buf:
        merged.append(buf)

    # Set merged content
    if "message" in base:
        base["message"] = dict(base["message"])
        base["message"]["content"] = merged
        # Preserve usage from last part
        for part in reversed(parts):
            usage = part.get("message", {}).get("usage")
            if usage:
                base["message"]["_usage"] = usage
                break
    else:
        base["content"] = merged

    return base


_SECRET_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    re.compile(r"lsv2_(?:pt|sk)_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}"),
    re.compile(r"sk-[A-Za-z0-9]{32,}"),
    re.compile(r"\bfc-[A-Za-z0-9]{24,}\b"),
    re.compile(r"\bpat[A-Za-z0-9]{10,}\.[A-Za-z0-9]{40,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*"),
]

_SECRET_ENV_KEYS = (
    "ANTHROPIC_API_KEY", "LANGSMITH_API_KEY", "CC_LANGSMITH_API_KEY", "OPENAI_API_KEY",
    "EXA_API_KEY", "FIRECRAWL_API_KEY", "LETTA_API_KEY", "VOYAGE_API_KEY",
    "AIRTABLE_API_KEY", "AGENTMAIL_API_KEY",
)


def _literal_secrets() -> list:
    """Live credential values, longest first so nested values still match."""
    vals = {v.strip() for k in _SECRET_ENV_KEYS
            for v in [os.environ.get(k, "")] if v and len(v.strip()) >= 8}
    return sorted(vals, key=len, reverse=True)


def _redact_text(text: str, literals: list) -> str:
    for secret in literals:
        text = text.replace(secret, "[redacted]")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text


def redact_payload(value, literals=None):
    """Recursively scrub credentials out of anything bound for LangSmith.

    Transcripts are shipped verbatim, so any secret that appeared in a session
    — a printed error, a `cat .env`, an HTTP request dump — would otherwise be
    forwarded to a third party. Added 2026-07-26 after an Effect HTTP failure
    cause printed a live Anthropic key into a session transcript.
    """
    if literals is None:
        literals = _literal_secrets()
    if isinstance(value, str):
        return _redact_text(value, literals)
    if isinstance(value, dict):
        return {k: redact_payload(v, literals) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_payload(v, literals) for v in value]
    return value


def serialize_for_multipart(operation: str, run_json: dict, temp_dir: str) -> list:
    """Serialize run data for multipart upload. Returns list of curl -F args."""
    # Single chokepoint: every payload bound for LangSmith passes through here.
    run_json = redact_payload(run_json)
    run_id = run_json.get("id", "")
    inputs = run_json.get("inputs")
    outputs = run_json.get("outputs")

    main_data = {k: v for k, v in run_json.items() if k not in ("inputs", "outputs")}

    args = []

    # Main data
    main_file = os.path.join(temp_dir, f"{operation}_{run_id}_main.json")
    with open(main_file, "w") as f:
        json.dump(main_data, f)
    main_size = os.path.getsize(main_file)
    args.extend(["-F", f"{operation}.{run_id}=<{main_file};type=application/json;headers=Content-Length:{main_size}"])

    # Inputs
    if inputs is not None:
        inputs_file = os.path.join(temp_dir, f"{operation}_{run_id}_inputs.json")
        with open(inputs_file, "w") as f:
            json.dump(inputs, f)
        inputs_size = os.path.getsize(inputs_file)
        args.extend(["-F", f"{operation}.{run_id}.inputs=<{inputs_file};type=application/json;headers=Content-Length:{inputs_size}"])

    # Outputs
    if outputs is not None:
        outputs_file = os.path.join(temp_dir, f"{operation}_{run_id}_outputs.json")
        with open(outputs_file, "w") as f:
            json.dump(outputs, f)
        outputs_size = os.path.getsize(outputs_file)
        args.extend(["-F", f"{operation}.{run_id}.outputs=<{outputs_file};type=application/json;headers=Content-Length:{outputs_size}"])

    return args


def send_multipart_batch(operation: str, batch: list):
    if not batch:
        return

    temp_dir = tempfile.mkdtemp()
    try:
        curl_args = ["curl", "-s", "--max-time", "60", "-w", "\n%{http_code}", "-X", "POST",
                      "-H", f"x-api-key: {API_KEY}"]

        for run in batch:
            curl_args.extend(serialize_for_multipart(operation, run, temp_dir))

        curl_args.append(f"{API_BASE}/runs/multipart")

        result = subprocess.run(curl_args, capture_output=True, text=True, timeout=65)
        lines = result.stdout.strip().rsplit("\n", 1)
        http_code = int(lines[-1]) if lines and lines[-1].isdigit() else 0

        if http_code < 200 or http_code >= 300:
            log("ERROR", f"Batch {operation} failed: HTTP {http_code}")
            UPLOAD_FAILURES.append(http_code)
        else:
            log("INFO", f"Batch {operation} succeeded: {len(batch)} runs")
    except Exception as e:
        log("ERROR", f"Batch {operation} exception: {e}")
    finally:
        import shutil
        shutil.rmtree(temp_dir, ignore_errors=True)


def create_trace(session_id: str, turn_num: int, user_msg: dict,
                 assistant_messages: list, tool_results: list):
    global CURRENT_TURN_ID

    posts_batch = []
    patches_batch = []

    turn_id = new_uuid()
    user_content = format_content(user_msg)
    now = now_iso()
    dt_stamp = dotted_timestamp()
    turn_dotted_order = f"{dt_stamp}{turn_id}"

    # Top-level turn run
    turn_data = {
        "id": turn_id,
        "trace_id": turn_id,
        "name": "Claude Code",
        "run_type": "chain",
        "inputs": {"messages": [{"role": "user", "content": user_content}]},
        "start_time": now,
        "dotted_order": turn_dotted_order,
        "session_name": PROJECT,
        "extra": {"metadata": {"thread_id": session_id}},
        "tags": ["claude-code", f"turn-{turn_num}"]
    }
    posts_batch.append(turn_data)
    CURRENT_TURN_ID = turn_id

    all_outputs = [{"role": "user", "content": user_content}]
    last_llm_end = now

    for llm_num, assistant_msg in enumerate(assistant_messages, 1):
        msg_timestamp = assistant_msg.get("timestamp", "")
        llm_start = msg_timestamp if msg_timestamp else (now if llm_num == 1 else last_llm_end)

        assistant_id = new_uuid()
        tool_uses = get_tool_uses(assistant_msg)
        assistant_content = format_content(assistant_msg)

        # Model name
        model_name = ""
        if isinstance(assistant_msg, dict) and "message" in assistant_msg:
            model_name = assistant_msg["message"].get("model", "")
        import re
        model_name = re.sub(r"-\d{8}$", "", model_name)

        # Usage
        usage = get_usage_from_msg(assistant_msg)
        usage_metadata = None
        if usage:
            usage_metadata = {
                "input_tokens": (usage.get("input_tokens", 0) +
                                 usage.get("cache_creation_input_tokens", 0) +
                                 usage.get("cache_read_input_tokens", 0)),
                "output_tokens": usage.get("output_tokens", 0),
                "input_token_details": {
                    "cache_read": usage.get("cache_read_input_tokens", 0),
                    "cache_creation": usage.get("cache_creation_input_tokens", 0)
                }
            }

        llm_inputs = {"messages": list(all_outputs)}
        assistant_ts = iso_to_dotted(msg_timestamp) if msg_timestamp else dotted_timestamp()
        assistant_dotted_order = f"{turn_dotted_order}.{assistant_ts}{assistant_id}"
        trace_id = turn_dotted_order.split("Z", 1)[1] if "Z" in turn_dotted_order else turn_id

        assistant_data = {
            "id": assistant_id,
            "trace_id": trace_id,
            "parent_run_id": turn_id,
            "name": "Claude",
            "run_type": "llm",
            "inputs": llm_inputs,
            "start_time": llm_start,
            "dotted_order": assistant_dotted_order,
            "session_name": PROJECT,
            "extra": {"metadata": {"ls_provider": "anthropic", "ls_model_name": model_name}},
            "tags": [model_name] if model_name else []
        }
        posts_batch.append(assistant_data)

        llm_outputs = [{"role": "assistant", "content": assistant_content}]
        assistant_end = now_iso()

        if tool_uses:
            tool_start = msg_timestamp or llm_start

            for tool in tool_uses:
                tool_id = new_uuid()
                tool_name = tool.get("name", "tool")
                tool_input = tool.get("input", {})
                tool_use_id = tool.get("id", "")

                result_data = find_tool_result(tool_use_id, tool_results)
                result_text = result_data["result"]
                tool_result_ts = result_data["timestamp"]

                tool_ts = iso_to_dotted(tool_result_ts) if tool_result_ts else dotted_timestamp()
                tool_dotted_order = f"{turn_dotted_order}.{tool_ts}{tool_id}"
                tool_end = tool_result_ts or now_iso()

                tool_data = {
                    "id": tool_id,
                    "trace_id": trace_id,
                    "parent_run_id": turn_id,
                    "name": tool_name,
                    "run_type": "tool",
                    "inputs": {"input": tool_input},
                    "start_time": tool_start,
                    "dotted_order": tool_dotted_order,
                    "session_name": PROJECT,
                    "tags": ["tool"]
                }
                posts_batch.append(tool_data)

                tool_update = {
                    "id": tool_id,
                    "trace_id": trace_id,
                    "parent_run_id": turn_id,
                    "dotted_order": tool_dotted_order,
                    "outputs": {"output": result_text},
                    "end_time": tool_end
                }
                patches_batch.append(tool_update)
                tool_start = tool_end

            assistant_end = tool_start
        else:
            assistant_end = now_iso()

        # Complete assistant run
        assistant_outputs = {"messages": llm_outputs}
        if usage_metadata:
            assistant_outputs["usage_metadata"] = usage_metadata

        assistant_update = {
            "id": assistant_id,
            "trace_id": trace_id,
            "parent_run_id": turn_id,
            "dotted_order": assistant_dotted_order,
            "outputs": assistant_outputs,
            "end_time": assistant_end
        }
        patches_batch.append(assistant_update)

        last_llm_end = assistant_end
        all_outputs.extend(llm_outputs)

        # Add tool results to accumulated context
        for tool in tool_uses:
            tool_use_id = tool.get("id", "")
            rd = find_tool_result(tool_use_id, tool_results)
            all_outputs.append({
                "role": "tool",
                "tool_call_id": tool_use_id,
                "content": [{"type": "text", "text": rd["result"]}]
            })

    # Complete turn run
    turn_outputs = [o for o in all_outputs if o.get("role") != "user"]
    turn_update = {
        "id": turn_id,
        "trace_id": turn_id,
        "dotted_order": turn_dotted_order,
        "outputs": {"messages": turn_outputs},
        "end_time": last_llm_end
    }
    patches_batch.append(turn_update)

    send_multipart_batch("post", posts_batch)
    send_multipart_batch("patch", patches_batch)

    CURRENT_TURN_ID = None
    log("INFO", f"Created turn {turn_num}: {turn_id} with {len(assistant_messages)} LLM call(s)")


def cleanup_pending_turn():
    if CURRENT_TURN_ID:
        debug(f"Cleanup: completing pending turn run {CURRENT_TURN_ID}")
        now = now_iso()
        data = json.dumps({
            "outputs": {"messages": []},
            "end_time": now,
            "error": "Incomplete: script exited early"
        })
        api_call("PATCH", f"/runs/{CURRENT_TURN_ID}", data)
        log("WARN", f"Completed pending turn run {CURRENT_TURN_ID} due to early exit")


def main():
    import atexit
    atexit.register(cleanup_pending_turn)

    script_start = time.time()

    debug(f"Hook started, TRACE_TO_LANGSMITH={TRACE_ENABLED}")

    if not TRACE_ENABLED:
        debug("Tracing disabled, exiting early")
        sys.exit(0)

    if not API_KEY:
        log("ERROR", "CC_LANGSMITH_API_KEY not set")
        sys.exit(0)

    # Read hook input
    try:
        hook_input = json.loads(sys.stdin.read())
    except Exception:
        log("WARN", "Failed to parse hook input")
        sys.exit(0)

    if hook_input.get("stop_hook_active"):
        debug("stop_hook_active=true, skipping")
        sys.exit(0)

    session_id = hook_input.get("session_id", "")
    transcript_path = hook_input.get("transcript_path", "").replace("~", os.path.expanduser("~"))

    if not session_id or not os.path.exists(transcript_path):
        log("WARN", f"Invalid input: session={session_id}, transcript={transcript_path}")
        sys.exit(0)

    log("INFO", f"Processing session {session_id}")

    state = load_state()
    session_state = state.get(session_id, {})
    last_line = session_state.get("last_line", -1)
    turn_count = session_state.get("turn_count", 0)

    # Read new messages
    with open(transcript_path) as f:
        all_lines = f.readlines()

    new_lines = all_lines[last_line + 1:]
    new_lines = [l.strip() for l in new_lines if l.strip()]

    if not new_lines:
        debug("No new messages")
        sys.exit(0)

    log("INFO", f"Found {len(new_lines)} new messages")

    # Group into turns
    current_user = None
    current_assistants = []
    current_msg_id = None
    current_assistant_parts = []
    current_tool_results = []
    turns = 0
    new_last_line = last_line

    for line_text in new_lines:
        new_last_line += 1
        try:
            line = json.loads(line_text)
        except json.JSONDecodeError:
            continue

        # Determine role
        if isinstance(line, dict) and "message" in line:
            role = line["message"].get("role", "unknown")
        elif isinstance(line, dict):
            role = line.get("role", "unknown")
        else:
            continue

        if role == "user":
            if is_tool_result(line):
                current_tool_results.append(line)
            else:
                # Finalize pending assistant message
                if current_msg_id and current_assistant_parts:
                    merged = merge_assistant_parts(current_assistant_parts)
                    current_assistants.append(merged)
                    current_assistant_parts = []
                    current_msg_id = None

                # Create trace for previous turn
                if current_user and current_assistants:
                    turns += 1
                    turn_num = turn_count + turns
                    try:
                        create_trace(session_id, turn_num, current_user, current_assistants, current_tool_results)
                    except Exception as e:
                        log("ERROR", f"Failed to create trace for turn {turn_num}: {e}")

                current_user = line
                current_assistants = []
                current_assistant_parts = []
                current_msg_id = None
                current_tool_results = []

        elif role == "assistant":
            msg_id = ""
            if isinstance(line, dict) and "message" in line:
                msg_id = line["message"].get("id", "")

            if not msg_id:
                current_assistant_parts.append(line)
            elif msg_id == current_msg_id:
                current_assistant_parts.append(line)
            else:
                if current_msg_id and current_assistant_parts:
                    merged = merge_assistant_parts(current_assistant_parts)
                    current_assistants.append(merged)

                current_msg_id = msg_id
                current_assistant_parts = [line]

    # Process final turn
    if current_msg_id and current_assistant_parts:
        merged = merge_assistant_parts(current_assistant_parts)
        current_assistants.append(merged)

    if current_user and current_assistants:
        turns += 1
        turn_num = turn_count + turns
        try:
            create_trace(session_id, turn_num, current_user, current_assistants, current_tool_results)
        except Exception as e:
            log("ERROR", f"Failed to create trace for turn {turn_num}: {e}")

    # Update state
    state[session_id] = {
        "last_line": new_last_line,
        "turn_count": turn_count + turns,
        "updated": now_iso()
    }
    save_state(state)

    duration = int(time.time() - script_start)
    log("INFO", f"Processed {turns} turns in {duration}s")
    if duration > 180:
        log("WARN", f"Hook took {duration}s (>3min)")


def report_upload_failures():
    """Tell the user when tracing is broken, instead of only the log file."""
    if not UPLOAD_FAILURES:
        return
    codes = sorted(set(UPLOAD_FAILURES))
    hint = ""
    if 401 in codes or 403 in codes:
        hint = (
            " Auth rejected — check LANGSMITH_API_KEY. An unexpanded '$VAR' in the "
            "environment will shadow a valid key in .env."
        )
    try:
        print(json.dumps({
            "systemMessage": (
                f"LangSmith tracing failed: {len(UPLOAD_FAILURES)} upload(s) "
                f"returned HTTP {', '.join(str(c) for c in codes)}.{hint}"
            )
        }))
    except Exception:
        pass


if __name__ == "__main__":
    main()
    report_upload_failures()
