# src/lib/claude — Claude SDK Wrapper

> Navigation: [Root](../../../CLAUDE.md) | [src/lib](../CLAUDE.md)

## Purpose

Owns everything that touches `@anthropic-ai/claude-agent-sdk` directly. Nothing outside this directory should import from the SDK. Routes and other consumers go through the functions exported here.

## Entry Points

- `session-service.ts` — public API for all session operations (execute, list, get, fork, abort, introspect)
- `sdk-schemas.ts` — Zod schema definitions shared by `config.ts` and `session-service.ts`; import here for `PermissionMode`, `SettingSource`, and `QueryOptions`

## Directory Map

```
src/lib/claude/
  sdk-schemas.ts         Zod enums + queryOptionsSchema — dependency leaf (no local imports)
  session-service.ts     Core service: wraps SDK query(), session CRUD, introspection helpers
  runtime-registry.ts    In-memory Map<sessionId, ActiveRun>; tracks live Query handles, buffers events, fan-out subscribers
  message-normalizer.ts  Maps raw SDKMessage → NormalizedEvent shapes for HTTP responses
  S3SessionStore.ts      S3-backed SessionStore (copied verbatim from SDK ref example)
  session-store.ts       buildSessionStore() factory — constructs the SessionStore singleton
```

## Key Flows

### 1. Execute a prompt (batch or streaming)

1. Route handler calls `execute(input, onEvent?)` in `session-service.ts`
2. `buildOptions()` merges per-request options with server defaults from `config.ts`; rejects `bypassPermissions`
3. `promptToStream(input.prompt)` wraps the prompt (string or `ContentBlockParam[]`) in a single-yield async generator, enabling streaming input mode
4. `query({ prompt: asyncGenerator, options })` returns a `Query` async iterable from the SDK
5. If `input.sessionId` is known up front, `runtimeRegistry.start()` is called immediately and `onEvent` is subscribed
6. On first message containing `session_id`, `runtimeRegistry.ensureStarted()` registers the session and subscribes `onEvent`
7. Each message is passed to `normalizeMessage()` and emitted via `runtimeRegistry.emit()`, which buffers the event and fans it out to all subscribers (including `onEvent`)
8. After the loop, `execute()` emits a synthetic `session.completed` event via the registry (buffered + delivered to all subscribers)
9. `runtimeRegistry.finish()` resolves the session's completion promise then clears the entry; `queryHandle.close()` tears down the SDK handle
10. Returns `{ sessionId, result, events }`

**SSE stream resume:** client disconnect does NOT abort the agent. The route layer uses an `active` flag to guard writes to a closed response; the agent keeps running and its events are buffered. A reconnecting client can attach via `GET /sessions/:sessionId/stream` to replay buffered events and receive live ones.

### 1b. Inject a message into an active run

1. Route handler calls `streamMessageToSession(sessionId, prompt, priority?)` 
2. Retrieves the live `Query` handle from `runtimeRegistry.getQuery()`
3. Builds an `SDKUserMessage` from the prompt content, with optional `priority: 'now' | 'next' | 'later'`
4. Calls `queryHandle.streamInput(singleMessageIterable)` — the SDK delivers it to the running agent
5. Events from the agent's response flow through the original SSE stream that called `execute()`

### 2. Active-query introspection (rewind, commands, models, agents, context)

1. Route handler calls one of the `getSession*` or `rewindSessionFiles` functions
2. Each calls `requireActiveQuery(sessionId)` which checks `runtimeRegistry`
3. Returns `404` if the session ID is unknown to the SDK, `409` if it exists but is idle or stopping
4. Returns `409` (not `404`) specifically for `stopping` state to prevent races during teardown

### 3. Abort

1. `abortSession(sessionId)` checks `runtimeRegistry.get()`
2. If no active run: distinguishes 404 (unknown) vs 409 (idle) via `getSessionInfo()`
3. If active: sets `status = 'stopping'` then calls `runtimeRegistry.interrupt()` → `query.interrupt()`

## Interfaces and Dependencies

**Exports from `session-service.ts`** (used by `src/routes/sessions.ts`):
- `execute`, `streamMessageToSession`, `listStoredSessions`, `getStoredSession`, `getStoredMessages`
- `updateStoredSession`, `forkStoredSession`, `abortSession`
- `rewindSessionFiles`, `getSessionCommands`, `getSessionModels`, `getSessionAgents`, `getSessionContext`
- Zod schemas: `createSessionBodySchema`, `sendMessageBodySchema`, `patchSessionBodySchema`, etc.
- Serializers: `sdkSessionInfoToResponse`, `sessionMessageToResponse`
- Types: `PromptContent`, `ContentBlockParam` (re-exported from `sdk-schemas.ts`)

**`sdk-schemas.ts` is a dependency leaf** — it imports only from `zod`. Any file in the project can safely import it without creating a circular dependency.

**`runtime-registry.ts` singleton** — `runtimeRegistry` is module-level. All callers share the same instance. Do not create additional `RuntimeRegistry` instances.

Each `ActiveRun` now carries:
- `events: NormalizedEvent[]` — append-only in-memory buffer of every event emitted during the run
- `subscribers: Set<fn>` — live SSE writers; use `runtimeRegistry.subscribe(sessionId, fn)` (returns unsubscribe)
- `completionPromise: Promise<void>` — resolves when `finish()` is called; used by `GET /sessions/:sessionId/stream` to await session end

New methods: `emit()`, `subscribe()`, `getBufferedEvents(sessionId, afterIndex?)`, `getCompletionPromise(sessionId)`.

## Session Store

`session-store.ts` exports `buildSessionStore(cfg: StartupConfig): SessionStore | undefined`. Called once at module load in `session-service.ts`; the result is a module-level singleton.

- Returns `undefined` when no `sessionStore` key is present in `config.json` — server falls back to local-disk storage.
- Returns an `S3SessionStore` instance when `sessionStore.type === "s3"` is configured.
- Before constructing the store, `buildSessionStore` reads `process.env['USERNAME']` and appends it to the configured prefix: `{prefix}/{USERNAME}`. This namespaces each user's sessions independently in the bucket, replacing the per-user isolation that was previously provided by the OrangeFS `/root/.claude` mount.
- The singleton is spread into every `query()` call: `...(sessionStore !== undefined ? { sessionStore } : {})`.
- `sessionStore` is **not** exposed in `queryOptionsSchema` — it is a server-side concern, not a per-request API option.

`S3SessionStore.ts` is a verbatim copy of `ref/claude-agent-sdk/examples/session-stores/s3/src/S3SessionStore.ts`. Do not edit it independently — re-copy if the reference changes. It stores one NDJSON part file per `append()` call under the key layout:
```
{prefix}{projectKey}/{sessionId}/part-{epochMs13}-{rand6}.jsonl
```

## Working Notes

- `definedEntries()` strips `undefined` values before forwarding to SDK calls. This matters because SDK functions distinguish "option not provided" from "option is undefined" in some cases.
- `enableFileCheckpointing` must be set at query-start time; it cannot be enabled retroactively on an existing session.
- `forkSession` in `execute()`: if `input.forkSession` is true and `input.sessionId` is provided, the SDK creates a new session branched from that one. The original session is unchanged.
- The `stopping` state guard in `requireActiveQuery` prevents `rewindFiles` from racing with SDK teardown and leaving the working tree in an inconsistent state.
- New message types added to the SDK will fall through to the `message.raw` fallback in `normalizeMessage`. They won't break the server but will appear as raw events in responses.
- All prompts use **streaming input mode** (`prompt: AsyncIterable<SDKUserMessage>`). The `promptToStream()` helper wraps any `PromptContent` value in a single-yield generator — this is why image content blocks work even on the first message.
- `streamMessageToSession()` is the only path that uses `Query.streamInput()`. It must only be called while the session's query is still running; the route layer enforces this by checking `runtimeRegistry.get(sessionId)` before calling it.
- **SSE stream resume:** `execute()` subscribes `onEvent` to the registry, so all events are buffered even when the original SSE client disconnects. Route handlers use an `active` flag (set to `false` on `res.on('close')`) to skip writes to closed responses — they do NOT pass an abort signal on disconnect. The synthetic `session.completed` event is emitted via `runtimeRegistry.emit()` at end-of-run (before `finish()`), so reattached clients receive it too.

## Tests

Tests live in `tests/lib/claude/` (if present). Run a specific file:
```bash
npx vitest run tests/lib/claude/<file>.test.ts
```

## Scan Snapshot

- Date: 2026-04-20
- Files reviewed: sdk-schemas.ts, session-service.ts, runtime-registry.ts, message-normalizer.ts
