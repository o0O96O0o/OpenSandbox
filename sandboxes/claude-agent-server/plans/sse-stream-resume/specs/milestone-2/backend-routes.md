# routes/sessions.ts — Disconnect & stream endpoint

## What was done

Modified `src/routes/sessions.ts` to decouple agent execution from client connection lifetime and added a reattach endpoint.

1. **Removed `requestAbortSignal` from `POST /sessions` streaming branch.** Client disconnect no longer aborts the agent. Replaced with an `active` flag flipped from `res.on('close')` (only when `!res.writableEnded`) that guards every `writeSseEvent` / `writeSseError` call against writes to a closed socket. Removed the manual `session.completed` emit and `logger.info('session completed')` — both now flow through the runtime registry from `session-runner.ts`. `stopHeartbeat()` moved into `finally` (single call site).

2. **Same transformation applied to `POST /sessions/:sessionId/messages` streaming branch.** Identical `active`-flag pattern; removed `signal: requestAbortSignal(req, res)` from the execute call and the trailing manual completion emit/log.

3. **Removed `requestAbortSignal` and `logger` imports** — no remaining usages in the file.

4. **Added `GET /sessions/:sessionId/stream` endpoint** between `GET /sessions/:sessionId` and `PATCH /sessions/:sessionId`. Behavior:
   - Parses cursor from `Last-Event-ID` header (preferred) or `?cursor=` query string; passes through `parseInt(_, 10)` (yields `NaN` if non-numeric — the registry's `getBufferedEvents` is expected to handle that).
   - Returns **409** if `runtimeRegistry.get(sessionId)` is null (no active run to attach to).
   - Captures `completionPromise` synchronously before any `await` to avoid a race where the run finishes between the registry lookup and the await.
   - Opens SSE, starts heartbeat, installs `res.on('close')` guard with the `active`-flag pattern.
   - **Subscribes before replaying**: calls `runtimeRegistry.subscribe(sessionId, …)` first, then iterates `getBufferedEvents(sessionId, cursor)`. Because Node.js is single-threaded and there is no `await` between the two calls, no event can slip in between subscribe and replay.
   - Awaits `completionPromise` to keep the response open until the session finishes (or the client disconnects, in which case `active` is false and writes are no-ops while the await unblocks at run end).
   - Stops heartbeat and closes SSE on completion.

## Deviations from plan

None. Implemented exactly as specified.

Notes on intentional details that match the spec:
- The subscriber's unsubscribe handle is **not** stored or called. On client disconnect the `active` flag suppresses all writes, and the subscriber becomes a no-op until the run finishes and (per the registry contract) all subscribers are cleared. If a future change makes the registry retain subscribers across runs, this endpoint would need to track and call the unsubscribe fn — flagging here for future maintainers.
- `parseInt(rawCursor, 10)` returning `NaN` is passed straight through to `getBufferedEvents`. This relies on the registry method tolerating `NaN` (likely by treating it as "from start"). If the registry contract changes, the parse should validate.

## Verification

```bash
cd /Users/didi/fork/OpenSandbox/sandboxes/claude-agent-server && npm run build 2>&1 | tail -20
```

Output:
```
> claude-agent-server@1.0.0 build
> tsc -p tsconfig.json
```

Zero TypeScript errors. No lint or test runs were performed in this task (scoped to compile-clean per the parent agent's instructions).
