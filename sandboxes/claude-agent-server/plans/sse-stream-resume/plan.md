# SSE Stream Resume — Buffer Channel

## Overview

When a browser client disconnects mid-session (e.g. page refresh), the Claude agent currently gets
aborted. Instead, we want to:

1. Keep the agent running
2. Buffer all emitted events in memory while no client is attached
3. Expose a new `GET /sessions/:sessionId/stream` endpoint that replays buffered events from a cursor
   and then streams live events until the session finishes

The change is **breaking**: after this, a plain client disconnect no longer aborts the agent.
Callers must use `POST /sessions/:sessionId/abort` to explicitly cancel a run.

## Scope

**Included:**
- `RuntimeRegistry` gains: event buffer, multi-subscriber fan-out, completion promise
- `execute()` (session-runner) emits via registry instead of direct callback; agent is not aborted
  on client disconnect; emits a synthetic `session.completed` event at end-of-run via registry
- Both POST streaming handlers lose `requestAbortSignal`; use an `active` flag instead
- New `GET /sessions/:sessionId/stream` endpoint with `?cursor=` / `Last-Event-ID` support

**Excluded:**
- Session idle timeout / auto-abort (out of scope per user decision)
- Persisting the event buffer to disk/S3 (in-memory only; buffer is gone if server restarts)
- OpenAPI spec changes (follow-up)

## Milestones

### Milestone 1: EventBuffer core — RuntimeRegistry

**Goal:** Add event buffering, multi-subscriber fan-out, and a completion promise to RuntimeRegistry.
This milestone touches only one file and has no callers to update yet.

**Dependencies:** None

Tasks:
- [x] Task 1.1 — [infra] — Update `runtime-registry.ts` with buffer, subscribers, completion promise, emit/subscribe/getBufferedEvents/getCompletionPromise

### Milestone 2: Wire everything up

**Goal:** Update `session-runner.ts` and `routes/sessions.ts` to use the new registry APIs;
add the reconnect endpoint; verify the build passes.

**Dependencies:** Milestone 1

Tasks:
- [x] Task 2.1 — [backend] — Update `session-runner.ts`: emit via registry, subscribe onEvent, emit `session.completed` via registry, keep signal param but don't rely on it for disconnect
- [x] Task 2.2 — [backend] — Update `routes/sessions.ts`: remove `requestAbortSignal` from POST streaming branches, add `active` flag guard, add `GET /sessions/:sessionId/stream` endpoint
- [x] Task 2.3 — [verify] — Run `npm run build` and confirm no TypeScript errors — PASSED (zero errors)

## Domain Split

- `infra`: RuntimeRegistry (data structure only)
- `backend`: session-runner wiring + route handlers
- `verify`: TypeScript build check

## Risks & Open Questions

- The `session.completed` event is currently emitted by route handlers after `execute()` returns.
  Moving it inside `execute()` (via the registry) means route handlers no longer emit it — this
  is intentional and backward-compatible in payload shape.
- Buffer is in-memory: if the server process restarts, buffered events are lost. Client gets a
  stale cursor; they should fall back to `GET /sessions/:sessionId/messages` for history.

## Verification

- `npm run build` passes with zero TypeScript errors
- `RuntimeRegistry` unit tests (if any) still pass
- Manual: start a session via POST with stream:true, disconnect, reconnect via GET /:id/stream,
  confirm events from cursor are replayed and live events arrive
