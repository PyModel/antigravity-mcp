# Architecture and evidence boundaries

This appendix accompanies [the generated audit](report.md) and [the machine-readable record](audit.json). Baseline source is [`29f5b5c8d5f4343d1cab33c774f8deda359e64a2`](https://github.com/PyModel/antigravity-mcp/tree/29f5b5c8d5f4343d1cab33c774f8deda359e64a2). Findings cite that revision; implementation status describes the 3.2.0 candidate separately.

## System and flow

The project is a personal local MCP stdio bridge. `src/index.ts` starts `createServer`, loads environment configuration, probes CLI capabilities and confinement, registers schemas, and manages shutdown. The MCP client supplies tool arguments. Validation and prompt construction lead into `Delegator`, which resolves a selected inventory identity, checks workspace roots and admission, and chooses a cold process or compatible resident conversation. AGY owns authentication, model execution and any agent tools. The bridge observes the terminal envelope and workspace state, records reported usage/cooldowns, and returns fenced/redacted output to the calling agent.

The raw relay is a separate executable used by bundled skills. It calls AGY directly and writes run artifacts for an orchestrator. It does not provide the MCP router, its usage ledger or its OS confinement guarantees. Its read-only result is a bounded observation, and incomplete observation remains unknown.

| Boundary                        | State or authority                                          | Invariant / review                                                                                                  |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| MCP client → schemas            | Untrusted strings, model selectors, paths, cancellation     | Reject conflicting request shapes and unsupported variants before dispatch.                                         |
| Inventory → selection           | Account-specific IDs, labels, effort capabilities           | New execution/storage uses canonical IDs; exact choices remain fixed; unavailable chosen pins fail visibly.         |
| Preferences/cooldowns → routing | Local files shared between clients                          | Preserve saved intent and maximum cooldown expiry; atomic file replacement alone is not multi-writer serialization. |
| Admission → AGY                 | Concurrency, depth and reported token budget                | Recheck before dispatch; failed/unknown usage is not free; admission is not a hard in-flight cost cap.              |
| Bridge → child group/resident   | Spawned processes and conversation history                  | Same restrictions on cold/warm paths; own all descendants through cleanup; do not reuse stale residents.            |
| Agent effects → retry decision  | File and potentially external effects                       | Failure text or a clean local tree does not authorize repeating an already sent agent turn.                         |
| Workspace → read-only report    | Root admission, optional OS write confinement, fingerprints | Distinguish enforced from watched and unknown; no global read/network-isolation claim.                              |
| Provider output → MCP client    | Text, progress, errors, denial fields, JSON keys/values     | Bound raw resources; preserve incomplete recovery context; redact before output clipping.                           |
| Source → distributed package    | Build, npm tarball, production install, MCP registry        | Test actual artifacts and one consistent release identity on supported runtimes.                                    |

## Existing safeguards retained

Schema validation, bounded prompt arguments, path admission with physical symlink resolution, optional macOS write confinement, concurrency/session admission, delegation-depth protection, atomic preference writes, persistent cooldown intent, nonce-fenced model output, per-tool deadlines and fake-CLI tests already existed. The audit assessed their reachable failure paths instead of treating absence of a different architecture as a defect. No provider adapter framework, database, hosted service or SDK major migration was added.

## Coverage and method

Three specialists and the coordinator split selection/state/tool contracts, execution/confinement/lifecycle, and current documentation/relay/delivery work. High redaction and replay items received separate execution-specialist and coordinator review. Core and execution specialists cross-reviewed the repaired boundaries. Exact baseline snippets were re-read with `git show` before report generation.

The authoritative coverage ledger and command outcomes are in `audit.json` and the generated report. The metadata inventory observed 97 candidate paths at its collection point; it is neither a line-review percentage nor proof of correctness. Compact evidence files preserve observed values only. Fake process harnesses used disposable workspaces and cleaned their children. No provider traffic or real secret was used.

## Evidence files

- [Baseline core observations](evidence/baseline-core-results.json): fan-out, redaction and spending.
- [Baseline routing observations](evidence/baseline-routing-results.json): identity and tier mismatches.
- [Baseline execution observations](evidence/baseline-execution-results.json): warm policy, lifecycle and terminal metadata.
- [Baseline relay observations](evidence/baseline-relay-results.json): coverage, stale reports and abort cleanup.
- [Dependency scan summary](evidence/baseline-dependency-summary.json): affected packages, with project exposure qualifications in the report.
- [Inventory metadata](evidence/inventory-summary.json): paths and enumeration limitations.
- [Candidate file fingerprints](evidence/candidate-snapshot.json): timestamped working-tree evidence, not a publication identity.

## Remaining verification

Linux source and isolated package checks cannot establish authenticated entitlements, actual credits/cost, provider history after continuation, macOS sandbox behavior, hosted branch-rule configuration, or comparative model quality and latency. Those gaps are explicit in the report. Keep existing automatic routes until an approved workload evaluation justifies a change. The separate [research memorandum](../../research/gemini4-routing-2026-11-21.md) records current source-backed model, API pricing and subscription distinctions.

## Report generation

`audit.json` follows schema version 1.0 of the audit-codebase report contract. `report.md` is generated with its `check_report.py --render` command; no skill files are copied into this repository. The checker enforces structure, references, counts and action dependencies. It does not verify evidence truth, severity, runtime coverage or absence of additional defects. After updating final command evidence, rerun that checker/render step rather than hand-editing generated totals.
