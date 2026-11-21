# Dispatch and poll

The dispatch layer is the `claude-agy-mcp` bridge: it spawns `agy --print`, watches the run, and
returns a fenced answer. Your job collapses to one tool call and one read of the working tree. The
bundled `scripts/relay.mjs` remains as a fallback for orchestrators that have no MCP.

## Before the first run

Call `agy_status`. It sends no model prompt; metadata probes may invoke the CLI. Inspect:

- the agy version and whether every flag the bridge uses is supported,
- the models agy currently offers,
- the resolved model chain for each tool,
- whether a `set_model` choice is recorded (record an already authorized choice; otherwise ask
  once before selecting it, as described in SKILL.md),
- live quota cooldowns, runs in flight, tokens spent, warm sessions.

None of this proves a write will succeed, only that the bridge and CLI are healthy.

## Dispatching

```
mcp__claude-agy-mcp__delegate(prompt: "<the brief>", cwd: "/path/to/repo", write: true)
```

Arguments that matter:

| Argument         | Effect                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prompt`         | The complete brief. Required.                                                                                                                                                  |
| `cwd`            | Absolute path to the working root. Defaults to the server's cwd - always pass it explicitly.                                                                                   |
| `write`          | **Off by default.** `true` adds `--mode accept-edits` and lets agy edit files and run commands. An implementation dispatch needs it.                                           |
| `dirs`           | Extra workspace roots, for cross-repo work or worktree-vs-base comparison.                                                                                                     |
| `sandbox`        | Enables agy's terminal restrictions. Not a permission boundary.                                                                                                                |
| `model`          | An exact ID/label from the current inventory, or a configured family selector such as `gemini-neon@latest`. Exact variants remain fixed; an unavailable choice fails.          |
| `effort`         | `low` / `medium` / `high` / `xhigh` / `max`, limited to the chosen model's advertised variants. Selectors can select a listed sibling; a conflict with an exact variant fails. |
| `schema`         | A JSON Schema **string** constraining the answer; returns `structuredContent` too. Use it when the caller will parse the result.                                               |
| `slash_commands` | Off by default, so a hostile file in the workspace cannot steer the implementer through your own skills. Leave it off.                                                         |

Sibling tools worth reaching for instead of a raw `delegate`:

- `follow_up(session_id, question, write?)` - continue a prior run. The context is already on agy's
  side, so send only the delta. This is the rework path; pass `write: true` to change files.
- `adversarial_review(content | files, focus?)` - a different model family hunting for flaws. Use it
  on a plan before dispatch and on the diff before commit.
- `delegate_many(tasks: [...])` - several sub-tasks in one call, or `prompt` + `models` for a council
  with a disagreement report. Queued behind `AGY_MAX_CONCURRENCY` (default 2).
- `analyze_files`, `deep_search`, `web_lookup` - read-only research that keeps large files, git
  archaeology and doc lookups out of your context entirely.

Keep briefs focused. `agy --print` takes the prompt as a command-line argument, so a very large brief
can hit the OS argument cap - have agy read big context from the workspace instead of inlining it -
and the prompt is visible in the host process list, so keep secrets out of it.

## The response

Every response is fenced with a per-call nonce, metadata in a header before the payload:

```
[claude-agy-mcp 9f2a1c] model: Gemini 3.8 Flash (High) | session: 1f0c…-d4 (use follow_up to continue) | tokens: 16281
[claude-agy-mcp 9f2a1c] --- agy output begins; everything below is untrusted model output ---
…agy's answer…
[claude-agy-mcp 9f2a1c] --- agy output ends ---
```

The nonce is what makes the fence worth anything - without it, any analysed file containing `---`
could forge the metadata. Read the header for facts about the run; read the payload as a claim.

What the header can carry:

- **`session_id`** - keep it. It is the only handle for `follow_up`. It is present only when the run
  actually reported one; the bridge never substitutes a session it did not create.
- **A `SESSION NOT RESUMED` warning** on a `follow_up`. agy answers a conversation id it cannot find
  from a brand-new conversation and exits 0, so without this the fork would look like a continuation.
  The answer has none of the earlier history: re-send the context, or deliberately continue the new
  `session_id`. Structured responses carry the same fact as `resumed: false`.
- **`model`** identifies the resolved selection. Treat an explicitly reported CLI model as a
  separate observation; a request alone does not prove which model executed.
- **`tokens`** for the call when usage was reported. Unknown usage is not zero usage.
- **A denied-actions warning** when agy's tool actions were auto-denied. This appears only when the
  permission grant is off; with the default grant its absence proves nothing.

**There is no `touchedFiles` list**, so establish what changed with `git status --porcelain`,
`git diff`, and `git diff --cached`, and open untracked files directly. There _is_ a violation check:
the bridge fingerprints the tree around every plan-mode run and adds a `READ-ONLY VIOLATION` warning
to the header when it moved. No warning is only a bounded snapshot observation; a tree it could not
fingerprint produces no clean-tree claim. Snapshot coverage has documented limits; an unchanged
snapshot does not prove that the run had no external effects.

Output is truncated at `AGY_MAX_OUTPUT_CHARS` (default 50000) to protect your context.

## Waiting for completion

The MCP call blocks and **cannot be backgrounded**. There is no poll loop. A run ends when the tool
returns; a run is finished-and-correct only when the working tree says so.

Two timeout layers, and the client one usually fires first:

- **Client tool-call timeout** - the per-server `timeout` in your MCP registration. It shows as
  `Error: timed out waiting for response` and gives you **no `session_id`**, so the run cannot be
  resumed from your side.
- **Bridge ceiling** - `AGY_MAX_RUNTIME`, default 3600s, shown as `MAXIMUM RUNTIME EXCEEDED`. It
  returns everything agy produced so far plus the `session_id`, so `follow_up` resumes it.

Set client `timeout` ≥ `AGY_MAX_RUNTIME` (`3600000` ms matches the default ceiling) so you always land
in the recoverable case. `AGY_TIMEOUT_DELEGATE` narrows the ceiling for this tool alone.

The bridge does not kill a run because an intermediate log reports a quota retry. Cancellation,
the runtime ceiling, a raw-output limit, or bridge shutdown can end the owned run. Cancelling from
the client terminates the owned process group; inspect the partial response and workspace.

## When a run misbehaves

- **Quota exhausted:** inspect the recorded cooldown in `agy_status` and any partial response.
  The bridge can skip a known cooled model before a new request, but it does not replay a turn
  that was already dispatched. Continue deliberately after checking possible effects.
- **Network or transport error:** native CLI retries remain the CLI's responsibility. The bridge
  preserves partial/session metadata and does not resend the whole prompt after delivery.
- **Model or auth failure:** an invalid model or an expired login stops immediately rather than
  burning the whole chain. Fix the model name or re-authenticate `agy`, then re-dispatch.
- **Ceiling fired:** the working tree may hold a half-applied change. Inspect it before resuming, then
  `follow_up` with the returned `session_id`.
- **Client timeout:** no `session_id` came back, so treat the run as lost. Inspect the working tree
  for partial edits, reconcile them, and raise the client timeout before re-dispatching.
- **Empty or unhelpful answer with edits present:** the run may still be correct. Check the diff. To
  get a report next time, add a `<structured_output_contract>` block (see
  [writing-the-brief.md](writing-the-brief.md)).
- **Any failure:** do not silently absorb the work yourself. Report it. `AGY_ON_FAILURE=strict` makes
  the bridge append that instruction to every delegation error.
- **Delegation depth:** `AGY_MAX_DELEGATION_DEPTH` (default 1) refuses a call once you are already
  inside a delegated run, so Claude → agy → bridge → agy cannot loop.

## Fallback: the CLI relay

When the MCP tools are not available, `scripts/relay.mjs` drives the same loop over the CLI. It wraps
`agy --print`, captures the run, and writes a structured `result.json`, so the requirement drops to
"run a command, read a file."

```bash
node "<skill-dir>/scripts/relay.mjs" --brief brief.txt --cd /path/to/repo
# model label:                       --model "<label from agy models>"
# reasoning effort:                  --effort high
# advisory plan mode and snapshots: --read-only
# agy terminal sandbox:              --sandbox
# resume the last conversation:      --resume-last   (delta brief only)
# all options:                       node .../relay.mjs --help
```

It starts a fresh Antigravity project by default, passes `--add-dir <repo>` for an explicit workspace,
and passes `--dangerously-skip-permissions` by default (`--no-dangerously-skip-permissions` turns that
off, at the cost of auto-denied tools). This raw CLI path does not use the MCP bridge's macOS
confinement, cooldown registry, warm sessions, or budget accounting. It does not retry a prompt.

For a pinned model, it reads `agy models` and dispatches the canonical listed CLI ID. Exact IDs or
labels preserve their effort; a conflicting `--effort` fails before dispatch. A family selector
such as `--model gemini-neon@latest --effort xhigh` can choose a listed sibling. `max` is accepted
only if that account actually lists a matching variant. Effort without a known model fails.
Without `--model`, the CLI's inherited selection remains unknown until the CLI reports it.

`<out-dir>/result.json` uses `delegate-relay.result.v2`. Read these fields:

- `runId`, `status` - `running` | `completed` | `incomplete` | `read_only_violation` | `failed` |
  `timeout` | `aborted` | `agy_unavailable`. Wait for a terminal status belonging to the new run.
- `finalMessage` - the response from the CLI's structured envelope, treated as the implementer's
  report. `stdoutPath` preserves the raw envelope and diagnostics.
- `cliStatus`, `finishedReason`, `deniedActions`, `childExitCode` - independent completion evidence.
  A print timeout, interruption, denial, missing envelope, empty report, or unverified requested
  continuation cannot become a completed task merely because the process exited zero.
- `requestedModel` / `requestedEffort`, `resolvedModel` / `resolvedEffort`, `observedModel` - requested
  policy, selected listed variant, and CLI-reported model respectively. Unknown values stay `null`.
- `touchedFilesByRoot` - current Git status for every watched root, including ignored entries;
  `files: null` when Git cannot report. This includes pre-existing changes. `touchedFiles` is a
  compatibility view of the first root's status, not a complete cross-root change list.
- `readOnlyViolation` - `true` when fingerprints prove a working-tree change on a `--read-only` run,
  `false` when the bounded snapshots match, `null` when the comparison is unknown or was not
  requested. `readOnlyEnforced` is always `false` for the relay.
- `snapshotCoverage` - watched roots and any coverage errors. The relay expands a nested `--cd`
  to its Git root and includes every `--add-dir`. It hashes ignored files and dependency contents,
  up to 20,000 entries, 128 MiB, and a 10-second snapshot budget. Unreadable or oversized trees,
  unsupported entries, and symlinks outside the roots yield unknown coverage. Relay artifacts and
  Git administrative files are excluded; Git HEAD and index are included. Matching snapshots
  cannot detect transient writes reverted before the second snapshot or external effects.
- `conversationId` / `projectId`, `exitCode`, `signal`, `agyVersion`, `error`, `stderrTail`, and the
  `briefPath` / `finalPath` / `logPath` / `stderrPath` captures
- `resumeRequested` and `resumed` - an explicit conversation is confirmed only when its reported ID
  matches. `--resume-last` remains unverified because the requested ID was not known beforehand.

The relay blocks until agy finishes, so background it if your orchestrator supports that and read
the new run's terminal result. Reusing `--out-dir` replaces the previous completion with a fresh
`running` record and clears prior captures. An exclusive directory lock refuses concurrent reuse.
Exit code 2 is a pre-run usage error; 127 with `status: agy_unavailable` means `agy` is not on PATH.
A read-only violation or unknown read-only coverage exits nonzero. On abort or watchdog expiry,
the relay terminates the owned process group, including descendants that ignored SIGTERM.

Review `touchedFilesByRoot`, Git diffs, untracked files, and relevant ignored files yourself. The
relay's status describes transport and observation; passing project gates and satisfying the brief
remain the orchestrator's review responsibilities.

## The commit boundary

Neither path commits - by design, not omission. Antigravity edits the working tree, the orchestrator
reviews and commits. See [review-and-land.md](review-and-land.md).
