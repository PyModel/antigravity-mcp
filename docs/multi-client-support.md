# Antigravity MCP: coding-agent setup

Verified against the official host documentation on **2026-11-21**.

Antigravity MCP is a third-party MCP stdio server that lets coding agents delegate
work to Google's Antigravity CLI (`agy`). This project is maintained independently;
it is not an official Google MCP server. Pi, OpenCode, Codex, and Claude Code can
launch it as a local process. Other hosts need an MCP stdio client or can use the
bundled CLI relay described in the [README](../README.md#bundled-skills).

The source package is now named `@pymodel/antigravity-mcp`. **That npm name was not
published at verification time.** Start with the local build below. The
[package commands](#after-the-renamed-package-is-published) apply only after a
release under the new name. The repository remains
[PyModel/claude-agy-mcp](https://github.com/PyModel/claude-agy-mcp).

## Start with the local build

Follow the README's [installation](../README.md#install) and
[build](../README.md#build) instructions. Keep the checkout and its installed
dependencies available: hosts will launch its built `dist/index.js`.

From that checkout, print the two absolute paths needed by the examples:

```bash
node -p 'process.execPath'
node -p 'require("node:path").resolve("dist/index.js")'
```

Replace `/absolute/path/to/node` and
`/absolute/path/to/antigravity-mcp/dist/index.js` in the configuration blocks with
those results. The checkout directory may still be named `claude-agy-mcp`; use its
actual path. Preserve other server entries when merging configuration.

Install and authenticate [Antigravity CLI](https://antigravity.google/docs/install?tab=cli)
for the same operating-system user that runs the host. Confirm its metadata is
available from that environment:

```bash
agy --version
agy models
```

Use an absolute `AGY_PATH` if the host's environment cannot find `agy`; the
[environment settings](#authentication-and-environment-settings) differ by host.
Select the project being delegated through the tools' `cwd` and, when needed,
`dirs` arguments. The bridge checkout is the server installation, not necessarily
the project to analyze.

## Pi

Pi added MCP support as a **built-in extension in version 0.99.0 on
September 29, 2026**. Use a current Pi release for the configuration below; older
releases require an upgrade or a separately installed adapter with its own setup.
See the [official changelog](https://pi.dev/changelog) and
[MCP guide](https://docs.pi.dev/latest/mcp).

Merge this into `~/.pi/agent/mcp.json` for user scope, or `.pi/mcp.json` for a
trusted project:

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/antigravity-mcp/dist/index.js"],
      "timeout": 3660
    }
  }
}
```

Pi's `timeout` is in **seconds**, defaults to 60, and resets on progress
notifications. Check connections with `pi mcp list` or `/mcp`. Run `/reload` after
changing the file during a session.

Current Pi does not require a third-party MCP adapter. An installed extension
that registers `/mcp`, such as `pi-mcp-adapter`, replaces the built-in integration
inside sessions. Follow that extension's documentation if using it. Pi SDK
sessions must explicitly load the built-in MCP extension; the CLI configuration
alone does not configure an SDK resource loader.

## OpenCode

The following is the current **native V2** format. Merge it into project
`opencode.jsonc` or user `~/.config/opencode/opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "antigravity": {
        "type": "local",
        "command": ["/absolute/path/to/node", "/absolute/path/to/antigravity-mcp/dist/index.js"],
        "timeout": {
          "execution": 3660000
        }
      }
    }
  }
}
```

Run `opencode mcp list` to check the connection. V2 groups entries under
`mcp.servers`; a configured server connects unless `disabled` is true. The
`timeout` object uses **milliseconds** and separates `startup`, `catalog`, and
`execution`. Defaults are 30 seconds, 30 seconds, and 12 hours respectively. The
example deliberately bounds execution to 61 minutes.

Supported V1 configuration remains accepted by V2 and is normalized in memory.
V1 placed entries directly under `mcp` and used `enabled` and a numeric `timeout`.
Keep each server entry in one format; do not give a V1 client the native V2 block.
See [MCP servers](https://opencode.ai/docs/mcp-servers/),
[configuration locations](https://opencode.ai/docs/config/), and the
[V1 migration guide](https://opencode.ai/docs/migrate-v1/).

## Codex CLI and IDE

Merge this table into `~/.codex/config.toml` for user scope, or
`.codex/config.toml` for a trusted project:

```toml
[mcp_servers.antigravity]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/antigravity-mcp/dist/index.js"]
startup_timeout_sec = 30
tool_timeout_sec = 3660
```

Run `codex mcp list` or use `/mcp` in the CLI. Both timeout values use **seconds**;
the documented defaults are 10 seconds for startup and 60 seconds for a tool.
Use the longer tool timeout for delegation.

Codex CLI and its IDE integration share the host's MCP configuration. A hosted
chat does not automatically read a local `config.toml` or gain access to the local
process. See the [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
The documented CLI registration syntax was also checked against local
`codex-cli 0.172.0-alpha.2`; no server was registered during that check.

## Claude Code

For user scope, replace both absolute paths and run:

```bash
claude mcp add-json --scope user antigravity \
  '{"type":"stdio","command":"/absolute/path/to/node","args":["/absolute/path/to/antigravity-mcp/dist/index.js"],"timeout":3660000}'
```

For shared project scope, merge this into the project's `.mcp.json` instead:

```json
{
  "mcpServers": {
    "antigravity": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/antigravity-mcp/dist/index.js"],
      "timeout": 3660000
    }
  }
}
```

Check with `claude mcp get antigravity` or `/mcp`. Project servers may need approval
inside the host. `--scope user` applies across projects; the CLI's default local
scope applies only to the current project for that user.

The per-server `timeout` is a hard wall-clock tool limit in **milliseconds**;
progress does not extend it. `MCP_TOOL_TIMEOUT` configures Claude Code's
cross-server tool limit, while `MCP_TIMEOUT` configures startup. These environment
variables are Claude Code settings, not portable MCP settings. See
[Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

## Timeout settings

The examples use 61-minute host limits. These are configuration choices, not the
hosts' default values:

| Host        | Setting in the server entry | Example   | Unit                                       |
| ----------- | --------------------------- | --------- | ------------------------------------------ |
| Pi          | `timeout`                   | `3660`    | Seconds; progress resets the request timer |
| OpenCode V2 | `timeout.execution`         | `3660000` | Milliseconds                               |
| Codex       | `tool_timeout_sec`          | `3660`    | Seconds                                    |
| Claude Code | `timeout`                   | `3660000` | Milliseconds; wall-clock limit             |

The bridge's default `AGY_MAX_RUNTIME` is 3600 seconds, with a 15-second kill
grace. The extra host minute leaves room for cleanup and an incomplete-result
report. Account for tool-specific `AGY_TIMEOUT_<TOOL>` or global `AGY_TIMEOUT`
overrides when choosing the host limit. A queued or multi-delegation call can also
need more time than one individual AGY turn. Raising only a bridge timeout does
not extend the host's deadline. See
[Timeouts and cancellation](../README.md#timeouts-and-cancellation).

An interruption does not undo work already performed. Inspect partial output,
session metadata, and changed files before deliberately continuing. Do not
automatically resend a whole delegated task after a timeout or connection error.

## Authentication and environment settings

There are two separate agents: the host runs its own selected model, and this
server starts AGY for delegated work. Signing into Pi, OpenCode, Codex, or Claude
Code does not authenticate AGY. Configure AGY's account or provider separately;
see the README's [pricing and cost](../README.md#pricing-and-cost) discussion for
subscription versus API billing.

These examples use local stdio and do not require a remote MCP OAuth login.
AGY must be reachable and authenticated in the environment where the server
actually runs. A desktop app, container, or remote host can have a different
`PATH`, home directory, and environment from a terminal.

To set the bridge's `AGY_PATH`, use the host's documented process environment
field, with your actual executable path:

| Host        | Environment configuration                                                        |
| ----------- | -------------------------------------------------------------------------------- |
| Pi          | Add `"env": { "AGY_PATH": "/absolute/path/to/agy" }` to the server entry         |
| OpenCode V2 | Add `"environment": { "AGY_PATH": "/absolute/path/to/agy" }` to the server entry |
| Codex       | Add `[mcp_servers.antigravity.env]` with `AGY_PATH = "/absolute/path/to/agy"`    |
| Claude Code | Add `"env": { "AGY_PATH": "/absolute/path/to/agy" }` to the server entry         |

The same fields can hold documented bridge options such as `AGY_MAX_RUNTIME`.
Keep environment values as strings. Do not assume that host API credentials
select AGY's provider or grant access to the same models.

## First model choice

With the default `AGY_ASK_MODEL=true`, the bridge asks for the user's model choice
before its first delegation. An elicitation-capable host can display the model
form. Other hosts receive an actionable request to call `set_model`.

Have the host call `agy_status` to inspect the available inventory, ask the user
whether to accept the proposed default or choose a listed variant, then call
`set_model` with that choice. An empty object accepts the proposed default after
the user agrees. An explicit choice supplies the actual listed model ID; do not
invent an effort suffix or assume the host's own model is available in AGY.
`set_model` saves a preference without running a delegated model turn. See
[Model routing](../README.md#model-routing).

## Optional bundled skills

The MCP registration exposes tools; skill installation supplies reusable
delegation instructions. From the checkout, use an explicit destination when
installing the bundled skills:

```bash
# Codex: user scope.
node scripts/install-skills.mjs --dir "$HOME/.agents/skills"

# OpenCode: user scope.
node scripts/install-skills.mjs --dir "$HOME/.config/opencode/skills"
```

Codex's project location is `.agents/skills`; OpenCode's is `.opencode/skills`.
OpenCode also discovers compatible `.agents/skills` and `.claude/skills`
locations, so choose one intended source instead of installing duplicate copies.
Keep the complete skill directory, including supporting scripts. See
[Codex skill locations](https://learn.chatgpt.com/docs/build-skills),
[OpenCode skill discovery](https://opencode.ai/docs/skills/), and the README's
[bundled skills](../README.md#bundled-skills).

## After the renamed package is published

**Do not use these commands before `@pymodel/antigravity-mcp` is published.** The
local build above is the available setup path at the verification date. Publishing
the new source package does not rename the existing GitHub repository.

After release, these commands register the canonical npm package. For Pi, Codex,
and OpenCode, keep the timeout settings from their configuration sections;
registration alone does not add those custom values.

```bash
# Pi: user scope by default; add -l for project scope.
pi mcp add antigravity -- npx -y @pymodel/antigravity-mcp

# OpenCode: project scope by default; add --global for user scope.
opencode mcp add antigravity -- npx -y @pymodel/antigravity-mcp

# Codex: configure tool_timeout_sec in config.toml after registration.
codex mcp add antigravity -- npx -y @pymodel/antigravity-mcp

# Claude Code: user scope, including the per-server timeout.
claude mcp add-json --scope user antigravity \
  '{"type":"stdio","command":"npx","args":["-y","@pymodel/antigravity-mcp"],"timeout":3660000}'
```

For file-based configuration, replace the local launch command with `npx` and
arguments `-y`, `@pymodel/antigravity-mcp`. OpenCode keeps the executable and
arguments together in its `command` array; the other hosts have separate
`command` and `args` fields. Preserve the host-specific timeout and environment
settings. `antigravity-mcp` is the canonical executable name after installation.

## Sources and verification scope

The guide verifies documented configuration, not an end-to-end delegation run in
every host. No model requests or host registrations were made for this check.
Host versions and administrator policies can affect capability availability.

All sources below were checked on **2026-11-21**:

- Pi: [MCP servers](https://docs.pi.dev/latest/mcp),
  [CLI commands](https://docs.pi.dev/latest/cli), and
  [0.99.0 release notes, September 29, 2026](https://pi.dev/changelog).
- OpenCode: [MCP servers](https://opencode.ai/docs/mcp-servers/),
  [configuration](https://opencode.ai/docs/config/),
  [V1 migration](https://opencode.ai/docs/migrate-v1/), and
  [skills](https://opencode.ai/docs/skills/).
- OpenAI: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and
  [Codex skills](https://learn.chatgpt.com/docs/build-skills). The previous
  `developers.openai.com/codex/mcp/` and `developers.openai.com/codex/skills/`
  addresses redirect to these pages.
- Anthropic: [Claude Code MCP](https://code.claude.com/docs/en/mcp).
- Google: [Antigravity CLI installation](https://antigravity.google/docs/install?tab=cli).
