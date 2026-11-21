# Gemini 4 routing, cost, and release decisions

Research checked **November 21, 2026**. Code baseline: [`29f5b5c8d5f4343d1cab33c774f8deda359e64a2`](https://github.com/PyModel/claude-agy-mcp/tree/29f5b5c8d5f4343d1cab33c774f8deda359e64a2). Implementation candidate: **3.2.0**, subject to review and release; no npm publication or live paid inference is implied.

## Decision

Support all models and effort variants actually listed by the account, including the four Gemini 4 families. Keep the existing automatic Flash policy until representative tasks establish a better default. Do not install separate family adapters: AGY already owns provider execution, and this bridge needs one consistent selection contract.

The supplied screenshot selects Carbon Medium in the Antigravity UI. It establishes a user-visible choice, not a universal entitlement or the MCP preference. The supplied CLI account snapshot contributes fourteen Gemini 4 variants and three Orchestrator identities to `test/gemini4-fixture.ts`. These are fixture data, not a hardcoded runtime allowlist. The supplied plan also referred to local dirty changes not present in the retrieved baseline; this implementation does not claim to have applied those unseen changes.

## 1. Model identity and entitlement

Separate these concepts:

| Concept              | Example                        | Contract                                                    |
| -------------------- | ------------------------------ | ----------------------------------------------------------- |
| Family policy        | `gemini-neon@latest`           | Bridge syntax; resolve before executing AGY                 |
| Fixed AGY variant    | `gemini-4-neon-medium`         | Canonical inventory identity, including effort              |
| Human label          | `Gemini 4 Neon (Medium)`       | Display and compatibility input; never assume unique        |
| Direct Gemini API ID | `gemini-4-neon`                | A different namespace; not automatically an AGY slug        |
| Composite model      | `gemini-pro-orchestrator-neon` | A listed planner/executor option, not two independent votes |
| Subscription         | Pro, Ultra, Enterprise         | Eligibility and quota; not a token-rate identifier          |

The [README availability table](../../README.md#models-and-plan-availability) records the current personal-plan matrix. The material distinction is Carbon's Ultra entitlement, with further trial restrictions on Pro. Enterprise and custom-provider inventories are separate. The router therefore asks `agy models`; plan names do not authorize a model missing from that inventory. [S1, S2]

Recognize `low`, `medium`, `high`, `xhigh`, and `max` vocabulary while verifying each family/variant. Neon and Hydrogen offer Extra/XHigh in current AGY documentation; Carbon and Argon do not thereby acquire that tier. Unknown labels remain selectable as exact listed identities. Orchestrator's parenthetical planner name must not become an effort. [S1, S3]

There are differences between current AGY defaults, launch announcements, and API defaults. Current AGY documentation describes Medium; the API thinking guide defaults Neon/Hydrogen to High and Carbon/Argon to Medium. Explicit variants avoid depending on that distinction. API context limits are also not AGY context limits: the API describes a unified 1,048,576-token window, while AGY's Neon page documents up to 512K. [S1, S4, S5]

## 2. Routing policy to evaluate

Google positions Hydrogen for routine implementation and workers, Neon for demanding interactive work, and Carbon for deeper asynchronous verification. Argon remains a distinct available choice; family names alone do not establish a cost ranking. [S6]

Recommended evaluation candidates are Hydrogen Medium for bounded work, Neon Medium for general delegation, Neon High/XHigh for difficult reasoning, and Carbon High or Argon High for explicit deep reviews. These are hypotheses for this repository. Do not rename the historical Flash benchmarks as Gemini 4 results, infer that every task benefits from maximum effort, or change every user's saved pin from one screenshot.

Selection precedence is per-call model, saved fixed preference, then the configured tool policy. Validate the source actually selected; an unrelated stale default must not block a valid explicit or saved choice. A missing selected pin produces an actionable error. Family selectors may choose a listed effort sibling; a fixed variant plus conflicting effort is rejected. The status, elicitation form, non-eliciting default path, persisted preference, and executed argv must agree.

Resolve each `delegate_many` mode independently. Explicit tasks do not require the default council. Validate all explicit council members before starting any; deduplicate canonical identities, not strings. Explain omitted default council members. Parallel workers should use isolated worktrees for writes. An AGY Orchestrator uses multiple models within one task and requires a separate evaluation from independent reviewers. [S7]

## 3. Billing and cost

Use the dated [README API comparison](../../README.md#pricing-and-cost) for exact reference rates and promotion deadlines. It includes Gemini 4, Flash, Sonnet, and Opus. It is deliberately separate from subscription fees and credits. [S8, S9, S10]

For illustration, a workload with **100,000 uncached input tokens and 10,000 billable output tokens**, excluding tools and storage, costs **$0.225 on Hydrogen, $0.45 on Neon, and $0.30 on Carbon/Argon** at the listed November rates. Carbon/Argon becomes **$0.60 on December 1**. These are calculations from the published rates, not observed AGY bills or equal-quality task comparisons. [S8]

A provider-aware estimator would use:

```text
estimated_usd = (uncached_input × input_rate
                + cache_reads × cache_rate
                + billable_output × output_rate) / 1,000,000
                + tools + cache_storage
```

Do not add AGY's `thinking_tokens` to `output_tokens` without a documented normalization contract. Its example reports a total equal to input plus output despite a separate thinking counter; that observation is insufficient to infer universal overlap semantics. Composite Orchestrator usage needs per-model attribution. The bridge exposes reported physical counters and unknown usage, and does not turn those into an invented invoice. [S2]

Optimize **cost per accepted completed task**: include unsuccessful attempts, repair turns, tool charges, cache effectiveness, and elapsed time. A cheap first pass followed by an expensive rerun can cost more than one successful stronger-model pass. This is an engineering evaluation criterion, not a claim of a measured saving.

## 4. Authentication, quotas, and concurrency

| Execution mode                   | Billing authority                                             | Operational consequence                                            |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| Personal Google-account sign-in  | Plan quota and enabled AI-credit overages                     | Observe the account's limits; do not infer a fixed token allowance |
| Gemini API key                   | API project                                                   | Configure the documented provider mode as well as the key          |
| Google Cloud pay as you go / ADC | Cloud project and region                                      | Apply Cloud pricing, quotas, and model availability                |
| Enterprise                       | License, administrator configuration, and applicable overages | Use the organization's actual inventory and policy                 |

The CLI authentication guide documents API-key mode; setting `GEMINI_API_KEY` alone does not switch an existing Google-account provider. The personal-plan documentation's BYOK restriction concerns topping up subscription limits. These are separate modes, not contradictory promises. [S11, S12, S13]

Pro/Ultra have five-hour quota refreshes and weekly limits. Some Gemini models share an account group, so selecting another Gemini family does not necessarily escape exhaustion. Purchased AI credits are not Google Flow credits or a fixed number of API tokens. Current API-key CLI usage/quota/credits commands may direct users to AI Studio rather than expose subscription balances. [S12, S14, S15]

Keep process concurrency modest and bounded; the existing default is two. A process-local token threshold is admission control based on reported usage. It is not a prepaid reservation, a cross-client global budget, or a hard dollar ceiling for in-flight calls. Exact quota-group coordination remains a future enhancement because this environment did not inspect the user's live provider/account state.

## 5. Retries and execution safety

AGY retries transient failures internally. The wrapper should not kill it on its first log 429 or stack an independent retry loop around an entire tool-using turn. API guidance about exponential backoff and jitter applies to retryable API requests; it does not prove that rerunning an agent with external side effects is safe. [S15, S16]

The implementation records terminal quota cooldowns for subsequent independent requests and invalidates discovery on an invalid model. It does **not** automatically replay a dispatched turn on quota, network, authentication, invalid-model, or uncertain warm-session failures. Only a warm-path failure known to occur before prompt delivery can fall back cold.

A clean local filesystem cannot prove absence of remote actions. Nor do zero reported tokens or zero tool turns necessarily establish that a provider accepted nothing. Preserve partial output, session identity, explicit completion state, denied actions, usage certainty, and structured error diagnostics. A deliberate follow-up can inspect and reconcile the previous turn before continuing.

CLI behavior is version sensitive. The dated changelog introduced `finished_reason` in 1.4.11, structured timeout exit behavior in 1.5.0, and current provider-mode changes in 1.5.11–1.5.12. The latest public release found during research was 1.5.12; the user supplied a 1.5.14 observation. Neither is a locally executed live-provider validation in this audit. Capability probes and explicit contract fixtures are preferable to an invented minimum-version guarantee. [S15]

## 6. MCP and distribution decisions

Keep the existing stdio architecture. Maintain canonical tool schemas, visible `isError`/incomplete outcomes, monotonic progress, and cancellation propagation to every owned child process. Scrub returned values and metadata through one response boundary. MCP protocol errors and tool execution errors are different surfaces; downstream agents must be able to distinguish them. [S17]

Update within MCP SDK v1 rather than combining this repair with a v2 migration. The current v1 patch line fixes known advisories while v2 is a separate compatibility project. The SDK promises v1 fixes for at least six months after its July 27, 2026 v2 release; review the migration before that minimum window reaches January 27, 2027. This is a planning date, not an announced v1 shutdown. The baseline npm audit listed thirteen affected dependency packages, including one critical transitive advisory; that scanner severity is not proof of a remotely exploitable critical vulnerability in this stdio server. The refreshed lockfile reports zero known vulnerabilities at verification time. [S18]

Test what will be distributed: package/lock/registry version agreement, compiled stdio handshake, isolated production dependency installation, tarball contents, installed skill execution, and supported minimum/current runtimes. The required GitHub check must always execute and fail when any required predecessor fails or is cancelled; a skipped aggregate is not a reliable protection. [S19]

## 7. Applied work and remaining release gates

| Stage                   | Outcome / acceptance                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Inventory and selection | Canonical IDs, Gemini 4 fixture, effort capability checks, pin/default parity, cache refresh and invalidation                        |
| Execution and output    | No blind replay; modern terminal metadata; restriction parity; child cleanup; bounded raw output; response redaction                 |
| Fan-out and accounting  | Mode-specific validation, alias deduplication, failed usage accounting, dispatch-time budget checks                                  |
| Shared state and relay  | Concurrent cooldown preservation; conservative read-only observations; isolated report directories; transactional skill installation |
| Distribution            | Compatible dependency updates, aligned 3.2.0 metadata, production install repair, package and required-status gates                  |
| Live evaluation         | **Pending**: approved account-specific canary and comparative workload measurements before changing automatic defaults or publishing |

For the live evaluation, run discovery and record the provider/account class, exact CLI version, model ID, effort, context size, task acceptance criteria, latency, reported/unknown usage, and credits or API billing source. Compare several representative read/search tasks, multi-file changes, and adversarial reviews with deterministic acceptance checks. Begin with serial isolated tasks; include cancellation, denied permissions, partial timeouts, and unavailable-model cases. Do not claim a speedup or savings until this evidence exists.

The [audit report](../audits/2026-11-21/report.md) separately records confirmed defects, conditional risks, code evidence, commands, and coverage gaps. No source review can establish that every possible bug has been found.

## Sources

All accessed November 21, 2026. Living documentation may change; subscription and API scope are deliberately kept separate.

| Key | Primary source                                                                                                                                                                                 | Applies to                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| S1  | [Antigravity models](https://antigravity.google/docs/models)                                                                                                                                   | Personal-plan eligibility, trials, AGY context and model tiers |
| S2  | [AGY headless mode](https://antigravity.google/docs/cli/headless/)                                                                                                                             | Inventory examples, JSON/NDJSON, usage and stream contract     |
| S3  | [AGY effort command](https://antigravity.google/docs/cli/commands/effort/)                                                                                                                     | Vocabulary and per-model support                               |
| S4  | [Gemini API thinking](https://aistudio.google.com/docs/thinking)                                                                                                                               | API thinking defaults and controls                             |
| S5  | [Gemini 4 Neon API model](https://aistudio.google.com/docs/models/gemini-4-neon)                                                                                                               | API identity and context limits                                |
| S6  | [Choosing a Gemini model](https://aistudio.google.com/docs/choosing-a-model)                                                                                                                   | Workload and effort recommendations                            |
| S7  | [Hydrogen and Orchestrator announcement](https://antigravity.google/blog/gemini-4-hydrogen-in-google-antigravity/)                                                                             | Planner/executor pattern                                       |
| S8  | [Gemini Developer API pricing](https://aistudio.google.com/docs/pricing)                                                                                                                       | API rates and dated promotions                                 |
| S9  | [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)                                                                                                                 | Direct Claude reference rates                                  |
| S10 | [Google subscriptions, USD](https://gemini.google/subscriptions/?currencyCode=USD)                                                                                                             | US personal-plan reference prices                              |
| S11 | [AGY authentication](https://antigravity.google/docs/install?tab=cli)                                                                                                                          | Provider/authentication modes                                  |
| S12 | [Antigravity plans](https://antigravity.google/docs/plans/)                                                                                                                                    | Subscription quotas and overages                               |
| S13 | [AGY Cloud pay as you go](https://antigravity.google/docs/pay-as-you-go/)                                                                                                                      | Separate Cloud billing path                                    |
| S14 | [AGY usage](https://antigravity.google/docs/cli/commands/usage/) and [credits](https://antigravity.google/docs/cli/credits/)                                                                   | Account-group limits and credit scope                          |
| S15 | [AGY changelog](https://antigravity.google/docs/changelog)                                                                                                                                     | Versioned error, timeout, retry and provider changes           |
| S16 | [Gemini API troubleshooting](https://aistudio.google.com/docs/troubleshooting)                                                                                                                 | API-level retry guidance, not whole-agent replay permission    |
| S17 | [MCP tool specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)                                                                                                | Tool error and structured result contracts                     |
| S18 | [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [security advisories](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories)             | SDK release lines and security fixes                           |
| S19 | [GitHub required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/troubleshooting-required-status-checks) | Skipped checks and dependency aggregation                      |
