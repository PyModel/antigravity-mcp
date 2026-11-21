<div align="center">

<img src="https://raw.githubusercontent.com/PyModel/claude-agy-mcp/main/assets/banner.svg" alt="claude-agy-mcp — Claude Code delegates heavy tasks to the Antigravity CLI" width="100%">

<p>
  <a href="https://www.npmjs.com/package/@pymodel/claude-agy-mcp"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@pymodel/claude-agy-mcp?style=flat&logo=npm&logoColor=white&label=downloads&labelColor=1b1f27&color=4E86F5"></a>
  <img alt="visitors" src="https://komarev.com/ghpvc/?username=pymodel-claude-agy-mcp&label=visitors&color=blueviolet&style=flat">
</p>

<p>
  <a href="https://claude.com/claude-code"><img alt="Claude Code" src="https://img.shields.io/badge/Claude_Code-Orchestrator-e0a83c?style=flat&logo=anthropic&logoColor=white&labelColor=1b1f27"></a>
  <a href="https://gemini.google.com"><img alt="Gemini 4" src="https://img.shields.io/badge/Gemini_4-Models-4E86F5?style=flat&logo=googlegemini&logoColor=white&labelColor=1b1f27"></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/MCP-Protocol-D96570?style=flat&logo=modelcontextprotocol&logoColor=white&labelColor=1b1f27"></a>
</p>

<p>
  <a href="#install"><b>Install</b></a> ·
  <a href="#models-and-plan-availability"><b>Models & Plans</b></a> ·
  <a href="#pricing-and-cost"><b>Pricing</b></a> ·
  <a href="#complementary-mcp-tools"><b>Companion Tools</b></a> ·
  <a href="#tools"><b>Tools</b></a> ·
  <a href="#timeouts-and-cancellation"><b>Timeouts</b></a> ·
  <a href="#configuration"><b>Configuration</b></a>
</p>

# ⚡ Install

```bash
npm i @pymodel/claude-agy-mcp
```

```bash
claude mcp add-json -s user claude-agy-mcp \
  '{"type":"stdio","command":"npx","args":["-y","@pymodel/claude-agy-mcp"],"timeout":3600000}'
```

**Delegate research, code analysis, and implementation to the Antigravity CLI (`agy`) from your MCP client.** Select Gemini 4 Neon, Carbon, Argon, Hydrogen, or another model actually available to your account.

The bridge resolves account-specific model IDs, preserves conversation sessions, reports usage and partial failures, and returns bounded results. Existing automatic Flash routes remain available; choose a Gemini 4 variant explicitly with `set_model` or a per-call `model`.

</div>

## Models and plan availability

**For Antigravity access, checked November 21, 2026. Google AI Pro includes some Gemini 4 families; Google AI Ultra includes all four current Gemini 4 families. Carbon is not included with personal Pro.** Availability still depends on account, provider, region, and trial eligibility; run `agy models` or call `agy_status` before selecting a model.

| Model                        | Free / Plus | Paid Pro               | Ultra | Pro trial                           |
| ---------------------------- | ----------- | ---------------------- | ----- | ----------------------------------- |
| Gemini 4 Neon                | No          | Yes                    | Yes   | Eligible premium-device trials only |
| Gemini 4 Carbon              | No          | No                     | Yes   | No                                  |
| Gemini 4 Argon               | No          | Yes                    | Yes   | Eligible premium-device trials only |
| Gemini 4 Hydrogen            | No          | Yes                    | Yes   | No                                  |
| Orchestrator                 | No          | Yes, eligible planners | Yes   | Eligible premium-device trials only |
| Gemini 3.8 Flash             | Yes         | Yes                    | Yes   | Yes                                 |
| Claude Sonnet 5.5 / Opus 5.5 | No          | Yes                    | Yes   | No                                  |

Source: [Google Antigravity model availability](https://antigravity.google/docs/models). “All four” does not mean every historical or Enterprise-only model. Enterprise/Workspace access follows separate licensing. Older Claude 4.6 and GPT-OSS rows are scheduled for removal on November 30, 2026; the resolver therefore uses live inventory rather than a permanent allowlist.

### Gemini 4 IDs and effort

| Family   | AGY CLI ID pattern         | Listed effort variants in the supplied account snapshot |
| -------- | -------------------------- | ------------------------------------------------------- |
| Neon     | `gemini-4-neon-<tier>`     | `low`, `medium`, `high`, `xhigh`                        |
| Hydrogen | `gemini-4-hydrogen-<tier>` | `low`, `medium`, `high`, `xhigh`                        |
| Carbon   | `gemini-4-carbon-<tier>`   | `low`, `medium`, `high`                                 |
| Argon    | `gemini-4-argon-<tier>`    | `low`, `medium`, `high`                                 |

This account snapshot is a regression fixture, not a universal entitlement promise. The [headless documentation](https://antigravity.google/docs/cli/headless/) publishes examples; the installed CLI's listing decides which variants can run. No `max` variant was supplied. If an account later lists one, the bridge can resolve it without inventing one today.

Orchestrator uses separate opaque IDs when offered: `gemini-pro-orchestrator-neon`, `gemini-pro-orchestrator` (Carbon), and `gemini-pro-orchestrator-argon`. Carbon planning requires the relevant entitlement. Select the exact listed ID; do not attach an unsupported effort or treat an Orchestrator result as independent council votes.

### Which model should I choose?

Use these as evaluation candidates, based on [Google's model-selection guide](https://aistudio.google.com/docs/choosing-a-model), rather than measured performance guarantees for this bridge:

| Work                                                    | Candidate to try                                             | When to increase effort or change model                  |
| ------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| Bounded search, extraction, routine implementation      | Hydrogen Medium; Flash when appropriate for the account      | Verification fails or the task requires deeper reasoning |
| Interactive debugging, architecture, multi-file changes | Neon Medium                                                  | Try High, then XHigh for difficult cases                 |
| Long-running verification and demanding reviews         | Carbon High on Ultra; Argon High as another available option | Compare accepted-task quality, elapsed time, and usage   |
| Integrated planner/executor workflow                    | A listed Orchestrator                                        | Evaluate it separately from independent fan-out          |

The built-in Flash chains remain unchanged until that evaluation is complete. Use `set_model` to opt into Gemini 4. Start with the lowest effort that meets the task's acceptance criteria; higher effort can increase output/thinking usage and latency. API token rates do not translate into a fixed AGY credit charge per task.

## Pricing and cost

**Subscription access, AI credits, and API token billing are different.** Signing in to AGY with a personal Google Account uses its plan quotas and configured AI-credit overages. API-key and Cloud modes have their own billing. Merely exporting a key does not switch a Google-account session into API mode; follow the [CLI authentication guide](https://antigravity.google/docs/install?tab=cli).

US subscription reference: Pro **$19.99/month**; Ultra options **$99.99/month** and **$199.99/month**, before applicable tax and offers. See [Google's current US subscription listing](https://gemini.google/subscriptions/?currencyCode=USD). These fees do not define a fixed AGY token allowance or the API prices below.

### API comparison only — USD per million tokens

Standard global/reference API rates checked November 21, 2026. Output includes billable thinking; cached input has its own rate.

| Model             | Uncached input | Output | Cached input | Announced change                   |
| ----------------- | -------------: | -----: | -----------: | ---------------------------------- |
| Gemini 3.8 Flash  |          $0.75 |  $3.75 |       $0.075 | Jan 1, 2027: $1.50 / $7.50 / $0.15 |
| Gemini 4 Hydrogen |          $1.50 |  $7.50 |       $0.075 | —                                  |
| Gemini 4 Argon    |          $2.00 | $10.00 |        $0.10 | Dec 1, 2026: $4 / $20 / $0.20      |
| Gemini 4 Carbon   |          $2.00 | $10.00 |        $0.10 | Dec 1, 2026: $4 / $20 / $0.20      |
| Gemini 4 Neon     |          $3.00 | $15.00 |        $0.15 | —                                  |
| Claude Sonnet 5.5 |          $2.00 | $10.00 |        $0.10 | —                                  |
| Claude Opus 5.5   |          $4.00 | $20.00 |        $0.20 | —                                  |

Sources: [Gemini Developer API pricing](https://aistudio.google.com/docs/pricing), [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing). These are comparison rates, not an invoice for using those names through an AGY subscription. Provider, region, cache writes and storage, service tier, tools, and promotions affect actual charges. Orchestrator needs per-model usage to estimate dollars reliably.

Among the four Gemini 4 families, Hydrogen has the lowest listed standard token rates. Neon is highest during the Carbon/Argon promotion; Carbon/Argon become highest on December 1. Flash has lower uncached-input and output rates than these four; its cached-input rate matches Hydrogen. Price alone does not establish which completes a task for least total cost. The bridge reports observed usage and does not label missing counters as zero-cost or convert subscription credits into invented dollar figures.

See the [research and implementation decisions](docs/research/gemini4-routing-2026-11-21.md) and [audit report](docs/audits/2026-11-21/report.md) for sources, confirmed defects, verification, and the remaining live evaluation.

## Existing automatic route and historical benchmarks

<div align="center">
  <img src="https://raw.githubusercontent.com/PyModel/claude-agy-mcp/main/assets/benchmarks.svg" alt="Gemini 3.8 Flash Benchmarks" width="100%">
</div>

The automatic route still begins with the newest listed Flash High variant. Changing that default requires a repository-specific evaluation of quality, latency, and cost per accepted task. Gemini 4 support does not silently change an existing saved choice.

> **Historical comparison:** the figures below were recorded for Flash 3.8 versus 3.7 from [Google’s September 2, 2026 launch table](https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber). They are not a Gemini 4 benchmark or a measurement of this bridge. Check current rates in [Pricing and cost](#pricing-and-cost).

### Benchmark Highlights

| Benchmark / Capability    | Gemini 3.8 Flash (High) | Prior Generation (3.7 Flash) | Advantage                                                                      |
| ------------------------- | ----------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| **DeepSWE v1.1**          | **73.7%**               | 65.3%                        | **+8.4 pts** in long-horizon software engineering; within 0.3 of Claude Opus 5 |
| **Terminal-Bench 2.1**    | **89.4%**               | 85.8%                        | **+3.6 pts** in agentic CLI execution; ahead of Opus 5 (89.1%) and GPT-5.6 Sol |
| **OSWorld-2.0**           | **59.0%**               | 50.6%                        | **+8.4 pts** in agentic computer use                                           |
| **HLE-Verified**          | **54.9%**               | 53.6%                        | Multi-step expert reasoning, ahead of Opus 5 (54.4%)                           |
| **Vals Finance Agent v2** | **61.4%**               | 59.0%                        | Leads Opus 5 (58.6%) and GPT-5.6 Sol (53.8%) on quantitative agent work        |

### The Token & Context Multiplier

When Claude Code directly analyzes a 4,000-line database dump or greps 20 files across git history, those thousands of lines stay permanently in Claude's prompt context, inflating cost and pushing you toward compaction.

With `claude-agy-mcp`:

1. Claude calls `analyze_files` or `deep_search`.
2. The selected model processes the source material in a separate `agy` conversation.
3. Only the exact code-level findings and line citations return into Claude's prompt.
4. Subsequent questions reuse the same agy session with `follow_up` without re-sending any files.

---

## Complementary MCP tools

`claude-agy-mcp` is designed to anchor a modern AI engineer's MCP toolkit alongside complementary specialized servers:

| MCP Server           | Primary Superpower                    | When Claude Uses It                                                                                                                                            |
| -------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`claude-agy-mcp`** | **Heavy Compute & Coding Delegation** | Analyzing files >200 lines, repo archaeology (`git log/diff/blame`), adversarial code reviews, and execution through the selected AGY model.                   |
| **`context7`**       | **Up-to-date Official Documentation** | Fetching latest version-accurate API signatures and documentation for libraries (Next.js, React, Tailwind, Prisma, Vite, etc.) to eliminate hallucinated APIs. |
| **`firecrawl`**      | **Clean Web Scraping & Crawling**     | Converting dynamic web pages, documentation sites, and GitHub repos into clean, LLM-ready markdown or structured JSON.                                         |
| **`tavily`**         | **Fast Live Search & Grounding**      | Low-latency web search, current news, error message lookups, and technical research.                                                                           |

### Recommended MCP Configuration (`.agents/mcp_config.json` or Claude Code)

```json
{
  "mcpServers": {
    "claude-agy-mcp": {
      "command": "npx",
      "args": ["-y", "@pymodel/claude-agy-mcp"],
      "timeout": 3600000
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp@latest"]
    },
    "firecrawl": {
      "command": "npx",
      "args": ["-y", "firecrawl-mcp"]
    },
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp"]
    }
  }
}
```

---

## Why this over claude-to-agy?

|                 | claude-to-agy               | **claude-agy-mcp**                                                                                 |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| Tool surface    | 1 generic `delegate_to_agy` | 9 tools for delegation, model selection, and status                                                |
| Model selection | none (agy default only)     | per-tool family selectors that follow new generations, with account validation and quota cooldowns |
| Multi-turn      | stateless                   | session continuity — `follow_up` resumes agy conversations without resending context               |
| Output safety   | unbounded                   | configurable truncation cap protects Claude's context                                              |
| Sandbox         | no                          | read-only tools blocked from writing into the workspace on macOS, optional `--sandbox`             |
| Honest results  | exit code only              | decides on agy's JSON envelope — reports auto-denied tool actions instead of hiding them           |
| Install         | uvx (Python)                | npx (Node) — zero install                                                                          |

## Requirements

- Node.js 24 is recommended for development and deployments. Legacy Node.js 18 is smoke-tested for stdio with npm's default engine checks. The checked-in dependency graph includes an HTTP adapter requiring Node.js 20+, so Node.js 18 `engine-strict` installation of that graph is unsupported; fresh dependency resolution can differ.
- [Antigravity CLI](https://antigravity.google/docs/install?tab=cli) (`agy`) installed and authenticated
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Install

```bash
# 1. Register the MCP server (user scope = all projects).
#    add-json bakes in a generous client-side timeout so long analyze_files /
#    delegate calls don't trip Claude Code's tool-call deadline (see Timeouts).
claude mcp add-json -s user claude-agy-mcp \
  '{"type":"stdio","command":"npx","args":["-y","@pymodel/claude-agy-mcp"],"timeout":3600000}'

# 2. Install the bundled skills into every agent found on this machine.
#    The server gives an agent the tools; the skills tell it when to use them.
npx --package @pymodel/claude-agy-mcp claude-agy-mcp-install-skills
#    --list to preview, --dir <path> to install somewhere explicit,
#    --force to replace a skill you have symlinked to your own checkout.

# 3. Optional: add delegation rules to your project (or ~/.claude/CLAUDE.md).
curl -o CLAUDE.md https://raw.githubusercontent.com/PyModel/claude-agy-mcp/main/CLAUDE.md
```

### Bundled skills

The npm package ships the skills. The installer command above copies them into detected
agent directories or an explicit `--dir`; installing the server alone does not activate them.

| Skill            | What it does                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agy-delegation` | Routing rules: which tool to reach for, and when delegating beats doing the work in-context.                                                                                                                                       |
| `agy-delegate`   | The full delegate-and-review workflow — writing a brief agy can execute blind, dispatching it, reviewing the diff against the brief, and landing it yourself. Includes a CLI-relay fallback for agents that cannot call MCP tools. |

The raw relay has its own result contract and only watches read-only roots on every OS.
It does not inherit the MCP bridge's macOS confinement. Unknown coverage and detected changes
are reported explicitly. Use a separate report directory per job; reuse clears old captures and is locked while a run is active.

> The `"timeout": 3600000` (60 min, milliseconds) is the **client-side** tool-call
> deadline, matched to the bridge's default `AGY_MAX_RUNTIME` ceiling. Without it,
> a cold-start `analyze_files` (~40–50s) or a long `delegate` hits Claude Code's
> default and returns `timed out waiting for response` while the agy run is still
> going — and raising the agy-side ceiling alone will not help, because the client
> aborts first. If your client doesn't honor a per-server `timeout`, set the global
> env var `MCP_TOOL_TIMEOUT=3600000` instead.
> Details in [Timeouts and cancellation](#timeouts-and-cancellation).

## Tools

| Tool                 | Use for                                                                                     | Model routing (first available)                                              |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `analyze_files`      | Files >200 lines, >3 files at once, logs, dumps, generated code                             | `gemini-flash@latest-high` → `gemini-pro@latest-low`                         |
| `deep_search`        | git log/diff/blame archaeology, repo-wide greps                                             | `gemini-flash@latest-high` → `gemini-flash@latest-medium`                    |
| `web_lookup`         | Docs, API references, external/current knowledge                                            | `gemini-flash@latest-high` → `gemini-flash@latest-medium`                    |
| `adversarial_review` | Plan critiques, design and code reviews                                                     | `gemini-flash@latest-high` → `gemini-pro@latest-high` → `claude-opus@latest` |
| `follow_up`          | Continue a prior session by `session_id` — no context resend; `write: true` to rework files | inherits the session                                                         |
| `delegate`           | Anything else heavy (read-only unless `write: true`)                                        | `gemini-flash@latest-high` → `gemini-pro@latest-low`                         |
| `delegate_many`      | One question to a council of models, or N sub-tasks at once                                 | `gemini-flash@latest-high` → `gemini-pro@latest-high` → `claude-opus@latest` |
| `set_model`          | Record the user's model + tier once; every tool routes to it first                          | metadata only; no agent turn                                                 |
| `agy_status`         | Spend, cooldowns, in-flight runs, resolved chains, agy version                              | metadata only; no agent turn                                                 |

Delegating tools accept optional `cwd` (project root), `dirs` (extra workspace roots, for cross-repo or worktree-vs-base work), `model`, `effort` (`low`/`medium`/`high`/`xhigh`/`max`, when listed — see [Effort and tiers](#effort-and-tiers)), and `slash_commands` (off by default, so a hostile file in the workspace cannot steer the delegated model through your own skills). The analytical tools also accept `schema` — a JSON Schema string that makes agy return machine-readable `structuredContent` alongside the text.

Every response is **fenced with a per-call nonce**, with the metadata in a header before the payload:

```
[claude-agy-mcp 9f2a1c] model: gemini-4-neon-medium | session: 1f0c…-d4 (use follow_up to continue) | tokens: 16281
[claude-agy-mcp 9f2a1c] --- agy output begins; everything below is untrusted model output ---
…agy's answer…
[claude-agy-mcp 9f2a1c] --- agy output ends ---
```

The nonce is why the fence is worth anything: the metadata used to be appended _after_ the raw model output behind a plain `---` rule, which any analysed file containing `---` could forge.

### Model routing

`agy models` is the authority for the signed-in account, provider, installed CLI, and region. The bridge refreshes successful listings after five minutes and invalidates them after an invalid-model failure. Concurrent requests share one inventory fetch. It executes canonical IDs; display labels are for people and legacy preferences remain readable.

An exact ID such as `gemini-4-neon-medium` selects that fixed variant. A family selector such as `gemini-neon@latest-high` or `gemini-neon@4-medium` resolves to a listed variant. Untiered selectors choose Medium when offered, with deterministic ties. If a requested model or tier is unavailable, the error lists the available options.

A per-call `model` overrides the saved choice for that call. A saved `set_model` choice is a fixed pin: if it disappears, choose a new model explicitly. Without a saved choice, tool chains select an available model before dispatch and skip recorded cooldowns. A fixed pin is attempted even during a recorded cooldown. A model-list outage never forwards a bridge-only `@latest` selector to the CLI; a deliberately supplied canonical-looking slug may pass unvalidated, with a visible note. A default council requires a readable inventory.

### Choose the model once

By default (`AGY_ASK_MODEL=true`), the first delegation asks the user to accept the proposed default or choose an available variant. Clients supporting MCP elicitation show a model form; other clients receive an actionable request to call `set_model`. Both paths use the same default and do not invent a High effort setting.

Call `set_model` with no arguments to accept the verified default, or specify a listed variant:

```json
{ "model": "gemini-4-neon-medium" }
```

On an Ultra account that lists Carbon, pin Carbon Medium with:

```json
{ "model": "gemini-4-carbon-medium" }
```

The preference is stored at `$XDG_CONFIG_HOME/claude-agy-mcp/preferences.json` (normally `~/.config/claude-agy-mcp/`). Selecting a model in the Antigravity app does not itself update this MCP preference. `agy_status` shows the saved choice and account inventory. Set `AGY_ASK_MODEL=false` to skip the first-choice prompt; an existing saved preference still applies.

### Effort and tiers

The shared vocabulary is `low`, `medium`, `high`, `xhigh`, and `max`; support is verified for the selected model. `xhigh` corresponds to the UI's **Extra** level. Recognizing `max` in CLI help does not mean a model offers it. A parenthetical name such as `Orchestrator (Carbon)` is a fixed model label, not an effort.

- A fixed ID or exact label preserves its tier. `model: "gemini-4-neon-low", effort: "high"` is rejected instead of silently changing the model.
- To choose an effort deliberately, use a family selector, for example `model: "gemini-neon@latest", effort: "high"`. Only a listed sibling can be selected.
- Saved effort never retargets a different explicit model. An unavailable tier fails with the offered alternatives.
- `follow_up` preserves the session's model unless a new model is explicitly selected. If the bridge cannot determine the session model, an effort-only switch is rejected; provide both the model and desired listed tier.
- Listed Orchestrators can be selected by exact ID. The bridge does not invent a Hydrogen Orchestrator or expand a composite Orchestrator into separate council votes.

### Parallel tasks and councils

`delegate_many` supports `tasks`, explicit `models`, a singular `model`, or its default council. These are distinct selection paths; an unrelated council model cannot block explicit tasks. Every explicit council member is validated before the first spawn, and aliases resolving to the same variant are rejected. Missing default members are omitted with a visible note; a zero-member council fails. Calls sharing one conversation remain sequential. Parallel writable tasks should use separate worktrees.

### Quota cooldowns and retries

Modern AGY versions handle transient retries internally. The bridge lets those retries finish; an intermediate log 429 does not kill a healthy turn. A terminal quota failure records its reset time for later independent requests. Cooldowns use immutable records under the cache directory, so concurrent MCP processes cannot overwrite one another's lockouts. Older `cooldowns.json` files remain readable.

**A dispatched agent turn is never automatically replayed by the bridge.** Network errors, quota failures, an invalid model, and ambiguous warm-session failures can arrive after file edits or remote actions. Even an unchanged working tree or zero reported tokens does not prove replay is safe. The response preserves available partial output, session ID, usage, and terminal diagnostics so the caller can reconcile the outcome and deliberately continue. Only a warm path known to be unavailable before sending the prompt may fall back to cold execution.

Automatic routes may choose another available, non-cooling model on the next independent request. Switching Gemini families does not guarantee a different quota bucket. `AGY_ON_FAILURE=strict` changes guidance to the calling agent; it does not enable or disable a hidden retry loop.

### Timeouts and cancellation

**The bridge does not kill a run for being slow.** Elapsed time cannot distinguish a healthy long model call from a wedged process, and a wrong "stuck" verdict interrupts an agent mid-edit — leaving half-written files behind. So a run is killed only when something authoritative says so:

1. **the caller cancels** (e.g. pressing Esc in Claude Code), **the client disconnects**, or **the bridge is stopped** — every agy run it started dies with it instead of being orphaned,
2. **a bounded raw-output limit is exceeded**, which reports an explicit failure, or
3. **the resource ceiling expires** — `AGY_MAX_RUNTIME`, default 3600s.

The ceiling is a resource cap. Raw capture is also bounded: 64 MiB of stdout per cold call or resident turn, 64 MiB of run log, and 1 MiB of cold stderr. Exceeding a bound fails explicitly and preserves a clipped recovery preview; it never silently turns a truncated JSON result into success. When it fires, the result is explicitly incomplete and preserves available bounded output and the session ID when the CLI reports one. Existing file or remote changes are not rolled back; inspect them before a deliberate `follow_up`. `AGY_TIMEOUT` overrides the ceiling for every tool; `AGY_TIMEOUT_<TOOL_NAME>` overrides it for one (e.g. `AGY_TIMEOUT_DEEP_SEARCH=900`) and wins over the global. The full set is `AGY_TIMEOUT_ANALYZE_FILES`, `AGY_TIMEOUT_DEEP_SEARCH`, `AGY_TIMEOUT_WEB_LOOKUP`, `AGY_TIMEOUT_ADVERSARIAL_REVIEW`, `AGY_TIMEOUT_FOLLOW_UP`, `AGY_TIMEOUT_DELEGATE` and `AGY_TIMEOUT_DELEGATE_MANY`; any other `AGY_TIMEOUT_<NAME>` is a startup error, so a misspelt limit cannot silently not apply. Every timeout is at most 604800s (7 days), because Node fires a longer timer immediately. The kill path escalates SIGTERM → SIGKILL across the whole process group, and fires even if agy's helper processes hold the output pipes open.

**Two timeout layers — and the client one usually bites first.** The ceiling above is the _agy-side_ budget. Your MCP client (Claude Code) has its own, separate _tool-call_ timeout, and if it is shorter, the client gives up first — you'll see `Error: timed out waiting for response`, while the bridge's own ceiling reads `MAXIMUM RUNTIME EXCEEDED` instead. Raising `AGY_MAX_RUNTIME` alone therefore changes nothing: the client still aborts on its own schedule. A persisted session may allow recovery with `follow_up`; inspect partial state before continuing. The client setting to change is to make the client wait at least as long as the ceiling. The [Install](#install) command sets a per-server `timeout` of 3600000ms (scoped to this server only). If you registered the server without it, re-run the `add-json` command from Install, or set the global env var `MCP_TOOL_TIMEOUT=3600000`. Rule of thumb: **client `timeout` ≥ `AGY_MAX_RUNTIME`**.

**Expected latency.** Most of the perceived "slowness" is cold start: each call spawns the agy CLI and warms the model. Measured on agy 1.2.0, a trivial prompt costs **2–6s**, a run whose tool actions get denied around **16s**, and one constrained by `--json-schema` up to **56s** (the schema roughly triples thinking tokens). Real `analyze_files` work over several large files is much slower again, and native provider retries can add further latency. `follow_up` is the exception: it reuses a **resident agy process** (see `AGY_WARM_SESSIONS`) and skips the cold start entirely — unless the call changes its model, effort, roots, restrictions, or write permission. Such calls invalidate and reap the old resident before continuing cold. A resident turn is bounded by the same runtime ceiling and cancellation as a cold run. Size the client timeout for the slow cases, not the fast ones.

## Configuration

All optional, via environment variables:

| Variable                    | Default                    | Description                                                                                                                                                                            |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGY_PATH`                  | `agy`                      | Path to the agy binary                                                                                                                                                                 |
| `AGY_MAX_RUNTIME`           | `3600`                     | Seconds; absolute runtime ceiling, independent of cancellation and bounded-output failures                                                                                             |
| `AGY_TIMEOUT`               | `AGY_MAX_RUNTIME`          | Seconds; overrides the ceiling for every tool, passed as `--print-timeout`, enforced with a 15s kill grace                                                                             |
| `AGY_TIMEOUT_<TOOL>`        | `AGY_MAX_RUNTIME`          | Seconds; overrides the ceiling for a single tool, e.g. `AGY_TIMEOUT_DEEP_SEARCH=900`. Wins over `AGY_TIMEOUT`                                                                          |
| `AGY_MAX_OUTPUT_CHARS`      | `50000`                    | Truncation cap for tool output                                                                                                                                                         |
| `AGY_DEFAULT_MODEL`         | `gemini-flash@latest-high` | Proposed by set_model; last-resort candidate in unpinned tool chains; resolved against inventory                                                                                       |
| `AGY_ASK_MODEL`             | `true`                     | Refuse to delegate until the user has chosen a model via `set_model` (asked once, saved per machine)                                                                                   |
| `AGY_EFFORT`                | unset                      | `low` \| `medium` \| `high` \| `xhigh` \| `max`; applied only when a compatible listed variant can be selected                                                                         |
| `AGY_SKIP_PERMISSIONS`      | `true`                     | Pass `--dangerously-skip-permissions` to agy                                                                                                                                           |
| _(all boolean vars)_        | —                          | Accept `true/false`, `1/0`, `yes/no`, `on/off`, case-insensitive. An unrecognized value is a startup error, never a silent default                                                     |
| _(all numeric vars)_        | —                          | Plain decimal digits only (`1e3`, `0x10` and padded values are startup errors). Enum vars (`AGY_EFFORT`, `AGY_ON_FAILURE`) are case-insensitive                                        |
| `AGY_SANDBOX`               | `false`                    | Run agy with `--sandbox`                                                                                                                                                               |
| `AGY_ON_FAILURE`            | `fallback`                 | `strict` appends an instruction to failed-tool errors telling the calling agent not to absorb the work itself                                                                          |
| `AGY_MAX_CONCURRENCY`       | `2`                        | Most agy processes at once. Calls beyond it queue instead of stampeding the shared quota                                                                                               |
| `AGY_BUDGET_TOKENS`         | unset                      | Refuse new dispatches once reported spend reaches this threshold; includes reported failed turns. An in-flight turn can exceed it; this is not a billing cap                           |
| `AGY_ALLOWED_ROOTS`         | unset (unrestricted)       | Roots that `cwd`, `dirs`, `files` and derived workspace roots may not escape, symlinks followed; separated by `:` (`;` on Windows) or commas. Input validation, not a sandbox          |
| `AGY_REDACT`                | `true`                     | Scrub credential-shaped strings from returned text, errors, metadata, and structured content                                                                                           |
| `AGY_MAX_DELEGATION_DEPTH`  | `1`                        | Refuse to delegate once this deep, so Claude → agy → this server → agy cannot loop                                                                                                     |
| `AGY_WARM_SESSIONS`         | `true`                     | Keep a resident agy process per conversation so `follow_up` skips the cold start                                                                                                       |
| `AGY_WARM_MAX`              | `2`                        | Most resident sessions to keep; the least recently used is evicted                                                                                                                     |
| `AGY_WARM_IDLE_SEC`         | `300`                      | Kill a resident session after this long idle                                                                                                                                           |
| `AGY_READ_ONLY_ENFORCEMENT` | `auto`                     | `auto` blocks read-only runs from writing into their roots where the platform can (macOS) and watches elsewhere; `require` refuses a read-only run it cannot block; `off` only watches |

> [!WARNING]
> **`AGY_SKIP_PERMISSIONS` is a real grant, and agy does not enforce read-only on top of it.** It
> defaults to `true` for compatibility with the historical headless workflow. In the
> repository's agy 1.2.x checks, permission-required reads and tools were denied without it.
> Current permission behavior also depends on CLI configuration; inspect denied actions
> rather than assuming every tool always needs this bypass. Those historical checks also
> found `--mode plan` advisory: it did not prevent file writes by itself.
>
> **So on macOS the bridge enforces it.** Every plan-mode run, cold or resident, runs agy under the
> kernel sandbox (`sandbox-exec`) with every write beneath `cwd` and each `dirs` root denied, for agy
> and for every process it starts. Verified against agy 1.2.2: its file-writing tool and its shell
> both fail with "Operation not permitted", while reads, git inspection and agy's own state under
> the home directory keep working. The response header says `read-only: enforced`. The sandbox is
> probed at startup; where it cannot run — Linux, or a bridge that is itself sandboxed — read-only
> runs are watched instead, the header says `read-only: watched, not enforced` with the reason, and
> `AGY_READ_ONLY_ENFORCEMENT=require` refuses them outright. `agy_status` reports which applies.
>
> The boundary is exactly the workspace roots. agy can still write anywhere else your user can, and
> a process it gets launched outside its own process tree — through `open`, an app, or a launchd
> job — is not sandboxed. That is why the watch stays on in both modes: the bridge fingerprints the
> working tree around every plan-mode run. A tree that moved despite enforcement is reported as
> `WORKING TREE CHANGED` (another writer, or an escape through such a process); a tree that moved
> without enforcement is reported as `READ-ONLY VIOLATION`. No warning means it looked and found
> nothing; a tree it could not fingerprint produces no claim in either direction. The fingerprint
> covers `cwd` and every directory the call hands agy. In
> a git repository it covers HEAD, the content and mode of every tracked change, the content of
> every untracked file, and the mode, size and mtime of every ignored entry, ignored directories
> walked the same way. A dependency or build tree at the repository top (`node_modules`, `.venv`,
> `venv`, `__pycache__`, `.next`, `dist`) counts as one entry — so a `.env` or `build/out.js` written
> in plan mode is seen, while a rewrite deep inside `node_modules` is not. Outside git it compares
> path, type, size, mode and mtime. Both are bounded to 20,000 entries and 10s. Measured on an Apple
> M5 Max: about 150 ms per snapshot on a clean 3,500-file repository, and about 1.1 s
> with 300 modified and 3,000 untracked files; two snapshots bracket each run.
> Anything else writing to the tree while the run is live (an editor, a watcher, a parallel write
> delegation) also moves it: the warning means the tree changed during the run, not proof of who
> changed it. A plan run whose tree moved and then failed carries the warning in its error. The
> header, not the tool's name and not the absence of a **denied-actions** note, is the signal to
> trust — denied actions only ever populate when the grant is off.
>
> A restriction that cannot be enforced fails the call: if the installed agy does not support
> `--mode` or `--sandbox`, a run needing either is refused rather than run with more authority than
> was asked for. `--sandbox` is in any case a terminal restriction, not a permission boundary.

> [!IMPORTANT]
> **`AGY_ALLOWED_ROOTS` validates inputs; it is not a sandbox.** It checks every call's `cwd`, `dirs`
> and `files` — including the workspace roots the bridge derives from them — before agy starts, so a
> caller cannot point a delegation outside the roots you nominate. It does **not** confine the run:
> under the permission grant agy has a shell and can reach anything the user running the bridge can.
> The read-only sandbox above only blocks writes into a read-only run's own roots, and a run allowed
> to write is not sandboxed at all. For real containment, run the bridge somewhere contained.

### Failure behavior

The bridge interprets the JSON envelope, process exit, current `finished_reason`, and structured `AGY_ERROR` diagnostics together. A print timeout returns an explicitly incomplete result when partial data is available; interrupted/error results never become clean success. Denied actions remain visible even with a success envelope. Diagnostic `retryable` describes the provider error and is not permission to replay an agent turn.

Tokens reported by failed cold or resident turns count toward the process budget. Missing usage is marked unknown rather than presented as a measured zero. With a configured token budget, unknown prior usage blocks further dispatch until the operator establishes a new budget period. The budget is checked before each actual dispatch, including queued fan-out legs. It cannot predict final usage, stop an already running request at an exact dollar amount, or cover other MCP processes. `agy_status` reports local usage, not an invoice.

`AGY_ON_FAILURE=strict` asks the calling agent to report the failed delegation instead of absorbing it silently. Invalid requests rejected before delegation, such as an invalid root or missing working directory, remain actionable caller errors.

## Known limitations

Deliberately not addressed, so they are not mistaken for oversights:

- **The delegation-depth counter is cooperative.** `AGY_MAX_DELEGATION_DEPTH` is
  propagated to the child through an environment variable, so a nested launcher that
  scrubs the environment resets it to zero. The failure mode is wasted quota through a
  delegation loop, not a privilege escape.
- **The run log is not redacted.** `AGY_REDACT` scrubs what returns to the caller; the
  temporary log agy writes for the quota poller can hold secrets in cleartext until the
  run ends. It lives in a per-process directory only your user can read, is removed on
  shutdown, and one left behind by a crash is removed the next time the bridge starts.
- **Inputs are bounded.** A prompt is passed to agy as one command-line argument, so a
  built prompt over 128 KiB (Linux's per-argument limit), or one containing a NUL byte,
  is refused before anything runs; pass file paths rather than inlining large content.
  `delegate_many` takes at most 8 tasks or 8 distinct models, and `tasks` cannot be
  combined with `models`.
- **`--disable-slash-commands` is best-effort.** Unlike `--mode plan` and `--sandbox`,
  it is dropped rather than refused when the installed agy does not advertise it, on
  the reasoning that a build without the flag most likely has no expansion to disable.
- **Read-only is enforced on macOS only.** Linux has no equivalent the bridge can apply without
  extra software, so there a read-only run is watched, not blocked. Set
  `AGY_READ_ONLY_ENFORCEMENT=require` to refuse such runs instead.
- **The macOS block is by path.** A file inside a root that already has a hard link outside
  every root can be rewritten through that outside link. Creating such a link during the run
  is blocked, and so is renaming any directory above a root to move the tree out from under
  its rule. The working-tree fingerprint still reports a change made through an old link.
- **A root that holds agy's state stays partly writable.** When a root contains `~/.gemini`,
  that directory is exempt so agy can still run; a write there is not blocked, and the
  fingerprint skips it. A root at or inside `~/.gemini` is watched, not enforced.
- **A fan-out sharing one `session_id` runs sequentially.** agy holds a
  per-conversation lock, so concurrent turns against one conversation would corrupt it.
  Fan out across conversations for parallelism.

## Development

```bash
npm install
npm test           # unit + fake-CLI process tests; no paid model calls
npm run typecheck
npm run build      # esbuild → dist/index.js
npm run check:release # package, lockfile and registry versions agree
npm run test:package  # empty production install, tarball, stdio and bundled skills
```

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) — conventional commits, prettier, and a test per behaviour change. Vulnerabilities go through [SECURITY.md](SECURITY.md), never a public issue.

## Contributors

<a href="https://github.com/PyModel/claude-agy-mcp/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=PyModel/claude-agy-mcp" alt="Contributors" />
</a>

## License

MIT
