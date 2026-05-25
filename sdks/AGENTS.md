# SDKs AGENTS

You are working on OpenSandbox SDKs. Keep generated and handwritten code separate, and keep behavior aligned across languages when the same capability exists in multiple SDKs.

## Scope

- `sandbox/**`
- `code-interpreter/**`
- `mcp/**`
- workspace-level SDK build and release metadata

If the task is driven by spec changes, also read `../specs/AGENTS.md`.

## Key Areas

- `sandbox/python`, `sandbox/javascript`, `sandbox/kotlin`, `sandbox/csharp`, `sandbox/go`
- `code-interpreter/python`, `code-interpreter/javascript`, `code-interpreter/kotlin`, `code-interpreter/csharp`
- `mcp/sandbox/python/` — standalone MCP server (`opensandbox-mcp`), wraps Python sandbox SDK
- Workspace config: `package.json`, `pnpm-workspace.yaml` (JS only), `tsconfig.base.json`, `eslint.base.mjs`, `Directory.Build.props` (C# versions)

## Generated Code

Do not manually edit generated code as the only fix.

Generator-owned paths:

| SDK    | Generated path                                   | Generator                         |
| ------ | ------------------------------------------------ | --------------------------------- |
| Python | `sandbox/python/src/opensandbox/api/**`          | `openapi-python-client`           |
| JS/TS  | `sandbox/javascript/src/api/*.ts`                | `openapi-typescript` (type-only)  |
| Kotlin | `sandbox-api/build/generated/**`                 | Gradle `openapi-generator` plugin |
| Go     | `sandbox/go/api/{lifecycle,execd,egress}/gen.go` | `oapi-codegen` v2.6.0             |
| C#     | **None** — fully handwritten                     | —                                 |

Handwritten logic belongs in adapters, services, facades, converters, and stable SDK models.

**Non-obvious**: `sandbox/javascript/src/models/` types are intentionally NOT generated — they are stable JS-friendly wrappers over volatile OpenAPI schemas. Do not replace them with generated types.

**Go SDK**: specs are vendored in `sandbox/go/api/specs/` — update when `specs/` changes.

**Python sync mirror**: `sandbox/python/src/opensandbox/sync/` is a full synchronous mirror of the async API. Changes to the async layer usually require a parallel change to `sync/`.

## SDK Architecture Per Language

| Layer             | Python       | JS/TS          | Kotlin                         | C#           | Go             |
| ----------------- | ------------ | -------------- | ------------------------------ | ------------ | -------------- |
| Public facade     | `sandbox.py` | `sandbox.ts`   | `Sandbox.kt`                   | `Sandbox.cs` | `sandbox.go`   |
| Services          | `services/`  | `services/`    | `domain/services/`             | `Services/`  | (flat package) |
| Adapters          | `adapters/`  | `adapters/`    | `infrastructure/adapters/`     | `Adapters/`  | —              |
| Generated clients | `api/`       | `src/api/*.ts` | `sandbox-api/build/generated/` | —            | `api/*/gen.go` |

## Version Locations

| SDK            | Version file                                          | Tag pattern             |
| -------------- | ----------------------------------------------------- | ----------------------- |
| Python sandbox | `pyproject.toml` (VCS)                                | `python/sandbox/v*`     |
| Python MCP     | `pyproject.toml` (VCS)                                | `python/mcp/sandbox/v*` |
| JS/TS          | `sandbox/javascript/package.json`                     | —                       |
| Kotlin         | `sandbox/kotlin/gradle.properties`                    | —                       |
| C#             | `Directory.Build.props` (`OpenSandboxPackageVersion`) | —                       |
| Go             | git tag on module path                                | —                       |

## Commands

Workspace JS install:

```bash
cd sdks
pnpm install --frozen-lockfile
```

JavaScript SDK checks:

```bash
cd sdks
pnpm run lint:js
pnpm run typecheck:js
pnpm run build:js
pnpm run test:js
```

Python sandbox SDK:

```bash
cd sdks/sandbox/python
uv sync
uv run python scripts/generate_api.py
uv run ruff check
uv run pyright
uv run pytest tests/ -v
uv build
```

Python code-interpreter SDK:

```bash
cd sdks/code-interpreter/python
uv sync
uv run ruff check
uv run pyright
uv run pytest
uv build
```

JavaScript sandbox SDK:

```bash
cd sdks/sandbox/javascript
pnpm run gen:api
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run test
```

JavaScript code-interpreter SDK:

```bash
cd sdks/code-interpreter/javascript
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run test
```

Kotlin sandbox SDK:

```bash
cd sdks/sandbox/kotlin
./gradlew :sandbox-api:generateLifecycleApi :sandbox-api:generateExecdApi :sandbox-api:generateEgressApi
./gradlew spotlessApply :sandbox:test
```

Go sandbox SDK:

```bash
cd sdks/sandbox/go
go test ./...
```

## Guardrails

Always:

- For spec-driven changes, regenerate affected SDK code, update handwritten layers, then run affected language checks.
- For MCP changes, keep tool schemas, client setup docs, and sandbox SDK dependency behavior aligned.
- Add a regression test for every bug fix.
- Prefer tests for request mapping, response conversion, error mapping, streaming behavior, and resource cleanup.
- Keep package-local validation fast before widening to multi-language verification.
- Match public behavior across languages unless a documented platform constraint prevents it.
- Keep wire-format units and public SDK units separate. Public SDK interfaces should expose time durations as language-native duration types where available (`timedelta`, `Duration`) or otherwise as explicitly second-based fields such as `timeoutSeconds`.
- For Kotlin SDK public APIs intended for Java interoperability, do not expose Kotlin value classes such as `kotlin.time.Duration`; they are JVM-name-mangled and can be inaccessible from Java. Prefer `java.time.Duration` or explicit primitive wire units at the public boundary, with deprecated Kotlin-friendly overloads when needed for migration.

Ask first:

- Public breaking changes
- Large cross-language refactors
- Intentional behavior drift between languages

Never:

- Patch generated output as the only fix.
- Change SDK public behavior without tests.
- Mix unrelated non-SDK work into an SDK change.

## Good Patterns

- Generated clients for normal request/response APIs
- Handwritten transport only for streaming or protocol-specific paths such as SSE
