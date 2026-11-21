# Antigravity MCP security policy

## Supported versions

Report issues against the current source or latest published release. Fixes land in the current
source; older release lines are not maintained.

The project is transitioning to `@pymodel/antigravity-mcp`. As of November 21, 2026, that npm name
has not been published; the existing [`@pymodel/claude-agy-mcp` package remains at 3.1.0](https://www.npmjs.com/package/@pymodel/claude-agy-mcp/v/3.1.0). Source
changes and tests in this repository do not mean those fixes are present in a published package.
After the first release under the new name, its latest release becomes the supported release
channel. Include the package name, version, or source commit when reporting an issue.

## Reporting a vulnerability

Report privately via [GitHub Security Advisories](https://github.com/PyModel/claude-agy-mcp/security/advisories/new). Do not open a public issue.

Expect an acknowledgement within 7 days and a fix or mitigation plan within 30.

## Threat notes

Antigravity MCP spawns the local `agy` CLI as a subprocess with the server process's credentials
and filesystem access. Pi, OpenCode, Codex, Claude Code, and other MCP hosts use the same boundary.
Prompts are forwarded to the selected model available through the authenticated AGY account.

The trust chain runs **file contents → agy's model → verbatim into the calling agent's context window**, so both ends are gated rather than merely documented:

- **Path allowlist.** Set `AGY_ALLOWED_ROOTS` to a colon- or comma-separated list of absolute roots. `cwd`, `dirs` and every `files` entry are resolved and checked against it _before_ agy is spawned, so the tool input cannot nominate paths outside those roots. This validates inputs; it does not confine every shell command or network action performed by agy. Unset means unrestricted, which is the historical behaviour.
- **Output redaction.** `AGY_REDACT` (default `true`) scrubs credential-shaped strings — API keys, tokens, JWTs, private-key blocks, and the values of `*_SECRET` / `*_TOKEN` / `*_PASSWORD` assignments — from returned text, errors, metadata, progress messages, and structured content (including keys). It is deliberately shape-based, not entropy-based: a 40-character hex string is far more often a git SHA in a code review than a secret.
- **Least privilege per tool.** Read-only tools request `--mode plan`; `delegate` and `follow_up` can grant writes only with `write: true`. Plan mode alone is advisory. The MCP bridge can enforce write restrictions within the declared roots on macOS; elsewhere it watches for changes, or refuses with `AGY_READ_ONLY_ENFORCEMENT=require`. The raw relay only watches on every OS. Denied actions and incomplete filesystem coverage are reported explicitly.
- **Slash-command expansion off by default.** Without `--disable-slash-commands`, a hostile `AGENTS.md`, skill, or filename in the workspace can steer the delegated model through the user's own commands. Pass `slash_commands: true` to opt back in.
- **Response fencing.** Server metadata carries a per-call nonce and precedes the model payload. The host must treat the fenced payload as untrusted content; the fence is not a guarantee against prompt injection.
- **Recursion guard.** `AGY_MAX_DELEGATION_DEPTH` (default `1`) stops a host → agy → Antigravity MCP → agy loop if the server is also registered inside agy.

Redaction and allowlisting reduce exposure; they are not a guarantee. Do not pass secrets in tool arguments, and use platform confinement appropriate to the task. `AGY_SANDBOX=true` requests AGY terminal restrictions; it is not a general security boundary. A requested restriction unsupported by the installed CLI fails before dispatch.
