# session-runner.ts — Registry emit wiring

## What was done

Modified `src/lib/claude/handlers/session-runner.ts` `execute()` function in three places to route events through `runtimeRegistry` so reattached SSE clients receive the same stream:

1. **Subscribe `onEvent` for newly-discovered sessions.** In the `if (discoveredSessionId && !registeredActiveRun)` branch (entered on the first iteration of the for-await loop when `input.sessionId` was not provided), added `if (onEvent) runtimeRegistry.subscribe(discoveredSessionId, onEvent)` after the `ensureStarted()` call. The pre-known-sessionId path (`if (input.sessionId)` block) already subscribes; this brings parity for new sessions.

2. **Replace direct `onEvent?.(event)` with registry emit.** Inside the for-await loop, the call that previously delivered each normalized event directly to the request callback now goes through `runtimeRegistry.emit(discoveredSessionId, event)` whenever a sessionId has been discovered. The original `onEvent?.(event)` is preserved as the `else` branch defensively, in case a normalized event arrives before a sessionId has been observed.

3. **Synthetic `session.completed` event.** After the for-await loop closes and before the `finally` block, when `discoveredSessionId` is set, emit a synthetic event `{ event: 'session.completed', data: { sessionId, subtype: finalResult?.subtype ?? null } }` through the registry. This is delivered to all subscribers (live and reattached) and is buffered before `finish()` clears the entry in the `finally` block.

The `input.signal` abort handling, the `canUseTool` permission/question event delivery, and all other behavior were left untouched.

## Deviations from plan

None. Edits match the spec exactly: identical placement, identical text, identical indentation.

## Verification

- `cd sandboxes/claude-agent-server && npm run build` reports zero errors in `src/lib/claude/handlers/session-runner.ts`.
- The four remaining build errors are all in `src/routes/sessions.ts` (`requestAbortSignal` and `logger` not found) — out of scope for this task and being handled by the parallel M2 agent updating that route file.
- `NormalizedEvent` is a structurally-typed `{ event: string; data: Record<string, unknown> }` (see `src/lib/claude/adapters/message-normalizer.ts:13`), so the synthetic `session.completed` event satisfies the type expected by `runtimeRegistry.emit()`.
- `runtimeRegistry.subscribe(sessionId, fn)` and `runtimeRegistry.emit(sessionId, event)` signatures (in `src/lib/claude/adapters/runtime-registry.ts:81` and `:91`) match the call sites.
