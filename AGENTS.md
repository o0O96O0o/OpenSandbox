# OpenSandbox — Workspace Index

## How To Use This Index

- Use this file for repository shape, startup, build/run, and cross-module flows.
- Treat each local `CLAUDE.md` as the source of truth for its module.
- Move from root orientation to the nearest local guide before editing.

## Project Overview

OpenSandbox is a general-purpose sandbox platform for AI applications. It provides multi-language SDKs, unified sandbox lifecycle and execution APIs, and Docker/Kubernetes runtimes. Primary use cases include Coding Agents, GUI Agents, Agent Evaluation, AI Code Execution, and RL Training.

## Code Structure

```text
OpenSandbox/
├── server/          # Python FastAPI lifecycle control plane
├── specs/           # OpenAPI contracts (sandbox-lifecycle, execd-api, egress-api)
├── sdks/            # Multi-language SDKs (Python, JS/TS, Kotlin/Java, C#, Go) + MCP
├── cli/             # `osb` command-line interface
├── kubernetes/      # Kubernetes operator (BatchSandbox, Pool CRDs) and Helm chart
├── components/
│   ├── execd/       # In-sandbox execution daemon (commands and file operations)
│   ├── ingress/     # Sandbox traffic ingress proxy
│   └── egress/      # Sandbox network egress control
├── console/         # React/Vite web management UI
├── sandboxes/       # Runtime sandbox images (code-interpreter, claude-agent-server, etc.)
├── examples/        # SDK usage, agent integrations, browser/desktop/ML workloads
├── docs/            # Architecture docs and design notes
├── oseps/           # OpenSandbox Enhancement Proposals
├── tests/           # Cross-component E2E tests
└── scripts/         # Development and maintenance scripts
```

## Module Ownership

- `server/` — lifecycle API server; sandbox create/pause/resume/kill, pre-warm pool management
- `specs/` — public OpenAPI contracts; source of truth for sandbox lifecycle, execd, egress, and diagnostics APIs
- `sdks/` — handwritten + generated SDK clients across languages (Python, JS/TS, Kotlin, C#, Go); MCP server
- `cli/` — `osb` CLI for interactive sandbox management
- `kubernetes/` — Kubernetes operator (BatchSandbox + Pool CRDs), task-executor, Helm chart
- `components/execd/` — in-sandbox HTTP/SSE daemon; command execution, file I/O, Jupyter, PTY (port 44772)
- `components/ingress/` — traffic proxy for sandbox port routing; renew-intent Redis side-channel
- `components/egress/` — per-sandbox network egress controls (DNS proxy + nftables + mitmproxy sidecar, port 18080)
- `components/internal/` — shared Go utilities (logger, telemetry, safego) used by all three components
- `console/` — React management UI; sandbox CRUD, pool management, SSE console
- `sandboxes/` — runtime sandbox images (code-interpreter, claude-agent-server)

## Cross-Module Flows

### 1. Sandbox Lifecycle (Create → Run → Kill)

1. Client (SDK or CLI) calls lifecycle server (`server/`) via `specs/sandbox-lifecycle.yml` HTTP API.
2. Server creates/schedules a container via Docker or Kubernetes runtime.
3. Container starts `execd` (`components/execd/`) as the in-sandbox process daemon.
4. Client uses SDK to call `execd` via `specs/execd-api.yaml` for command execution and file I/O.
5. Network traffic to sandbox ports is routed through ingress; outbound is filtered by egress.
6. Kill/pause calls return through the lifecycle server.

### 2. Spec → Server → SDK Update Flow

1. Change `specs/sandbox-lifecycle.yml` or `specs/execd-api.yaml`.
2. Regenerate server schema (if applicable) and SDK generated clients.
3. Update handwritten adapter/service layers in affected SDKs.
4. Run lifecycle server tests and affected SDK language checks.

### 3. Kubernetes Pool Allocation

1. `PoolReconciler` schedules pods; assigns them to `BatchSandbox` via annotation.
2. `BatchSandboxReconciler` reads annotations, dispatches tasks through `TaskScheduler`.
3. `TaskScheduler` sends execution requests to the `task-executor` binary inside sandbox pods.

## Repo-Wide Conventions

- `specs/*` are public contract sources — treat as immutable without review.
- Prefer additive, backward-compatible changes for all public interfaces.
- Generated code lives under clearly marked paths; never patch it as the only fix.
- Tests must be updated whenever behavior changes or bugs are fixed.
- Keep changes focused: do not mix unrelated component work.
- Prefer file-scoped or package-scoped checks before full-suite validation.

## Build And Run

```bash
# Start the full stack via Docker Compose
docker compose up opensandbox-server

# Build sandbox runtime images (needed once before starting the full stack)
docker compose --profile sandbox-images build

# Start the server directly (Python)
cp server/opensandbox_server/examples/example.config.toml ~/.sandbox.toml
cd server && uv run python -m opensandbox_server.main

# Start the web console dev server (http://localhost:5173)
cd console && npm run dev
```

## Startup Sequence

1. Configure `~/.sandbox.toml` (copy from `server/opensandbox_server/examples/example.config.toml`).
2. Start `opensandbox-server` (Docker Compose or `uv run` in `server/`).
3. (Optional) Build sandbox images: `docker compose --profile sandbox-images build`.
4. (Optional) Start the console UI: `cd console && npm run dev`.
5. Verify: `osb config init && osb sandbox create --image python:3.12`.

## Operational Notes

- Requires Docker for local execution; Python 3.10+ for server and examples.
- `SANDBOX_CONFIG_PATH` env var overrides the default config file location.
- The console UI dev proxy expects the server on `localhost:8080` by default.
- For Kubernetes deployment, see `kubernetes/AGENTS.md` and `kubernetes/charts/`.

## Local Guides

- [`server/AGENTS.md`](server/AGENTS.md) — lifecycle server, FastAPI routes, test commands
- [`specs/AGENTS.md`](specs/AGENTS.md) — OpenAPI contracts, regeneration workflow
- [`sdks/AGENTS.md`](sdks/AGENTS.md) — multi-language SDKs, generated code, build commands
- [`kubernetes/AGENTS.md`](kubernetes/AGENTS.md) — operator, CRDs, Helm, E2E tests
- [`console/CLAUDE.md`](console/CLAUDE.md) — React web UI, API client, build and dev
- [`components/execd/AGENTS.md`](components/execd/AGENTS.md) — in-sandbox execution daemon
- [`components/ingress/AGENTS.md`](components/ingress/AGENTS.md) — sandbox traffic proxy
- [`components/egress/AGENTS.md`](components/egress/AGENTS.md) — network egress control
- [`components/internal/AGENTS.md`](components/internal/AGENTS.md) — shared Go utilities
- [`cli/AGENTS.md`](cli/AGENTS.md) — `osb` CLI
- [`tests/AGENTS.md`](tests/AGENTS.md) — cross-component E2E test suites

## Critical Constraints

- `pause`/`resume` return **501 Not Implemented** on the Kubernetes runtime.
- Pool management APIs return **501** on Docker runtime.
- `opensandbox.io/` metadata prefix is **system-reserved** — user requests with this prefix are rejected HTTP 400.
- In `server/main.py`: `devops_router` and `pool_router` MUST be registered **before** `proxy_router` (catch-all).
- `components/execd`: do NOT forward `SIGURG` to child processes (used by Go runtime for goroutine preemption).
- `sdks/sandbox/javascript/src/models/`: these are **intentionally NOT generated** — stable JS-friendly wrappers over potentially volatile OpenAPI schemas.
- `kubernetes/internal/scheduler/recovery.go`: task recovery has a known at-least-once race — duplicate task execution is possible on restart.
- For `server/**`, or lifecycle server behavior, sandbox creation flow, or user-visible server config, read `server/AGENTS.md`.
- For `sdks/**`, or SDK generation, handwritten adapters, or cross-language SDK alignment, read `sdks/AGENTS.md`.
- For `specs/**`, or API contract, schema, or example changes, read `specs/AGENTS.md`.
- For `kubernetes/**`, or CRDs, controller behavior, task execution, Helm/Kustomize deployment, pool scheduling, pause/resume snapshots, or Kind e2e tests, read `kubernetes/AGENTS.md`.
- For cross-cutting changes spanning spec, server, and SDKs, start with `specs/AGENTS.md` and then read affected consumer guides.
- For runtime component changes under `components/**`, read the nearest `README.md` or `DEVELOPMENT.md`; keep component APIs aligned with `specs/` and SDK consumers.
- For CLI changes under `cli/**`, read `cli/README.md` and verify command help/output behavior alongside unit tests.
- For cross-language e2e tests under `tests/**`, read the language-local README and keep test assumptions aligned with current server and SDK behavior.
- For areas without a local `AGENTS.md`, use the nearest `README.md`, `DEVELOPMENT.md`, and CI workflow as the next source of truth.

## Working Principles

- Think before coding: state assumptions, surface ambiguity, and ask or push back when the request has conflicting interpretations.
- Simplicity first: implement the smallest solution that satisfies the request; avoid speculative features, one-off abstractions, and unnecessary configurability.
- Surgical changes: touch only files and lines needed for the task, match local style, and do not refactor or delete unrelated pre-existing code.
- Goal-driven execution: translate non-trivial work into verifiable success criteria, add or update focused tests when behavior changes, and loop until checks pass or blockers are clear.

## Guardrails

Always:

- Keep changes focused on the user request.
- Treat `specs/*` as public contract sources.
- Keep spec, implementation, SDKs, docs, examples, config, and CLI behavior aligned when user-visible behavior changes.
- When changing `specs/*`, also update or verify affected server, SDK, docs, and release outputs when practical.
- When changing CRDs or Kubernetes public behavior, update or verify generated manifests, Helm/Kustomize deployment output, server Kubernetes integration, and docs when practical.
- Prefer additive, backward-compatible changes for public interfaces.
- Regenerate derived outputs when the source-of-truth file changes.
- Update tests when behavior changes or bugs are fixed.
- Mention unrun or blocked verification in the final handoff.

Ask first:

- Breaking public API, SDK, config, protocol, or CLI changes
- Breaking CRD, annotation, label, Helm values, or Kubernetes deployment changes
- Intentional drift between a public contract and its implementation
- User-visible config or behavior changes without a clear migration story

Never:

- Edit generated output as the only fix.
- Mix unrelated component work into the same change.

Most importantly, explore in the monolithic project but implement the code via subagents as there are multiple components inside this project.

## Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
