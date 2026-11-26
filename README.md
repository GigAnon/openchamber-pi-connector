# OpenChamber Pi Connector

Use [OpenChamber](https://github.com/openchamber/openchamber) with the
[pi coding agent](https://github.com/badlogic/pi-mono) (`@earendil-works/pi-coding-agent`)
instead of OpenCode.

`openchamber-pi` is a local adapter server that speaks the subset of the
OpenCode HTTP/SSE API that OpenChamber actually consumes, and drives pi agent
sessions underneath via pi's [RPC mode](https://pi.dev/docs/latest/rpc)
(`pi --mode rpc`, JSONL over stdio) or the pi SDK (`AgentSession`).

```
OpenChamber (UI)  ──OpenCode API──▶  openchamber-pi  ──JSONL/stdio──▶  pi --mode rpc (one process per session)
```

No OpenChamber fork required: point OpenChamber at this adapter as an
**external OpenCode server** and sessions run on pi.

[![GitHub stars](https://img.shields.io/github/stars/qingzhu521/openchamber-pi-connector?style=flat&labelColor=100F0F&color=66800B)](https://github.com/qingzhu521/openchamber-pi-connector/stargazers)
[![License](https://img.shields.io/github/license/qingzhu521/openchamber-pi-connector?style=flat&labelColor=100F0F&color=205EA6)](./LICENSE)
[![OpenChamber](https://img.shields.io/badge/OpenChamber-1.24.x-100F0F?style=flat)](https://github.com/openchamber/openchamber)

## This fork: GigAnon/openchamber-pi-connector, branch `openjail`

A fork of [eliottness's fork](https://github.com/eliottness/openchamber-pi-connector) (itself a fork of
[qingzhu521's](https://github.com/qingzhu521/openchamber-pi-connector)), used by
[openjail](https://github.com/GigAnon/openjail) to run OpenChamber on its Pi jails. Branch `openjail` is eliottness's
`892a2b2` plus the commits below; openjail pins a commit of this branch by tree hash.

It targets **upstream Pi** (`@earendil-works/pi-coding-agent` 1.5 and 1.6) rather than oh-my-pi (OmO), and
**OpenChamber 2.7**, which speaks opencode 2.2's API:

| Change | Why |
|---|---|
| Decode a percent-encoded `x-opencode-directory` | OpenChamber 2.x sends `%2Fworkspace`; commands and sessions failed on the raw path |
| `/api/config` as a list of documents; empty answers to the startup probes (`/api/integration`, `/api/mcp`, `/api/shell`, `/api/websearch/provider`, `/api/experimental/job`) | opencode 2.2's shape; OpenChamber 2.7 could not open a workspace otherwise |
| Honour a client-chosen session id (`pi --session-id`) | OpenChamber 2.7 picks the id and drops a session created under another one |
| `session.inbox` events for prompts; the echoed user text kept out of the assistant output | OpenChamber 2.7 shows the user message from those events; the echo replaced the user's bubble |
| End a run on `agent_settled` | Upstream Pi emits it where OmO emits `agent_idle`; sessions stayed busy and the next prompt queued forever |
| [pi-permission-system](https://github.com/gotgenes/pi-permission-system) prompts as OpenChamber permission cards | Its "Permission Required" selects (also those forwarded from subagents) become the card on the running tool call; replies map to its options |
| Subagent calls as task cards | `Agent` (@tintinweb/pi-subagents, pi-subagents-hub) and `subagent` (@gotgenes/pi-subagents) take description / prompt / subagent_type like opencode's `task` |
| Fall back when `navigate_tree` is unknown | It is OmO's; upstream Pi answers "Unknown command". Reviving a session at its leaf works; revert and branch switching report that they are unavailable |
| A tool-use assistant message completes after its tools ran (`turn_end` / `agent_end`), not at `message_end` | OpenChamber marks a running tool in a completed message as "Error: Interrupted": a subagent's task card was red for its whole run |

Checked with OpenChamber 2.7.0 and Pi 1.6.1 (in openjail: its `tests/pi/openchamber_check.py` drives the UI against a
scripted model), and `npm test`. Not checked on this branch: OpenChamber 1.24, OmO, the `bin/opencode-pi` wrapper
flow (openjail starts the server itself, see below).

Known gaps (with OpenChamber 2.7): subagent sessions are listed flat, not under their parent; a new subagent
session appears in the sidebar only after a reload; a subagent's tool result loaded from history (rather than
received live) can show "Couldn't load the result"; streamed text and thinking show up at the end of a step.

### As an external server (how openjail runs it)

```bash
npm ci && npm run build
OCPI_OPENCODE_COMPAT_VERSION=2.2.7 node dist/cli.js serve --hostname 127.0.0.1 --port 4096 --directory /workspace
# then OpenChamber with OPENCODE_HOST=http://127.0.0.1:4096 (and OPENCODE_BINARY set to any executable: OpenChamber
# checks that one exists even when it only connects)
```

`OCPI_OPENCODE_COMPAT_VERSION` is the opencode version the server claims: without it the connector reports no
version, and OpenChamber 2.7 refuses what it takes for an old opencode (it needs 2.2.4 or later).

### Environment

| Variable | Default | |
|---|---|---|
| `OCPI_OPENCODE_COMPAT_VERSION` | none | opencode version reported by `/global/health` and `/api/info` (which says 2.0.18 without it) |
| `OCPI_PI_BINARY` | `pi` | the Pi executable |
| `OCPI_PI_ARGS` | none | extra arguments for each `pi --mode rpc` (space-separated) |
| `OCPI_IDLE_TIMEOUT_MS` | 900000 | an idle session's Pi process is stopped after this (revived on the next prompt) |
| `OCPI_MAX_LIVE` | 8 | Pi processes kept at once |
| `OCPI_STATE_DIR` | `~/.config/openchamber-pi-connector` | the connector's session index |
| `OCPI_AGENT` | oh-my-pi's `orchestrator.agentName`, else `build` | agent name shown in OpenChamber |
| `OCPI_DEBUG`, `OCPI_DEBUG_LOG` | off, `/tmp/openchamber-pi-debug.log` | HTTP requests and Pi events log |

The sections below are upstream's.

## Quick start

Needs Node.js 22+ and the `pi` CLI on PATH (`npm i -g @earendil-works/pi-coding-agent`).

```bash
git clone https://github.com/qingzhu521/openchamber-pi-connector.git
cd openchamber-pi-connector
npm install && npm run build

mkdir -p ~/.config/openchamber-pi
printf '{\n  "opencodeBinary": "%s/bin/opencode-pi"\n}\n' "$PWD" \
  > ~/.config/openchamber-pi/settings.json

OPENCHAMBER_DATA_DIR=~/.config/openchamber-pi openchamber serve --port 57124
# open http://127.0.0.1:57124
```

That starts a second OpenChamber instance whose sessions run on pi, leaving
your main OpenChamber setup untouched.

## Compatibility

| OpenChamber | Status |
|---|---|
| 1.24.x (desktop, API v1) | tested against 1.24.2 |
| other versions | not tested |

OpenChamber changes which OpenCode API calls it makes between releases. If a
feature breaks on a newer OpenChamber, run `npm run smoke` to see which part
failed, then open an issue with the output. See
[docs/api-surface.md](docs/api-surface.md) for the endpoints this adapter
implements.

## Status

**M1 + M2 work**: a real OpenChamber UI session chatting through the adapter
with pi as the backend — session create, prompt, live text/reasoning
streaming over SSE, **tool call parts** (bash/write/edit… rendered in
OpenChamber with arguments, results and completed/error states, mapped to
the SDK v2 `ToolState` union), abort, rename, archive (`time.archived` + list
filtering), delete, model catalog from pi.
See [docs/architecture.md](docs/architecture.md) for the design and
[docs/api-surface.md](docs/api-surface.md) for the endpoint compatibility
list.

## Usage with OpenChamber

OpenChamber spawns whatever `$OPENCODE_BINARY` / `settings.opencodeBinary`
points to as `serve --hostname H --port P`, waits for the stdout line
`opencode server listening on <url>`, then health-checks `/global/health`.
This repo's `bin/opencode-pi` wrapper implements that contract on top of pi.

Recommended: run a second, isolated OpenChamber profile so your main setup is
untouched:

```bash
# isolated profile dir
mkdir -p ~/.config/openchamber-pi
cat > ~/.config/openchamber-pi/settings.json <<'EOF'
{
  "opencodeBinary": "/absolute/path/to/openchamber-pi-connector/bin/opencode-pi"
}
EOF

# start OpenChamber with pi as the agent backend
OPENCHAMBER_DATA_DIR=~/.config/openchamber-pi openchamber serve --port 57124
# open http://127.0.0.1:57124
```

Requires: Node.js 22+, the `pi` CLI on PATH (`npm i -g @earendil-works/pi-coding-agent`).

Debug logging: set `OCPI_DEBUG=1` (writes HTTP requests and pi events to
`/tmp/openchamber-pi-debug.log`, override with `OCPI_DEBUG_LOG`).

## Standalone / smoke test

```bash
npm install
npm run build
npm run smoke   # end-to-end: bootstrap probes, tool round (real pi run), abort, rename, delete
npm run probe   # dump raw pi RPC events to pi-probe-events.jsonl (protocol forensics)
```

## Why

- OpenChamber is a great workspace UI (multi-run, session goals, diff
  walkthroughs, mobile surfaces) but is hard-wired to the OpenCode SDK.
- pi is a minimal, hackable coding agent with a first-class headless RPC
  protocol and SDK — but no rich UI.
- This project connects the two without forking either.

## Non-goals

- Reimplementing OpenChamber's own platform features (scheduler, relay,
  goals). Those live in OpenChamber and keep working.
- Wrapping pi as an LLM provider inside OpenCode. pi is a full agent with its
  own loop; we adapt at the session-protocol level.

## License

MIT
