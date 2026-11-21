# Codebase audit: https://github.com/PyModel/claude-agy-mcp.git

**Snapshot:** All finding locations and baseline repros refer to clean commit 29f5b5c8d5f4343d1cab33c774f8deda359e64a2. Applied candidate: branch fix/gemini4-routing-and-reliability, version 3.2.0, uncommitted working tree fingerprint 713bd439ecb142417c0e59714158715454aef8231048074abd8485af9796b1b5; see evidence/candidate-snapshot.json. This is not a deployed or published artifact identity. Accepted source-fix implementation is completed; final Linux integration, typecheck/release checks and rebuilt Node 18/24 package smoke passed. Remaining partial completion concerns platform CI and live-provider evaluation.

**Review:** full / partial

**Completed:** 2026-11-21T22:19:10.138933+00:00

## Scope and evidence boundary

**Included:** All accessible tracked source, tests, local state, bundled relay/installer, CI, Docker, package/registry metadata and documentation.; Official current model/effort/CLI/MCP/dependency/pricing guidance as recorded by the research ledger.; Source and local fake-provider execution; implemented candidate assessed by focused and full Linux integration tests.

**Excluded:** New docs/audits/2026-11-21 report directory excluded from the inspected source snapshot.; node\_modules and generated bundles not copied into report; dependency risk reviewed through lockfile/advisories and installed-artifact tests.; No credentials, private account payloads or authenticated remote inference were collected.

- Full-source scope with partial completion: live-provider/account evaluation and macOS runtime/actual Docker CI remain pending. No claim that all bugs were found or that static review certifies production readiness.
- Baseline checkout was clean. The uploaded plan referred to earlier dirty changes absent here; findings are reconciled against the actual baseline rather than that unseen draft.
- Inventory observed 97 candidate paths and 95 files at collection time; metadata enumeration is not correctness coverage, and the candidate changed during the repair.
- The personal local stdio trust model limits some advisory exposure. AGY authentication, billing, external tool effects and hosted branch rules are not established by source alone.
- No live billing/latency comparison was run. Token admission uses reported usage, may overshoot with already in-flight work, and is not a hard spend authorization cap.
- Shape-based redaction does not identify every possible secret; path admission and watched fingerprints are not general read/network isolation.
- started\_at records the earliest preserved reproduction evidence, not an inferred earlier conversation start.

## Counts

Verified defects: **20**; substantiated risks: **3**; hypotheses: **1**; substantiated improvements: **0**.

Severity counts below include verified defects only.

| Critical | High | Medium | Low | Info |
| -------: | ---: | -----: | --: | ---: |
|        0 |    1 |     18 |   1 |    0 |

Completed coverage does not establish that no defects remain.

## Remediation and verification order

### A1 · P1

Review and land the candidate execution, redaction, selection and state repairs with the baseline evidence retained. Changes are implemented; no release publication is implied.

**Finding references:** AUD-001, AUD-002, AUD-003, AUD-004, AUD-005, AUD-006, AUD-007, AUD-008, AUD-009, AUD-010, AUD-011, AUD-012, AUD-013, AUD-014, AUD-015, AUD-016, AUD-017, AUD-018, AUD-019, AUD-020, AUD-021, AUD-022, AUD-023

**Prerequisites:** None declared

**Acceptance:** Final Linux suite, typecheck and release metadata checks pass; no provider calls or blind replay are introduced.

### A2 · P1

Retain the successful current rebuilt-tarball evidence and finish hosted CI gates before release, including Docker and macOS confinement/cleanup cases.

**Finding references:** AUD-008, AUD-009, AUD-011, AUD-017, AUD-018, AUD-019, AUD-020, AUD-021

**Prerequisites:** A1

**Acceptance:** Current artifact package smoke and all required CI predecessors succeed; aggregate fails for any failed/cancelled required job.

### A3 · P2

Run an approved account-specific live canary in a disposable credential-appropriate workspace; inspect actual inventory, resumed history, terminal failures and billing source.

**Finding references:** AUD-006, AUD-010, AUD-011, AUD-023

**Prerequisites:** A2

**Acceptance:** Record exact AGY version, account class, canonical variant, effort, session behavior, usage-known status and cancellation outcome without leaking secrets.

### A4 · P3

Evaluate per-tool Gemini 4 default candidates against the unchanged Flash baseline under a separately approved budget.

**Finding references:** AUD-024

**Prerequisites:** A3

**Acceptance:** Frozen task assertions, comparable inputs/efforts, measured success, median/p95 latency, tokens/credits and failures justify any promotion; otherwise preserve defaults.

## Verified defects

### AUD-001 — Redaction misses fan-out errors and response metadata

**Kind:** defect · **Category:** security · **Severity:** high · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** Every response path must honor configured redaction, including errors, metadata, JSON keys and progress.

**Evidence:**

- src/delegation.ts:817–832 (runMany): Raw exception messages become successful fan-out return values.
- src/server.ts:239–242 (renderFanout): Per-leg errors bypass the single-error scrub at lines 414–419.
- src/server.ts:60–73 (deniedNote): Child-controlled denial names enter metadata.

**Preconditions:**

- Redaction enabled; a provider diagnostic, denial field or structured key contains a credential-shaped value.

**Failure / benefit mechanism:**

- A failing leg returns its raw diagnostic.
- Fan-out or metadata rendering bypasses the single-error redactor.
- The client receives the sensitive value.

**Controls and counterevidence checked:**

- Single successful output and single thrown errors were scrubbed, but those paths do not cover returned leg failures, metadata or JSON keys.

**Impact:** Synthetic credentials escaped in text and structured output; real sensitive diagnostics could cross the configured egress boundary. Scope is a local stdio client, not an unauthenticated network service.

**Verification:** Baseline core harness observed all three metadata/error leak cases; candidate tests cover full serialized responses. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-REPRO, C-CORE-FIX

**Recommendation:** Scrub the complete response and progress boundary, including keys with collision preservation; redact before truncation.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Serialize partial/all-failed fan-out and structured/denied/progress cases; no synthetic marker survives, and colliding keys preserve every value.

**Independent review:** revised; Execution specialist and coordinator, separate from core implementer; Accepted the code paths and synthetic reproductions. Severity assumes sensitive child diagnostics or effectful delegation; no real credential incident or remote corruption was tested.

**Source references:** Local source evidence

**Coverage references:** CV-CORE

### AUD-004 — Council selection loses explicit intent and pre-dispatch validation

**Kind:** defect · **Category:** contract · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P1

**Invariant:** Fan-out must execute only the selected mode and validated distinct members, preserving caller versus automatic origin.

**Evidence:**

- src/server.ts:219–227 (fanoutLegs): Singular model is ignored and default council selected.
- src/delegation.ts:813–827 (runMany): Any singular model authorizes the gate; legs are dispatched independently with no canonical-member prevalidation.
- src/delegation.ts:679–685 (attempt): Every leg-supplied model is treated as caller pinned.
- src/models.ts:218–229 (resolveChain): Unavailable inventory allows explicit strings through unchanged.

**Preconditions:**

- Prompt fan-out uses singular model, alias duplicates, a later unavailable member, automatic cooldowns, or unavailable discovery.

**Failure / benefit mechanism:**

- Request mode or origin is lost during leg construction.
- Independent legs validate while others can already dispatch.
- Automatic selectors bypass cooldown or pass unvalidated to AGY; explicit caller intent can select different models.

**Controls and counterevidence checked:**

- The schema rejects duplicate strings and task+models, but not alias duplicates or model+models. Baseline already chooses tasks before council; the uploaded draft eager-lookup claim is not attributed to this source.

**Impact:** Unintended paid legs, duplicate votes, avoidable quota attempts, or rejected bridge-only selectors.

**Verification:** Complete baseline call path verified; candidate integrated regressions cover each contract. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-FIX

**Recommendation:** Choose mode first; preserve origin; validate and deduplicate canonical IDs before any member dispatch; require readable council inventory.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Singular model makes one leg; invalid/duplicate explicit council yields zero spawns; automatic cooldown honored; unreadable council refuses once.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-CORE, CV-MODELS, CV-STATE

### AUD-005 — Failed attempts bypass accounting and later budget admission

**Kind:** defect · **Category:** correctness · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** Admission must account for all observed failed work and must never equate missing usage with measured zero.

**Evidence:**

- src/delegation.ts:455–461 (run): Budget is checked per admitted logical call.
- src/delegation.ts:625–658 (attempt): Only successful warm envelopes are recorded; timeout is emitted as zero usage.
- src/delegation.ts:763–776 (runOnce): A second dispatch follows failed spend without another budget check.

**Preconditions:**

- Budget is configured; a failed first attempt spends tokens or a warm result reports usage before failing.

**Failure / benefit mechanism:**

- The logical request passes admission.
- Failure spends tokens; warm error usage is omitted or retry spend is recorded only after admission.
- Another attempt dispatches or unknown usage looks free.

**Controls and counterevidence checked:**

- Concurrency admission already rechecks queued logical calls. This does not control secondary attempts, failed warm results or missing usage; no hard in-flight spending cap is claimed.

**Impact:** Reproduction spent 115 tokens under a 50-token admission limit; a 100-token warm failure was reported as only the 15-token cold retry.

**Verification:** Core harness contains networkBudget, quotaBudget and warmFailureAccounting observations. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-REPRO, C-CORE-FIX

**Recommendation:** Record all returned usage once, mark missing counters unknown, check immediately before each dispatch, and stop budgeted work when remaining spend is unknowable.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Known failed spend blocks the next admission; uncertain outcomes increment unknownRuns and block a configured budget without claiming measured zero.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-STATE

### AUD-006 — Model identity and effort handling can change a fixed choice

**Kind:** defect · **Category:** contract · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** The executable model identity and effort must match the caller’s selected listed variant.

**Evidence:**

- src/models.ts:35–56 (describeModel): Any final parentheses become effort, including an opaque planner name.
- src/models.ts:80–116 (resolveEntry): Selectors omit XHigh/Max and tie by listing order; results use labels.
- src/models.ts:133–147 (pickTier): Missing requested sibling silently keeps original model.
- src/delegation.ts:503–525 (routeFor): Effort-only follow-up is lost; saved effort can re-tier an explicit different model.

**Preconditions:**

- Current Gemini 4 inventory includes XHigh or opaque Orchestrators; caller selects a fixed ID or an unavailable effort.

**Failure / benefit mechanism:**

- Discovery parses model labels as capabilities.
- Selection inherits or accepts an unsupported effort.
- Executed variant differs from the requested or reported choice.

**Controls and counterevidence checked:**

- Live discovery exists and supports older selectors; the issue is interpretation and inconsistent identity, not lack of provider adapters.

**Impact:** Wrong tier/model, rejected supported calls, and misleading persisted or displayed effort.

**Verification:** Baseline routing harness observed unsupported XHigh, lost follow-up effort, Argon High saved as Low, and Neon Low executed as High. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-ROUTING-REPRO, C-CORE-FIX

**Recommendation:** Use canonical IDs, explicit fixed-choice conflicts, listed family siblings, shared effort vocabulary and deterministic selectors; preserve opaque rows.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Strict fake CLI accepts all 14 variants and three Orchestrators; XHigh only when listed; unsupported Max fails; fixed IDs remain fixed; effort-only follow-up refuses.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S1, S2, S3

**Coverage references:** CV-MODELS

### AUD-008 — Warm launches omit request options and fail-open restricting flags

**Kind:** defect · **Category:** security · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** Equivalent warm and cold requests must receive the same effective options and required restrictions.

**Evidence:**

- src/delegation.ts:614–624 (attempt warm options): Additional roots and slash-command policy are not forwarded.
- src/warm.ts:318–337 (start): Warm argv uses global sandbox and conditionally omits required restricting flags.
- src/runner.ts:365–383 (permissionArgs): Cold path rejects missing required flags.

**Preconditions:**

- Warm sessions are enabled; requested roots/options differ or a streaming-capable CLI lacks requested --mode/--sandbox.

**Failure / benefit mechanism:**

- Follow-up qualifies for warm execution.
- Resident launch does not receive the same effective policy as cold execution.
- Warm call succeeds with different roots, expansion or restrictions.

**Controls and counterevidence checked:**

- Warm already compares cwd and confinement roots; it does not compare every launch option. Public schemas do not expose every internal sandbox override, so the finding is limited to reachable configuration/options.

**Impact:** Meaningful cold/warm behavior mismatch and potential execution with less restriction than configured.

**Verification:** Execution harness observed warm roots \[/repo\] versus cold \[/repo,/extra\], slash commands disabled, and missing sandbox accepted warm but refused cold. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-EXEC-REPRO, C-EXEC-FIX

**Recommendation:** Share effective permission/option requirements and include policy in reuse identity; fail closed for missing required flags.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Cold/warm option parity; zero delivery to incompatible or under-restricted residents; useful pre-dispatch errors.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-EXEC

### AUD-009 — Cleanup can lose ownership of still-running descendants

**Kind:** defect · **Category:** resilience · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** The bridge or relay must retain ownership of all spawned work until it is reaped or forcibly stopped.

**Evidence:**

- src/runner.ts:185–202 (spawnDetached.wait): Leader/pipe timeout resolves before the whole process group is gone.
- src/runner.ts:529–535 (killChild): Escalation can be cancelled on leader completion.
- src/warm.ts:438–478 (drop/shutdown): Dropped residents leave the registry, while shutdown clears their pending escalation.
- skills/agy-delegate/scripts/relay.mjs:697–730 (abort handler): Abort settles and cancels timers without equivalent descendant reap.

**Preconditions:**

- A detached AGY child or descendant ignores SIGTERM, especially during cancel/timeout immediately followed by shutdown.

**Failure / benefit mechanism:**

- Leader or resident is removed from active ownership.
- Cleanup cancels escalation or exits.
- A descendant continues after the bridge/relay reports termination.

**Controls and counterevidence checked:**

- Process groups and escalation already exist; their lifecycle is incomplete. Safe repros used disposable fake children and explicitly reaped survivors.

**Impact:** Orphaned work can keep consuming tokens or touching the workspace after cancellation.

**Verification:** Execution and relay harnesses observed surviving children; cold grandchild remained alive after 5638 ms. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-EXEC-REPRO, C-RELAY-REPRO, C-EXEC-FIX

**Recommendation:** Track active and terminating ownership until confirmed exit or hard group cleanup; do not equate leader exit with descendant completion.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Real fake descendant survives SIGTERM but is gone after cancellation; warm drop then shutdown sends SIGKILL; relay abort leaves no owned child.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-EXEC, CV-RELAY

### AUD-017 — Production dependency installation requires an omitted development tool

**Kind:** defect · **Category:** configuration · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** Production installation must not require development-only packages omitted by that installation.

**Evidence:**

- package.json:25–29 (scripts.prepare): Unconditional prepare invokes husky.
- Dockerfile:11–16 (production stage): npm ci --omit=dev runs prepare without Husky installed.

**Preconditions:**

- A production-only install is performed, including the documented Docker runtime stage.

**Failure / benefit mechanism:**

- npm omits development dependencies.
- Root prepare still invokes husky.
- Install exits 127 before producing a usable runtime layer.

**Controls and counterevidence checked:**

- Development npm ci succeeds because Husky is present; that does not validate production-only installation.

**Impact:** Supported deployment/installation path fails deterministically.

**Verification:** Baseline production npm ci exited 127: husky not found. Candidate package smoke covers production shape. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-PROD-BASE, C-PACK-18, C-PACK-24

**Recommendation:** Skip the development-only hook in production and use reviewed lifecycle handling in Docker; smoke-test clean production install.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- npm ci --omit=dev succeeds in an empty environment without Husky; packed stdio server starts and calls fake AGY on supported Node versions.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-DELIVERY

### AUD-019 — Release manifests describe incompatible package versions

**Kind:** defect · **Category:** configuration · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P1

**Invariant:** Every distribution surface must identify the same tested release artifact.

**Evidence:**

- package.json:1–4 (version): Package advertises 3.1.0.
- package-lock.json:1–10 (root versions): Lock root/package advertise 3.0.4.
- server.json:9–14 (registry package versions): MCP manifest directs users to 2.0.0.

**Preconditions:**

- A consumer installs using the MCP registry manifest or release tooling reads these independent version fields.

**Failure / benefit mechanism:**

- Package, lock and registry identify different versions.
- Registry-selected artifact differs from the current source-tested package.
- Users can receive older behavior while reading newer release claims.

**Controls and counterevidence checked:**

- Server handshake reads package.json, so handshake itself is not independently hardcoded; other manifests still diverge.

**Impact:** Distribution identity is inconsistent; source test success does not prove the advertised installed artifact.

**Verification:** Baseline exact version fields re-read; candidate check:release and package smoke pass. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-TYPE-FINAL, C-PACK-18, C-PACK-24

**Recommendation:** Align one candidate version and add a consistency gate plus packed-artifact handshake tests.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Package, lock roots, MCP package and handshake all report 3.2.0; clean tarball install exercises the actual built entry.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-DELIVERY

### AUD-023 — Intermediate quota logs prematurely terminate native AGY retry recovery

**Kind:** defect · **Category:** resilience · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P1

**Invariant:** An intermediate retryable provider log must not override a later successful native agent result.

**Evidence:**

- src/runner.ts:572–589 (quota poller): Any appended quota-looking log immediately kills the child.
- src/runner.ts:654–660 (terminal quota check): Historical log signal is treated as quota regardless of later success.

**Preconditions:**

- Current AGY internally retries a transient 429/capacity error and can later complete the same agent turn.

**Failure / benefit mechanism:**

- An intermediate quota-looking log appears.
- Bridge kills AGY before its native recovery completes, or treats historical log as terminal.
- A recoverable turn becomes failed and may enter unsafe wrapper replay in the baseline.

**Controls and counterevidence checked:**

- Log quota detection supports older CLIs, but a log line alone cannot distinguish transient intermediate capacity from terminal model exhaustion.

**Impact:** Unnecessary failure and lost native continuity. This is distinct from duplicate whole-turn execution, tracked in AUD-002.

**Verification:** Baseline poller explicitly terminates on any match; current changelog documents native transient retries preserving tool output. Candidate runner tests cover success after a 429 log. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-EXEC-FIX, C-ALL-FINAL

**Recommendation:** Let AGY own transient recovery; classify terminal envelope/status/exit first; use logs only as compatible terminal evidence and record cooldown for later work.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- A success envelope following a transient 429 succeeds once; terminal exhausted result fails once and records cooldown.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S15

**Coverage references:** CV-EXEC

### AUD-003 — Task fan-out constructs arguments rejected by its own schema

**Kind:** defect · **Category:** correctness · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P2

**Invariant:** Each valid task-list leg must satisfy the same single-prompt schema that dispatch validates.

**Evidence:**

- src/delegation.ts:820–827 (runMany): Per-task prompt is added while original tasks remain.
- src/tools.ts:342–347 (delegate\_many.schema): The schema requires exactly one of prompt or tasks.

**Preconditions:**

- A valid delegate\_many call supplies tasks.

**Failure / benefit mechanism:**

- The server creates task legs.
- Each leg retains tasks and adds prompt.
- Prompt building rejects both fields before the CLI starts.

**Controls and counterevidence checked:**

- The top-level request is valid; validation on every leg is correct, but leg construction violates it.

**Impact:** The advertised task-list mode returns only errors and performs zero work.

**Verification:** Baseline taskFanout: zero spawns and exclusive-shape error. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-REPRO, C-CORE-FIX

**Recommendation:** Remove fan-out-only fields when creating a per-task request.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Two explicit tasks dispatch twice with one prompt per leg, including a custom-only inventory.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-CORE

### AUD-007 — Saved choices and the default form do not express the same selection

**Kind:** defect · **Category:** contract · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** Persisted intent, displayed defaults and the executed variant must agree across eliciting and non-eliciting clients.

**Evidence:**

- src/delegation.ts:296–304 (defaultChoice): Unresolvable default becomes null.
- src/delegation.ts:337–345 (setPreference): Requested effort is saved separately from the actually selected tier.
- src/delegation.ts:505–525 (routeFor): Stale saved model can drop from the chain while its effort influences the replacement.
- src/server.ts:270–273 (askUserForModel): Form invents High when no proposed effort exists.

**Preconditions:**

- A saved model disappears, a saved effort disagrees with inventory, or a client accepts a default with no explicit effort.

**Failure / benefit mechanism:**

- Form and setter independently construct choices.
- A stale choice is placed in a filtering chain or High is invented.
- Execution, saved settings and displayed default diverge.

**Controls and counterevidence checked:**

- Preferences are persisted atomically and unreadable discovery prevents a new save, but these controls do not verify a previously chosen pin or unify the form default.

**Impact:** A durable user pin can be replaced implicitly; different clients accepting the same default can save different choices.

**Verification:** Baseline source path verified; candidate parity, legacy pin and stale/default tests pass. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-FIX

**Recommendation:** One exact default acceptance operation; retain and fail missing chosen pins; store actual canonical variant/effort; validate only the selected source.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Bare setter and elicitation persist identical defaults; vanished pin remains unchanged and errors; unrelated absent fallback does not block a valid choice.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-MODELS

### AUD-011 — Modern terminal results lose incomplete output and recovery context

**Kind:** defect · **Category:** contract · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P2

**Invariant:** An incomplete terminal result must preserve recoverable output/context without being reported as successful completion.

**Evidence:**

- src/envelope.ts:25–39 (AgyEnvelope): No finished\_reason field.
- src/envelope.ts:77–90 (shape): Terminal reason is discarded.
- src/runner.ts:649–689 (runAgy terminal result): CLI-origin timeout becomes a generic thrown failure.
- src/failure.ts:78–107 (classifyRun): Old status/error assumptions omit modern terminal metadata.

**Preconditions:**

- AGY emits finished\_reason=print\_timeout or interruption with partial response/session and terminal exit/error metadata.

**Failure / benefit mechanism:**

- Parser drops the finish reason.
- Failure classification throws instead of returning an explicit incomplete result.
- Caller loses useful partial text and conversation recovery details.

**Controls and counterevidence checked:**

- Bridge-origin timeouts already return partial output; this does not cover CLI-origin deadlines or newer AGY\_ERROR details.

**Impact:** Failed or timed-out work is harder to assess or resume and can be mistaken for a generic failure with no useful result.

**Verification:** Execution fixture reproduced partialPreserved=false, sessionPreserved=false and finishedReasonParsed=null. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-EXEC-REPRO, C-EXEC-FIX, C-CORE-FIX

**Recommendation:** Parse and preserve terminal reason, structured diagnostics, usage-known state, partial/structured output and session; keep incomplete status explicit.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Official-contract fixture with ERROR, exit3 and print\_timeout retains partial/session, usage and incomplete status; interruption does not become success.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S2, S15

**Coverage references:** CV-EXEC, CV-CORE

### AUD-012 — Unreadable workspace coverage can be reported as a complete snapshot

**Kind:** defect · **Category:** correctness · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** A fingerprint must not claim complete coverage when files or directories could not be observed.

**Evidence:**

- src/worktree.ts:139–145 (walk): Unreadable directory returns the same sentinel as complete coverage.
- src/worktree.ts:115–125 (hashMeta): Missing/inaccessible metadata is not distinguished robustly.
- src/delegation.ts:463–468 (mayRepeat): Unknown or incomplete coverage is unsafe evidence for replay.

**Preconditions:**

- A workspace root/subdirectory is unreadable, a scan budget is exhausted, or coverage is otherwise incomplete.

**Failure / benefit mechanism:**

- Fingerprinting omits a path.
- Completion state does not accurately represent missing coverage.
- Read-only/replay decisions can infer more than was observed.

**Controls and counterevidence checked:**

- Bounds and three-valued comparison already exist. The unreadable-directory branch fails to propagate the unknown state; filesystem observation never proves no remote effects.

**Impact:** False confidence that no write occurred; this also amplified replay risk, counted separately by its execution invariant.

**Verification:** Baseline error-return branch is static proof; candidate execution/worktree tests exercise inaccessible roots and watched coverage. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-EXEC-FIX

**Recommendation:** Propagate incomplete reasons, content-hash bounded relevant coverage and retain unknown instead of false-clean; never use local clean state to authorize whole-turn replay.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Inaccessible roots/subtrees and budget exhaustion yield unknown; ignored/nested changes are detected within stated coverage; require mode refuses unverifiable guarantees.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-FS

### AUD-013 — Raw relay read-only reports miss reachable workspace edits

**Kind:** defect · **Category:** correctness · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P2

**Invariant:** A read-only verdict must reflect every declared workspace root within explicit observation limits.

**Evidence:**

- skills/agy-delegate/scripts/relay.mjs:427–468 (gitWorktreeFingerprint): Coverage relies on cwd status/path metadata and omits ignored/extra-root cases.
- skills/agy-delegate/scripts/relay.mjs:761–769 (relay final fingerprint): Only opts.cd is fingerprinted.

**Preconditions:**

- Read-only relay uses an extra root, ignored file or nested cwd with an already dirty tracked file.

**Failure / benefit mechanism:**

- Fake AGY writes a permitted input root.
- Relay fingerprint does not cover the changed content.
- Result claims readOnlyViolation=false and completed.

**Controls and counterevidence checked:**

- The baseline uses three-valued verdicts, but missing coverage is incorrectly treated as complete. Raw plan mode is advisory; no OS write-enforcement claim is supported.

**Impact:** A watched-only relay can falsely report clean completion after a real workspace write.

**Verification:** Relay harness reproduced extra-root, ignored-file and nested-cwd writes with false violation flags. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-RELAY-REPRO, C-ALL-FINAL

**Recommendation:** Watch every configured/repository-expanded root with bounded content coverage; unknown remains unknown; violation cannot be clean completion; document raw relay separately.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- All three baseline missed-write cases become detected violations/incomplete results; scan caps produce unknown, never a clean guarantee.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-RELAY

### AUD-014 — Reused relay report directories expose another run’s completion

**Kind:** defect · **Category:** data-integrity · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P2

**Invariant:** Each relay report and final-text path must unambiguously belong to the current run.

**Evidence:**

- skills/agy-delegate/scripts/relay.mjs:509–525 (prepareRunDir): Only brief and stderr are reset when an output directory is reused.
- skills/agy-delegate/scripts/relay.mjs:756–760 (completion write): Empty final output leaves old final.txt intact.

**Preconditions:**

- Two jobs reuse an explicit report directory and the second is running or produces no final text.

**Failure / benefit mechanism:**

- Old result.json/final.txt remain.
- The new run starts without an exclusive claim/reset.
- Poller sees old success or a new result pointing to old text.

**Controls and counterevidence checked:**

- Result JSON uses atomic rename, which prevents torn writes but does not establish run ownership or remove previous artifacts.

**Impact:** An orchestrator can attribute stale output to the wrong job or finish polling prematurely.

**Verification:** Baseline harness observed old completion during the new job and finalPath referencing previous text after failure. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-RELAY-REPRO, C-ALL-FINAL

**Recommendation:** Require an exclusive/new run directory or acquire a durable run claim; make results identify the current run and always reset final output.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Concurrent/reused nonempty report directory is refused or isolated; current run never exposes previous completion/text.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-RELAY

### AUD-015 — Skill replacement removes the working installation before copying succeeds

**Kind:** defect · **Category:** data-integrity · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** A failed skill replacement must preserve the prior working installation.

**Evidence:**

- scripts/install-skills.mjs:77–85 (install): Existing destination is recursively removed before the replacement is copied.

**Preconditions:**

- Existing installed skill is replaced and copying fails due to an unreadable source, I/O failure or interruption.

**Failure / benefit mechanism:**

- Installer removes the old directory.
- Replacement copy fails or partially completes.
- Error is reported but the working installation has already been lost.

**Controls and counterevidence checked:**

- Symlink targets are skipped unless --force, but ordinary installed directories are still removed first. Top-level failure handling does not roll back.

**Impact:** Local user skill edits or a working skill installation may be lost; replacement failure is not transactional.

**Verification:** Baseline ordering proves the failure window. Candidate installer fault-injection acceptance is in the integrated test suite; baseline live data loss was not induced. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-ALL-FINAL

**Recommendation:** Stage a full copy, preserve/rename the old destination, swap atomically where possible and roll back on failure; define collision behavior.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Injected staging/copy failure leaves prior skill bytes unchanged; successful replacement leaves no partial files; symlink policy preserved.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-RELAY

### AUD-016 — Cross-process cooldown updates can lose another writer’s entry

**Kind:** defect · **Category:** resilience · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** Concurrent cooldown writers must preserve every active entry and the maximum same-model expiry.

**Evidence:**

- src/cooldown-store.ts:77–83 (save): Read/merge/rename then verify is not one serialized transaction.
- src/cooldown-store.ts:88–93 (write): Whole-file atomic replace protects readers but not concurrent writers.

**Preconditions:**

- Two bridge processes write different model cooldowns from the same old snapshot.

**Failure / benefit mechanism:**

- Both read the old state.
- Writer A saves and verifies its own entry.
- Writer B later renames its snapshot and verifies, removing A’s entry.

**Controls and counterevidence checked:**

- Three bounded verification passes handle some interleavings but not this valid schedule; sequential tests cannot establish concurrent preservation.

**Impact:** A fresh client can forget a valid cooldown and spend another failed attempt discovering known quota exhaustion.

**Verification:** Interleaving is statically complete; candidate deterministic multi-process regression passes. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-ALL-FINAL

**Recommendation:** Use independent immutable model/expiry records with maximum-expiry reads, or serialize the full read/merge/write operation.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Overlapping independent writers preserve both models and the maximum same-model expiry for a fresh reader.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-STATE

### AUD-018 — The required aggregate CI job can be skipped instead of failing

**Kind:** defect · **Category:** testing · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** The required CI aggregate must explicitly fail when a required predecessor fails or is cancelled.

**Evidence:**

- .github/workflows/ci.yml:23–29 (test aggregate): needs:suite plus default success condition skips the aggregator after predecessor failure.

**Preconditions:**

- The aggregate test status is required as the workflow comment states, and a matrix predecessor fails or is cancelled.

**Failure / benefit mechanism:**

- Matrix job fails.
- Aggregate job does not execute due to dependency success semantics.
- Branch protection sees a skipped aggregate rather than an explicit failed required conclusion.

**Controls and counterevidence checked:**

- Matrix tests still fail visibly, but a required aggregate must not rely on that visibility alone; commitlint was not included in its required dependencies.

**Impact:** Required-status enforcement can be weaker than the project’s stated gate. Actual hosted rules were not independently inspected.

**Verification:** Baseline YAML plus GitHub documented skip semantics establish the configuration defect conditional on the stated required check. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** None; see verification classification

**Recommendation:** Always run the aggregate and explicitly require success for each relevant predecessor, including package and commitlint.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Workflow graph includes required jobs; failure/cancellation propagates to failed aggregate; push versus PR skip rules are explicit.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S19

**Coverage references:** CV-DELIVERY

### AUD-021 — Raw stream and log accumulation are not bounded by final output limits

**Kind:** defect · **Category:** performance · **Severity:** medium · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** Every raw-output accumulator needs a defined bound and an explicit incomplete outcome on overflow.

**Evidence:**

- src/runner.ts:546–562 (drainProgress): streamedText grows independently of the stdout tail.
- src/logtail.ts:37–44 (append): One read allocates the entire appended file delta and grows carry.
- src/warm.ts:383–411 (consume): NDJSON carry and accumulated partial text lack explicit bounds.

**Preconditions:**

- A long-running or malformed provider emits very large text, chunks or a line without a newline.

**Failure / benefit mechanism:**

- Final-answer limit is applied after execution.
- Raw/carry/stream buffers continue growing beforehand.
- Process memory can grow without a corresponding admission bound or clear incomplete failure.

**Controls and counterevidence checked:**

- Cold stdout has a 64 MiB rolling tail and prompt size is bounded, but auxiliary accumulators and warm streams are separate.

**Impact:** Local bridge resource exhaustion or silent loss of stream context despite a configured answer cap. No production OOM was induced.

**Verification:** Baseline growth paths are static proof; candidate bound regressions are included in specialist/full suites. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-EXEC-FIX, C-ALL-FINAL

**Recommendation:** Add explicit bounded raw capture and log carry, fail incomplete on overflow, retain safe clipped recovery context, and scrub before intermediate clipping.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Controlled oversized cold/warm/log output fails with output\_limit and preserved session/usage uncertainty; no silent truncated success.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** Local source evidence

**Coverage references:** CV-EXEC

### AUD-022 — MCP progress is not monotonic across warm updates or fan-out legs

**Kind:** defect · **Category:** contract · **Severity:** low · **Confidence:** high · **Verification:** static-verified · **Priority:** P2

**Invariant:** Progress values must increase for each MCP request progress token.

**Evidence:**

- src/server.ts:145–161 (progressReporter): Provider stepIndex is forwarded as request progress.
- src/delegation.ts:618–622 (warm progress callback): Every warm update uses stepIndex zero.

**Preconditions:**

- Client requests progress for a warm call or a multi-leg request whose provider indices restart.

**Failure / benefit mechanism:**

- Provider emits repeated/reset step indices.
- Server forwards them with one progress token.
- Progress does not increase as the MCP contract requires.

**Controls and counterevidence checked:**

- One-second throttling reduces notification volume but does not create monotonic values.

**Impact:** Clients can display stalled/regressing progress or reject protocol-invalid updates.

**Verification:** Baseline values are directly traceable; candidate warm regression observes \[1,2\]. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-FIX

**Recommendation:** Use a server-owned increasing sequence per request token, retaining provider type/text only as scrubbed descriptive metadata.

**Effort:** S

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Repeated warm index zero produces progress 1 then 2; fan-out resets do not decrease the token’s progress.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S20

**Coverage references:** CV-CORE

## Substantiated future risks

### AUD-002 — Whole-agent replay is authorized by insufficient evidence

**Kind:** risk · **Category:** data-integrity · **Severity:** high · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** A whole agent turn must not be repeated without proof that it was not dispatched or that its complete effects are safe to repeat.

**Evidence:**

- src/delegation.ts:463–468 (mayRepeat): Unchanged trees or unknown plan coverage permit a repeat.
- src/delegation.ts:591–597 (attemptWithSkewRetry): Text-classified invalid model refreshes and dispatches again without admission proof.
- src/delegation.ts:763–773 (runOnce): Network failures repeat the entire request.

**Preconditions:**

- A sent turn has file or external effects before a network, quota, invalid-model-like or uncertain warm failure.

**Failure / benefit mechanism:**

- The first agent turn is dispatched.
- A failure is classified using text or local tree state.
- The bridge repeats a whole turn although neither condition proves external effects absent.

**Controls and counterevidence checked:**

- Tree fingerprints, write restrictions and denied actions constrain local behavior but cannot establish that no network or external process effect occurred. API-level retryability concerns a model request, not the entire agent workflow.

**Impact:** Repeated execution was observed. Duplicate remote changes or charges are conditional on what the delegated agent did; no remote corruption or actual duplicate bill was demonstrated.

**Verification:** Baseline network/quota cases spawned twice; warm error spawned cold after delivery. Candidate regressions assert one dispatch. Apply status: Applied in candidate 3.2.0; focused and final Linux integration checks passed.

**Executed command references:** C-CORE-REPRO, C-CORE-FIX

**Recommendation:** Do not replay after dispatch. Let AGY handle native transient retries; record quota for later requests and invalidate stale discovery only for the next deliberate call.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Network/quota/model/uncertain-warm fake failures result in one dispatch even with an unchanged or unknown tree. Pre-send WarmUnavailable may fall back safely.

**Independent review:** revised; Execution specialist and coordinator, separate from core implementer; Accepted the code paths and synthetic reproductions. Severity assumes sensitive child diagnostics or effectful delegation; no real credential incident or remote corruption was tested.

**Source references:** S15, S16

**Coverage references:** CV-EXEC, CV-STATE

### AUD-020 — The baseline dependency graph contains known advisories

**Kind:** risk · **Category:** supply-chain · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P1

**Invariant:** Installed dependency advisories must be assessed for applicability and repaired without overstating project exploitability.

**Evidence:**

- package.json:45–60 (dependencies/devDependencies): Direct SDK/Zod/test dependencies select the affected lockfile graph.
- package-lock.json:1–25 (locked dependency graph): Baseline graph was scanned as installed.

**Preconditions:**

- Affected dependency code is reachable in the particular transport, runtime or development tool usage.

**Failure / benefit mechanism:**

- Audit compares locked versions with published advisories.
- Affected direct/transitive package versions are installed.
- Exposure depends on whether this stdio application reaches the advisory’s vulnerable surface.

**Controls and counterevidence checked:**

- No hosted HTTP service is configured by this bridge; some advisories concern transitive or development surfaces. Scanner severity alone does not establish exploitability.

**Impact:** 13 affected packages were reported, including one critical transitive advisory. This is not a demonstrated critical remote exploit in a local stdio server.

**Verification:** Baseline npm audit: 1 critical, 5 high, 7 moderate packages. Candidate audit: zero known advisories. Apply status: Compatible dependency refresh applied; zero-known-advisory scan and Linux tests passed. Advisory reachability was reviewed at transport level, not exhaustively exploited.

**Executed command references:** C-AUDIT-BASE, C-AUDIT-FINAL, C-ALL-FINAL

**Recommendation:** Apply compatible patched versions, retain SDK v1 for this repair, re-run production/package/source checks and audit the refreshed graph.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Refreshed lock audit reports zero known vulnerabilities and all compatibility/packaging gates pass; do not infer absence of unknown vulnerabilities.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S18, S18B

**Coverage references:** CV-DELIVERY

### AUD-010 — A stale warm resident survives an intervening cold continuation

**Kind:** risk · **Category:** data-integrity · **Severity:** medium · **Confidence:** high · **Verification:** reproduced · **Priority:** P2

**Invariant:** A conversation resident must not be reused after another process changes its history or execution policy.

**Evidence:**

- src/delegation.ts:564–572 (warmEligible): Explicit model/effort/write/schema routes cold without invalidating the resident.
- src/delegation.ts:722–761 (runOnce): Cold continuation can launch while prior resident still owns the conversation.
- src/warm.ts:243–263 (turn): Later warm request reuses the retained process.

**Preconditions:**

- A conversation alternates warm follow-up, a cold continuation with changed execution needs, then warm follow-up.

**Failure / benefit mechanism:**

- First resident holds in-memory conversation state.
- Cold continuation uses the same conversation independently.
- Later warm request reuses the old resident.

**Controls and counterevidence checked:**

- Per-conversation admission serializes bridge work, but serial execution alone does not refresh another process history or release its presence lock.

**Impact:** Resident retention was reproduced. Stale model/history or presence-lock conflicts depend on live AGY behavior and are not asserted as proven provider corruption.

**Verification:** Baseline observed one resident, two warm turns, one cold turn and no kills before shutdown. Apply status: Resident invalidation and busy guards applied; local lifecycle tests passed. Live provider history/presence behavior remains a canary gap.

**Executed command references:** C-EXEC-REPRO, C-EXEC-FIX

**Recommendation:** Invalidate and reap residents before cold continuation; refuse while a resident is actively busy.

**Effort:** M

**Trade-offs:**

- Preserves the existing architecture; no new service or provider framework is required.

**Acceptance checks:**

- Warm→cold→warm changes resident identity and awaits exit; competing cold/ warm calls do not kill another active turn.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S2

**Coverage references:** CV-EXEC

## Hypotheses requiring verification

### AUD-024 — Evaluate new family defaults with representative work before promotion

**Kind:** improvement · **Category:** maintainability · **Severity:** info · **Confidence:** medium · **Verification:** hypothesis · **Priority:** P3

**Invariant:** Automatic routing changes should follow measured task and cost outcomes rather than family naming or price-table inference.

**Evidence:**

- src/tools.ts:295–310 (delegate chain): Automatic Flash/Pro policy is an existing default, not a measured Gemini 4 comparison.
- src/server.ts:216–217 (COUNCIL): Council membership adds independent paid turns.

**Preconditions:**

- Operator wants to change automatic defaults or expand council membership after enabling Gemini 4 selection.

**Failure / benefit mechanism:**

- Family support is added from account discovery.
- A global new default would alter quality, latency, entitlement and spend assumptions.
- A frozen comparative workload can establish whether a per-tool promotion is justified.

**Controls and counterevidence checked:**

- Current inventory proves selection availability only; direct API price tables do not establish subscription credits or AGY total cost. Historical Flash benchmarks cannot be relabeled.

**Impact:** Potential better task outcomes and resource use, but no measured savings or speedup is claimed.

**Verification:** No paid model benchmark was performed. Candidate preserves automatic defaults and documents evaluation choices. Apply status: Deferred deliberately. Selection support shipped in candidate; automatic policy changes await approved account-specific evaluation.

**Executed command references:** None; see verification classification

**Recommendation:** Keep existing defaults; canary explicit models with an approved budget, then compare acceptance success, latency, tokens/credits and quota failure per tool.

**Effort:** M

**Trade-offs:**

- Adds bounded evaluation effort but avoids an unmeasured global behavior and spend change.

**Acceptance checks:**

- All selected variants remain usable now; promote a default only with noninferior task acceptance and measured operational benefit on the agreed workload.

**Independent review:** not-required; Coordinator adjudication with specialist evidence; Medium/Low item; evidence and counterevidence reviewed. Independent review was prioritized for consequential findings and cross-boundary changes.

**Source references:** S1, S6, S7, S8, S14

**Coverage references:** CV-LIVE, CV-DOCS

## Optional improvements

None established within the reviewed scope.

## Coverage ledger

| ID          | Area                                                                          | Owner                                                                    | Status         |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------- |
| CV-CORE     | MCP validation, fan-out, responses and progress                               | delegation specialist; execution specialist independent review           | reviewed       |
| CV-MODELS   | Inventory, selection, effort, preferences and configuration                   | coordinator and delegation specialist                                    | reviewed       |
| CV-EXEC     | Process supervision, retries, warm lifecycle and terminal protocol            | execution specialist; coordinator and delegation specialist cross-review | reviewed       |
| CV-STATE    | Admission, token accounting, persistent preferences and cooldown coordination | coordinator and delegation specialist                                    | reviewed       |
| CV-FS       | Workspace validation, read-only coverage and confinement                      | execution specialist                                                     | partial        |
| CV-RELAY    | Bundled raw relay and installer                                               | delegation scout; research/relay implementer                             | reviewed       |
| CV-DELIVERY | Dependencies, packaging, release metadata and CI                              | coordinator; delegation specialist independent source review             | partial        |
| CV-DOCS     | Documentation, research, registration and model/cost claims                   | coordinator and research specialist                                      | reviewed       |
| CV-LIVE     | Authenticated account behavior and route economics                            | coordinator; operator follow-up                                          | blocked        |
| CV-NA       | Web application, database and tenant-isolation domains                        | coordinator                                                              | not-applicable |

### CV-CORE · MCP validation, fan-out, responses and progress

**Paths:**

- src/server.ts
- src/tools.ts
- src/delegation.ts
- src/egress.ts
- test/core-contract.test.ts

**Checks:**

- Trace all response paths and fan-out modes; synthetic credential markers; direct and SDK-facing validation; progress contract.

**Evidence:**

- C-CORE-REPRO
- C-CORE-FIX
- src/server.ts:createToolHandler
- src/delegation.ts:runMany

**Gaps / non-applicability:**

- None recorded.

### CV-MODELS · Inventory, selection, effort, preferences and configuration

**Paths:**

- src/models.ts
- src/config.ts
- src/preferences.ts
- src/delegation.ts
- test/models.test.ts
- test/gemini4-fixture.ts

**Checks:**

- ID/label/selector resolution; partial and reordered inventory; actual argv; persistence/form parity; TTL invalidation; stale pins.

**Evidence:**

- C-ROUTING-REPRO
- C-CORE-FIX
- test/gemini4-fixture.ts
- src/models.ts:ModelRegistry

**Gaps / non-applicability:**

- None recorded.

### CV-EXEC · Process supervision, retries, warm lifecycle and terminal protocol

**Paths:**

- src/runner.ts
- src/warm.ts
- src/failure.ts
- src/envelope.ts
- src/logtail.ts
- src/index.ts

**Checks:**

- Real disposable process groups plus fake CLI; cancellation/timeout/exit; required flag parity; terminal envelopes; raw-output bounds.

**Evidence:**

- C-EXEC-REPRO
- C-EXEC-FIX
- src/runner.ts:runAgy
- src/warm.ts:WarmSessions

**Gaps / non-applicability:**

- None recorded.

### CV-STATE · Admission, token accounting, persistent preferences and cooldown coordination

**Paths:**

- src/concurrency.ts
- src/usage.ts
- src/cooldown-store.ts
- src/quota.ts
- src/preferences.ts
- src/delegation.ts

**Checks:**

- Queued admission; failed/unknown usage; concurrent cooldown writers; maximum expiry; legacy aliases and preference compatibility.

**Evidence:**

- C-CORE-REPRO
- C-ALL-FINAL
- test/cooldown-store.test.ts
- test/core-contract.test.ts

**Gaps / non-applicability:**

- None recorded.

### CV-FS · Workspace validation, read-only coverage and confinement

**Paths:**

- src/egress.ts
- src/confine.ts
- src/worktree.ts
- test/confine.test.ts
- test/execution-regressions.test.ts

**Checks:**

- Allowed-root and symlink semantics; incomplete scans; nested repository/ignored content; confinement profile and Linux refusal behavior.

**Evidence:**

- C-EXEC-FIX
- src/worktree.ts:snapshotTree
- src/confine.ts

**Gaps / non-applicability:**

- Linux checks and profile inspection completed; macOS runtime sandbox checks are skipped locally. Run C-MAC before platform assurance.

### CV-RELAY · Bundled raw relay and installer

**Paths:**

- skills/agy-delegate/scripts/relay.mjs
- scripts/install-skills.mjs
- skills/agy-delegate/references
- skills/agy-delegation/SKILL.md
- test/relay.test.ts
- test/skills.test.ts

**Checks:**

- Fake child launch/abort; all configured roots; stale report directories; read-only status; installation replacement and rollback.

**Evidence:**

- C-RELAY-REPRO
- C-ALL-FINAL
- test/relay.test.ts
- test/skills.test.ts

**Gaps / non-applicability:**

- None recorded.

### CV-DELIVERY · Dependencies, packaging, release metadata and CI

**Paths:**

- package.json
- package-lock.json
- server.json
- Dockerfile
- .github/workflows/ci.yml
- scripts/check-release.mjs
- scripts/smoke-package.mjs

**Checks:**

- Baseline production failure; advisory graph; compatible upgrades; required aggregate check; isolated package install on Node 18 and 24.

**Evidence:**

- C-PROD-BASE
- C-AUDIT-FINAL
- C-PACK-18
- C-PACK-24
- C-TYPE-FINAL

**Gaps / non-applicability:**

- Current final Node 18/24 package artifacts passed. Actual Docker build and macOS runtime remain PR CI gates; local Docker binary is absent. Hosted branch-rule settings and registry publication are not asserted.

### CV-DOCS · Documentation, research, registration and model/cost claims

**Paths:**

- README.md
- CLAUDE.md
- docs/multi-client-support.md
- skills
- docs/research/gemini4-routing-2026-11-21.md
- server.json

**Checks:**

- Official current model/effort/pricing/CLI/MCP sources; public API versus AGY namespaces; truthful status and relay claims; historical benchmarks preserved.

**Evidence:**

- docs/research/gemini4-routing-2026-11-21.md
- S1
- S15
- S17
- C-ALL-FINAL

**Gaps / non-applicability:**

- None recorded.

### CV-LIVE · Authenticated account behavior and route economics

**Paths:**

- src/models.ts
- README.md
- docs/research/gemini4-routing-2026-11-21.md

**Checks:**

- Reviewed official contracts and user-supplied account fixture. No live model evaluation.

**Evidence:**

- test/gemini4-fixture.ts
- C-LIVE

**Gaps / non-applicability:**

- Need authorized account discovery and an approved paid-call budget; benchmark workload, latency, success, credits and usage before promoting new defaults.

### CV-NA · Web application, database and tenant-isolation domains

**Paths:**

- None recorded.

**Checks:**

- Architecture check: personal local stdio bridge, filesystem state, no hosted application/database.

**Evidence:**

- src/index.ts
- src/server.ts:createServer

**Gaps / non-applicability:**

- No application HTTP ingress, browser UI, SQL schema, queue service or multi-tenant authorization exists in the inspected scope. AGY account authentication is external.

## Verification ledger

### C-BASE-TEST · passed

**Command:** npm test (baseline)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline: 400 passed, 6 skipped. Passing existing tests did not cover the reproduced defects.

### C-BASE-TYPE · passed

**Command:** npm run typecheck (baseline)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline type check passed.

### C-BASE-BUILD · passed

**Command:** npm run build (baseline)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline bundled build passed.

### C-BASE-FORMAT · passed

**Command:** npm run format:check (baseline)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline formatting gate passed.

### C-CORE-REPRO · passed

**Command:** node ../audit-work/delegation/run/repro.mjs

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Executed baseline fake-provider harness: zero task dispatches; synthetic credential leaks; network/quota double dispatch beyond admission budget; failed warm usage omitted. Exit zero means observations were captured, not that behavior was correct.

### C-ROUTING-REPRO · passed

**Command:** node ../audit-work/root/routing-repro.mjs

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline routing harness observed unsupported XHigh, lost follow-up effort, unsupported tier persisted, and explicit Low selection changed by saved High effort.

### C-EXEC-REPRO · passed

**Command:** node ../audit-work/execution/repro.mjs

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline isolated execution harness observed launch-option loss, unsupported sandbox accepted warm, lost terminal context, stale resident retention, and surviving descendants. Harness reaped its test children.

### C-RELAY-REPRO · passed

**Command:** python3 ../audit-work/delegation/relay-repro.py

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Baseline fake relay harness observed three missed workspace edits, stale reports, and a surviving descendant after abort. Early harness setup failed because its fake CLI used CJS in an ESM scope; corrected harness then completed and cleaned children.

### C-PROD-BASE · failed

**Command:** npm ci --omit=dev --offline --no-audit --no-fund --prefix ../audit-work/root/docker-install

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 127

Baseline production dependency install ran prepare=husky with dev dependencies omitted: husky not found. This reproduces the Docker production-stage install failure, without claiming an actual Docker build ran.

### C-AUDIT-BASE · failed

**Command:** npm audit --json --ignore-scripts (baseline)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 1

13 affected packages: 1 critical, 5 high, 7 moderate. Advisory severity is not project exploitability.

### C-CORE-FIX · passed

**Command:** vitest run test/core-contract.test.ts test/delegation.test.ts test/server.test.ts test/hardening.test.ts test/preferences.test.ts test/tools.test.ts test/usage.test.ts test/egress.test.ts

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

222 focused core tests passed with Vitest 5.1.1, followed by tsc --noEmit exit zero.

### C-EXEC-FIX · passed

**Command:** vitest run (nine execution/confinement suites)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Final specialist execution gate: 140 passed, 5 macOS-only skips; no failures. Includes child ownership, busy resident, cancellation, raw limits and redaction ordering.

### C-ALL-INITIAL · failed

**Command:** env -u AGY\_E2E npm test (initial candidate integration)

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 1

Initial integration: 529 passed, 1 failed, 6 skipped. test/confine.test.ts expected WarmUnavailable from a second unconfined request while the first resident turn was still busy; the new InvalidRequestError correctly refused busy reuse. The test now finishes the first turn before asserting confinement mismatch and no second spawn, then the full suite was rerun.

### C-ALL-FINAL · passed

**Command:** env -u AGY\_E2E npm test

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Final candidate integration: 533 passed, 6 skipped, 539 total; 27 files passed and 1 file skipped; 12.16 seconds. Reported by coordinator after all code fixes.

### C-TYPE-FINAL · passed

**Command:** npm run typecheck &amp;&amp; npm run check:release &amp;&amp; git diff --check

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Typecheck, release-version consistency, and whitespace checks passed on the candidate.

### C-PACK-24 · passed

**Command:** npm run build &amp;&amp; npm run test:package

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Current final source artifact rebuilt and verified on Node 24.22.3: empty production install, tarball contents, stdio handshake, tools, fake delegation/follow-up and bundled skill installation all passed after the final source fixes.

### C-PACK-18 · passed

**Command:** npm exec --yes --package=node@18.20.8 --package=npm@10 -- node scripts/smoke-package.mjs

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Current final built artifact passed the same isolated package/stdio/skill smoke on declared minimum Node 18.20.8 after the final source fixes.

### C-AUDIT-FINAL · passed

**Command:** npm audit --json --ignore-scripts

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** 0

Refreshed lockfile: zero known vulnerabilities. SDK 1.32.2, Zod 4.6.7, Vitest 5.1.1. Does not establish absence of unknown or application defects.

### C-MAC · not-run

**Command:** macOS CI execution/confinement matrix

**Environment:** macOS runner pending

**Exit:** None

Local host is Linux. macOS sandbox-exec behavior and platform-only cases require the configured CI run.

### C-DOCKER · blocked

**Command:** docker build -t claude-agy-mcp-smoke .

**Environment:** Linux disposable checkout; no live AGY/provider calls

**Exit:** None

Docker binary is absent locally. Actual Docker build is configured in PR CI; production dependency installation and packed artifact were independently verified.

### C-LIVE · not-run

**Command:** Approved account-specific AGY discovery, canary and route benchmark

**Environment:** Authorized isolated account and approved call budget required

**Exit:** None

No authenticated provider call or paid inference was run. Entitlements, credit economics, current live CLI behavior, and default-policy quality/latency remain unmeasured.

## Source ledger

### S1 · [Antigravity models](https://antigravity.google/docs/models)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** AGY model family/tier and entitlement distinctions; account inventory remains authoritative.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S2 · [AGY headless mode](https://antigravity.google/docs/cli/headless/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Model inventory examples, JSON/NDJSON envelopes, usage and stream protocol.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S3 · [AGY effort command](https://antigravity.google/docs/cli/commands/effort/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Recognized effort vocabulary does not imply every listed model supports every effort.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S4 · [Gemini API thinking](https://aistudio.google.com/docs/thinking)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** API thinking settings and defaults belong to the direct API, not automatically to AGY.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S5 · [Gemini 4 Neon API model](https://aistudio.google.com/docs/models/gemini-4-neon)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** API model namespace and context limits differ from AGY selectable variants.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S6 · [Choosing a Gemini model](https://aistudio.google.com/docs/choosing-a-model)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Workload guidance supports evaluation candidates, not measured superiority in this repository.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S7 · [Hydrogen and Orchestrator announcement](https://antigravity.google/blog/gemini-4-hydrogen-in-google-antigravity/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Orchestrator combines planner/executor roles and is not independent council voting.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S8 · [Gemini Developer API pricing](https://aistudio.google.com/docs/pricing)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Direct API rates and dated promotions; cannot be converted to an AGY bill without billing-path evidence.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S9 · [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Anthropic; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Direct Claude API reference pricing.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S10 · [Google subscriptions in USD](https://gemini.google/subscriptions/?currencyCode=USD)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Personal subscription price references are separate from per-token API prices.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S11 · [AGY installation and authentication](https://antigravity.google/docs/install?tab=cli)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Provider/account authentication belongs to AGY and determines billing path.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S12 · [Antigravity plans](https://antigravity.google/docs/plans/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Plan quotas and overage semantics differ from bridge token admission.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S13 · [AGY Cloud pay as you go](https://antigravity.google/docs/pay-as-you-go/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Cloud billing is a distinct pathway.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S14 · [AGY usage command](https://antigravity.google/docs/cli/commands/usage/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Provider/account usage is needed to validate cost and quota; local token totals are incomplete billing evidence.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S14B · [AGY credits](https://antigravity.google/docs/cli/credits/)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Credit scope and account accounting are separate from token reference prices.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S15 · [Antigravity changelog](https://antigravity.google/docs/changelog)

Google; accessed 2026-11-21; living changelog; reviewed CLI 1.2.1 through 1.5.0 changes.

**Supports:** Versioned native transient retries, terminal finished\_reason, exit status and AGY\_ERROR contracts.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S16 · [Gemini API troubleshooting](https://aistudio.google.com/docs/troubleshooting)

Google; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** API request retry advice is not permission to replay a whole effectful agent task.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S17 · [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

Model Context Protocol; accessed 2026-11-21; 2026-07-28 specification.

**Supports:** Execution errors, structured results and tool boundary semantics.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S18 · [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

Model Context Protocol; accessed 2026-11-21; v1 maintenance line; candidate uses 1.32.2.

**Supports:** SDK v1 compatibility line and supported transport integration.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S18B · [MCP TypeScript SDK security advisories](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories)

Model Context Protocol; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Advisories require installed-version and reachable-transport applicability checks.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S19 · [Troubleshooting required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/troubleshooting-required-status-checks)

GitHub; accessed 2026-11-21; living documentation, checked 2026-11-21.

**Supports:** Skipped aggregate jobs can undermine a required status; depend on and inspect required job conclusions.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

### S20 · [MCP progress specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress)

Model Context Protocol; accessed 2026-11-21; 2026-07-28 specification.

**Supports:** Progress values must increase for a progress token.

**Applicability:** Read by the coordinator/research specialist; applicability is limited to the named product and current documentation.

## Candidate adjudication

- Eager default-council lookup described in uploaded dirty-plan F4: rejected — The supplied plan referenced a dirty draft absent from the retrieved checkout. Baseline server.ts219–227 already chooses tasks first and 395–399 has no eager council resolution. Related actual baseline council defects are retained without attributing the unseen code.; retained as AUD-004
- Proven remote corruption or duplicate billing from replay: deferred — Repeated fake dispatch is reproduced, but no live external effect or account bill was tested. Retained as conditional high-impact replay risk rather than proven remote damage.; retained as AUD-002
- Critical internet-exposed dependency exploit: rejected — npm audit severity is a package advisory classification. This bridge exposes local stdio; reachability of the critical transitive surface was not established.; retained as AUD-020
- Observed provider history corruption from retained resident: deferred — Resident retention is reproduced; live provider history/presence-lock consequences require the canary.; retained as AUD-010
- Missing adapter for each Gemini 4 family: rejected — The bridge delegates provider execution to AGY and already discovers inventory. A consistent selection contract is sufficient.; retained as AUD-006
- Redaction keys, denial fields, retry notes and progress step types as separate findings: duplicate — These are egress paths sharing one scrub-before-cap boundary and remedy; retained as one redaction finding with coverage across fields.; retained as AUD-001
- Read-only mode guarantees no external effects: rejected — Plan mode is advisory; OS confinement is conditional and scoped to declared roots. Watched filesystem equality does not prove no network or outside-root effects.; retained as AUD-012
- Change all defaults to Argon/Carbon or add an unconditional four-family council: deferred — User authorized support and repairs. Entitlement and workload economics require evaluation; no benchmark evidence supports global promotion.; retained as AUD-024
- Partial output clipping can split a credential before redaction: duplicate — Independent final review identified the ordering edge. Candidate clipPartialOutput now scrubs before the intermediate cap when redaction is enabled.; retained as AUD-001

## Remaining work

- Collect hosted macOS and Docker CI conclusions.
- Run approved live AGY account canary; default-policy evaluation remains separately deferred.

- All reported locations are baseline locations; apply status is separate from original defect existence.
- Coordinator owns final integration/release evidence, commits and PR. This report task did not modify product code or commit.
- Checker validates report consistency and references, not evidence truth, severity or completeness.
