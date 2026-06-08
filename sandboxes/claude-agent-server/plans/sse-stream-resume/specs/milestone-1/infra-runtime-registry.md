# RuntimeRegistry — EventBuffer Core

## What was done

The required event-buffer infrastructure was already present in `src/lib/claude/adapters/runtime-registry.ts`. Verified that the file matches the M1 plan exactly:

- Imports `NormalizedEvent` from `../message-normalizer.js` (line 4).
- `ActiveRun` type extended with `events`, `subscribers`, `completionPromise`, `_resolveCompletion` (lines 13-16). Note: `subscribers` is typed inline as `Set<(event: NormalizedEvent) => void>` rather than via a named `Subscriber` alias — equivalent in behavior, slightly different style than the plan suggested.
- `start()` initializes the four new fields and constructs the completion promise/resolver pair (lines 27-41).
- `finish()` resolves the completion promise before deleting the entry (lines 73-79).
- `emit(sessionId, event)` appends to the buffer and fans out to subscribers; no-op on unknown session (lines 81-89).
- `subscribe(sessionId, fn)` registers a subscriber and returns an unsubscribe closure; returns a no-op when session is unknown (lines 91-101).
- `getBufferedEvents(sessionId, afterIndex?)` returns a sliced or full copy of the buffer (lines 103-111).
- `getCompletionPromise(sessionId)` returns the promise or `null` (lines 113-115).

No other methods (`interrupt`, `get`, `getQuery`, `ensureStarted`) were modified.

## Deviations from plan

- The named `type Subscriber = (event: NormalizedEvent) => void` alias from step 2 of the plan was not introduced; the same function shape is used inline in the `ActiveRun` field and method signatures. Behaviorally identical; matches the existing inline-typing style elsewhere in the module.
- Inside `start()` the local variable holding the completion resolver is named `resolve` (not `resolveCompletion` as the plan snippet showed). The stored field is still `_resolveCompletion`, matching the plan's required public/internal contract.

## Verification

- `npm run build` (tsc -p tsconfig.json) completed with no output, meaning zero TypeScript errors across the project — including the modified file.
- No other files were touched in this milestone.
