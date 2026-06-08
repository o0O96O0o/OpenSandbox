# claude-agent-server — API reference

HTTP server wrapping the `@anthropic-ai/claude-agent-sdk`. All prompts use the SDK's **streaming input mode** — messages are delivered as async iterables, which enables rich content (images), live message injection into active runs, and priority-based queueing.

---

## Base URL

```
http://<HOST>:<PORT>        default: http://0.0.0.0:3000
```

---

## Authentication

Optional. Set `CLAUDE_AGENT_REQUIRE_AUTH_TOKEN=<token>` at startup.  
When set, every request must include:

```
Authorization: Bearer <token>
```

Requests without a valid token receive `401 Unauthorized`.

---

## Common error shape

All errors return JSON:

```json
{
  "error": {
    "message": "Human-readable description",
    "details": null
  }
}
```

Validation errors (`400`) return structured details:

```json
{
  "error": {
    "message": "Validation error",
    "details": [
      { "path": "options.permissionMode", "message": "Invalid enum value" }
    ]
  }
}
```

---

## Endpoints

### `GET /health`

Liveness check. No auth required.

**Response `200`**

```json
{
  "healthy": true,
  "service": "claude-agent-server",
  "host": "0.0.0.0",
  "port": 3000,
  "timestamp": "2026-04-17T12:00:00.000Z"
}
```

---

### `GET /sessions`

List persisted Claude Code sessions from the SDK store.

**Query parameters**

| Name | Type | Description |
|---|---|---|
| `dir` | string | Claude data directory override |
| `limit` | integer | Max sessions to return |
| `offset` | integer | Pagination offset |
| `includeWorktrees` | boolean | Include worktree sessions |

**Response `200`**

```json
{
  "sessions": [
    {
      "sessionId": "abc123",
      "summary": "...",
      "lastModified": "2026-04-17T12:00:00.000Z",
      "fileSize": 4096,
      "customTitle": null,
      "firstPrompt": "Hello",
      "gitBranch": "main",
      "cwd": "/home/user/project",
      "tag": null,
      "createdAt": "2026-04-17T11:00:00.000Z"
    }
  ]
}
```

---

### `POST /sessions`

Start a new Claude Code session by sending the first prompt. The session ID is
assigned by the SDK and returned in the response.

**Request body**

```json
{
  "prompt": "Explain this codebase",
  "stream": false,
  "includePartialMessages": false,
  "options": { }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | string or [content block array](#message-content) | yes | First user message. Plain string or a structured array of text and image blocks. |
| `stream` | boolean | no | Return SSE stream instead of a batch response |
| `includePartialMessages` | boolean | no | Include in-progress assistant messages in the stream |
| `options` | object | no | Per-request SDK options (see [Query options](#query-options)) |

**Response `201`** (non-stream)

```json
{
  "sessionId": "abc123",
  "result": { "subtype": "success", ... },
  "events": [ ... ]
}
```

**Response `200`** (stream, `"stream": true`)  
Content-Type: `text/event-stream`  
See [SSE events](#sse-events).

> **Client disconnect behavior:** closing the SSE connection does **not** abort the agent. The agent runs to completion. Use `POST /sessions/:sessionId/abort` to explicitly cancel. Reconnect with `GET /sessions/:sessionId/stream` to reattach.

---

### `GET /sessions/:sessionId`

Fetch metadata for a single session.

**Query parameters**

| Name | Type | Description |
|---|---|---|
| `dir` | string | Claude data directory override |

**Response `200`**

```json
{
  "session": {
    "sessionId": "abc123",
    "summary": "...",
    "lastModified": "2026-04-17T12:00:00.000Z",
    "fileSize": 4096,
    "customTitle": null,
    "firstPrompt": "Explain this codebase",
    "gitBranch": "main",
    "cwd": "/home/user/project",
    "tag": null,
    "createdAt": "2026-04-17T11:00:00.000Z",
    "runtime": null
  }
}
```

`runtime` is `null` when the session is idle, or:

```json
{
  "sessionId": "abc123",
  "status": "running",
  "startedAt": 1713355200000
}
```

**Errors:** `404` if the session does not exist.

---

### `GET /sessions/:sessionId/stream`

Reattach to a running session's SSE event stream. Replays buffered events from a cursor, then streams live events until the session finishes.

Use this after a client disconnect (browser refresh) to resume receiving events without losing the in-progress agent run.

**Query parameters**

| Name | Type | Description |
|---|---|---|
| `cursor` | integer | 0-based index of the last event the client received. Omit (or send `Last-Event-ID: 0`) to replay all buffered events. |

The standard `Last-Event-ID` request header is also accepted as an alternative to `?cursor=`.

**Response `200`**  
Content-Type: `text/event-stream`

Replays events `[cursor..]` from the in-memory buffer, then emits live events as they arrive. The stream closes after the session emits `session.completed`.

**Errors:**  
`409` if the session has no active run (already finished, never started, or unknown).

---

### `PATCH /sessions/:sessionId`

Rename a session and/or set its tag. At least one of `title` or `tag` is required.

**Request body**

```json
{
  "title": "My project refactor",
  "tag": "important",
  "dir": "/optional/override"
}
```

| Field | Type | Description |
|---|---|---|
| `title` | string | New custom title (non-empty) |
| `tag` | string \| null | Tag string, or `null` to clear |
| `dir` | string | Claude data directory override |

**Response `200`** — same shape as `GET /sessions/:sessionId`.

**Errors:** `400` if neither `title` nor `tag` is present; `404` if not found.

---

### `GET /sessions/:sessionId/messages`

Fetch the raw message log for a session from the SDK store.

**Query parameters**

| Name | Type | Description |
|---|---|---|
| `dir` | string | Claude data directory override |
| `limit` | integer | Max messages to return |
| `offset` | integer | Pagination offset |
| `includeSystemMessages` | boolean | Include system messages |

**Response `200`**

```json
{
  "messages": [
    {
      "type": "human",
      "uuid": "...",
      "sessionId": "abc123",
      "message": { ... },
      "parentToolUseId": null
    }
  ]
}
```

---

### `POST /sessions/:sessionId/messages`

Send a follow-up message to an existing session.

**Behavior depends on whether the session has an active run:**

- **Idle session** — starts a new query turn. Returns the result as JSON (`200`) or an SSE stream (`200`).
- **Active run** — injects the message into the running query via `streamInput`. Returns `202 { streamed: true }` immediately. The agent's response events flow through the **original** SSE stream that started the run — no new stream is opened.

**Request body**

```json
{
  "prompt": "Now add tests",
  "stream": false,
  "includePartialMessages": false,
  "forkSession": false,
  "priority": "next",
  "options": { }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | string or [content block array](#message-content) | yes | Follow-up message. Plain string or structured array of text and image blocks. |
| `stream` | boolean | no | Return SSE stream (idle sessions only) |
| `includePartialMessages` | boolean | no | Include partial assistant messages in stream |
| `forkSession` | boolean | no | Fork the session before sending (idle sessions only — creates a new session ID) |
| `priority` | `"now"` \| `"next"` \| `"later"` | no | Delivery priority when injecting into an active run. `"now"` interrupts current work; `"next"` queues after the current turn; `"later"` queues at the end. Default: SDK decides. |
| `options` | object | no | Per-request SDK options (see [Query options](#query-options)) |

**Response `202`** (active run — message injected)

```json
{
  "streamed": true,
  "sessionId": "abc123"
}
```

**Response `200`** (idle session, non-stream)

```json
{
  "sessionId": "abc123",
  "result": { "subtype": "success", ... },
  "events": [ ... ]
}
```

**Response `200`** (idle session, stream)  
Content-Type: `text/event-stream`  
See [SSE events](#sse-events).

> **Client disconnect behavior:** closing the SSE connection does **not** abort the agent. Use `POST /sessions/:sessionId/abort` to explicitly cancel. Reconnect with `GET /sessions/:sessionId/stream` to reattach.

**Errors:**  
`404` if the session does not exist.

---

### `POST /sessions/:sessionId/permissions/respond`

Resolve a pending tool permission request after receiving a `permission.requested` SSE event.
The SSE stream resumes immediately after this call.

**Request body**

```json
{
  "decision": "allow"
}
```

| Field | Type | Values | Description |
|---|---|---|---|
| `decision` | enum | `allow`, `deny` | Whether to let the tool execute |

**Response `200`**

```json
{
  "ok": true,
  "sessionId": "abc123",
  "decision": "allow"
}
```

**Errors:**  
`404` if no permission request is currently pending for the session (already resolved or timed out).

---

### `POST /sessions/:sessionId/questions/respond`

Answer a pending `AskUserQuestion` request after receiving a `question.asked` SSE event.
The SSE stream resumes immediately after this call.

**Request body**

```json
{
  "answers": {
    "How should I format the output?": "Summary",
    "Which sections should I include?": ["Introduction", "Conclusion"]
  }
}
```

| Field | Type | Description |
|---|---|---|
| `answers` | object | Map of question text → selected option label. For multi-select questions, pass an array of labels. |

**Response `200`**

```json
{
  "ok": true,
  "sessionId": "abc123"
}
```

**Errors:**  
`404` if no question is currently pending for the session (already resolved or timed out).

---

### `POST /sessions/:sessionId/abort`

Interrupt the active run for a session via `Query.interrupt()`.

**Response `200`**

```json
{
  "ok": true,
  "sessionId": "abc123",
  "previousStatus": "running"
}
```

**Errors:**  
`404` if the session does not exist at all;  
`409` if the session exists but has no active run.

---

### `POST /sessions/:sessionId/fork`

Fork a session into a new independent session via the SDK `forkSession` API.  
The original session is not modified.

**Request body**

```json
{
  "title": "New branch",
  "upToMessageId": "optional-message-uuid",
  "dir": "/optional/override"
}
```

| Field | Type | Description |
|---|---|---|
| `title` | string | Custom title for the new session |
| `upToMessageId` | string | Fork only up to (and including) this message |
| `dir` | string | Claude data directory override |

**Response `201`** — same shape as `GET /sessions/:sessionId`.

---

## Message content

The `prompt` field on `POST /sessions` and `POST /sessions/:sessionId/messages` accepts either a plain string or a structured array of content blocks.

### Plain text

```json
{ "prompt": "Explain this codebase" }
```

### Content blocks

Pass an array with any combination of `text` and `image` blocks:

```json
{
  "prompt": [
    { "type": "text", "text": "What does this diagram show?" },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "<base64-encoded bytes>"
      }
    }
  ]
}
```

**Image source types:**

| Source type | Fields | Description |
|---|---|---|
| `base64` | `media_type`, `data` | Inline image. `media_type` must be `image/jpeg`, `image/png`, `image/gif`, or `image/webp`. `data` is the base64-encoded bytes. |
| `url` | `url` | Remote image URL. |

---

## Query options

Accepted in `options` on `POST /sessions` and `POST /sessions/:sessionId/messages`:

| Field | Type | Default | Description |
|---|---|---|---|
| `cwd` | string | SDK default | Working directory for Claude Code |
| `model` | string | `CLAUDE_AGENT_DEFAULT_MODEL` env | Model identifier |
| `permissionMode` | enum | `CLAUDE_AGENT_DEFAULT_PERMISSION_MODE` env (`default`) | `default`, `acceptEdits`, `plan`, `dontAsk`, `auto` — **`bypassPermissions` is rejected** |
| `settingSources` | `("user"\|"project"\|"local")[]` | `["project","user","local"]` | Which Claude Code config files to load |
| `systemPrompt` | string | claude_code preset | Override the full system prompt |
| `appendSystemPrompt` | string | — | Append to the claude_code preset system prompt |
| `allowedTools` | string[] | — | Tool allow-list |
| `disallowedTools` | string[] | — | Tool deny-list |
| `additionalDirectories` | string[] | — | Extra directories Claude Code may access |
| `tools` | string[] \| `{type:"preset",preset:"claude_code"}` | claude_code preset | Custom tool set or preset |
| `maxTurns` | integer | SDK default | Maximum agentic turns before stopping |
| `enableFileCheckpointing` | boolean | `false` | Snapshot files before each tool execution, enabling `POST /sessions/:sessionId/rewind` |

---

### `POST /sessions/:sessionId/rewind`

Roll back file changes to the state at a prior user message turn.

**Requires:** the session must have been started (or resumed) with `options.enableFileCheckpointing: true`, and the session must currently have an active run.

**Request body**

```json
{
  "userMessageId": "<uuid-of-user-message>"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `userMessageId` | string | yes | UUID of the user message to rewind to |
| `dryRun` | boolean | no | If `true`, report what would change without modifying files |

**Response `200`**

```json
{
  "canRewind": true,
  "filesChanged": ["src/app.ts", "src/lib/config.ts"],
  "insertions": 12,
  "deletions": 8
}
```

| Field | Type | Description |
|---|---|---|
| `canRewind` | boolean | Whether the rewind was (or would be) possible |
| `filesChanged` | string[] | Paths of files that were (or would be) reverted |
| `insertions` | integer | Lines re-added |
| `deletions` | integer | Lines removed |
| `error` | string | Present when `canRewind` is `false` |

**Errors:**  
`400` if the request body is invalid;  
`404` if the session does not exist;  
`409` if the session has no active run.

---

### `GET /sessions/:sessionId/commands`

List the slash commands supported by the active Claude Code session.

**Requires:** an active run on the session.

**Response `200`**

```json
{
  "commands": [
    {
      "name": "compact",
      "description": "Summarize the conversation to free up context",
      "argumentHint": ""
    }
  ]
}
```

**Errors:** `404` if not found; `409` if no active run.

---

### `GET /sessions/:sessionId/models`

List the models available in the active session.

**Requires:** an active run on the session.

**Response `200`**

```json
{
  "models": [
    {
      "value": "claude-opus-4-5",
      "displayName": "Claude Opus 4.5",
      "description": "...",
      "supportsEffort": true,
      "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"]
    }
  ]
}
```

**Errors:**  
`404` if the session does not exist;  
`409` if the session has no active run.

---

### `GET /sessions/:sessionId/agents`

List the agents available in the active session.

**Requires:** an active run on the session.

**Response `200`**

```json
{
  "agents": [
    {
      "name": "default",
      "description": "Main Claude Code agent"
    }
  ]
}
```

**Errors:**  
`404` if the session does not exist;  
`409` if the session has no active run.

---

### `GET /sessions/:sessionId/context`

Return the context-window (token) usage breakdown for the active session.

**Requires:** an active run on the session.

**Response `200`**

```json
{
  "categories": [
    { "name": "System prompt", "tokens": 8192, "color": "#4a90d9" }
  ],
  "totalTokens": 24000,
  "maxTokens": 200000,
  "rawMaxTokens": 200000,
  "percentage": 12,
  "model": "claude-opus-4-5",
  "memoryFiles": []
}
```

**Errors:**  
`404` if the session does not exist;  
`409` if the session has no active run.

---

### `GET /sessions/:sessionId/subagents` *(not yet implemented)*

List subagent IDs that ran during the session. Returns `501 Not Implemented`.

---

### `GET /sessions/:sessionId/subagents/:agentId/messages` *(not yet implemented)*

Retrieve a subagent's message transcript. Returns `501 Not Implemented`.

---

### `PATCH /sessions/:sessionId/model` *(not yet implemented)*

Hot-swap the model on a running session. Returns `501 Not Implemented`.

---

### `PATCH /sessions/:sessionId/permission-mode` *(not yet implemented)*

Change the permission mode on a running session. Returns `501 Not Implemented`.

---

## SSE events

When `"stream": true`, the response is a `text/event-stream`.  
Each event has the format:

```
event: <event-name>
data: <JSON object>

```

### Event sequence

A typical successful prompt run emits events in roughly this order:

1. `session.init` — session opened, tools and model confirmed
2. `session.status` — status change (e.g. `running`)
3. `message.delta` *(repeated, only if `includePartialMessages: true`)* — streaming assistant token chunk
4. `task.started` *(optional)* — a sub-task (tool use) has started
5. `task.progress` *(repeated, optional)* — sub-task progress update
6. `task.notification` *(optional)* — sub-task completed
7. `permission.requested` *(optional)* — Claude needs approval before using a tool; **stream pauses**
8. `question.asked` *(optional)* — Claude is asking a clarifying question; **stream pauses**
9. `message.assistant` — complete assistant message
10. `result` — final result
11. `session.completed` — stream is finishing (added by the server, not the SDK)

Unrecognized SDK messages are forwarded as `message.raw`.

---

## Interactive events

Two SSE events cause the stream to **pause** mid-run, waiting for a client response. The session remains active and the SSE connection stays open; no new events are emitted until the client replies.

### Tool permission flow (`permission.requested`)

Claude needs your approval before executing a tool.

```
Server → client:  event: permission.requested
Client → server:  POST /sessions/:sessionId/permissions/respond
Server → client:  (stream resumes)
```

1. Receive `permission.requested` (see [event shape](#permissionrequested) below).
2. Display the tool name, input, and optional `blockedPath` / `decisionReason` to the user.
3. Collect the user's decision and call `POST /sessions/:sessionId/permissions/respond` with `{ "decision": "allow" | "deny" }`.
4. The stream resumes immediately.

If no response is sent within **5 minutes** the server auto-denies the request and the stream resumes with a timeout denial.

### Clarifying question flow (`question.asked`)

Claude has called `AskUserQuestion` to gather requirements before proceeding.

```
Server → client:  event: question.asked
Client → server:  POST /sessions/:sessionId/questions/respond
Server → client:  (stream resumes)
```

1. Receive `question.asked` (see [event shape](#questionasked) below).
2. For each question in the `questions` array, render the `question` text and its `options` (label + description).
   - If `multiSelect` is `true`, allow the user to pick multiple options.
   - Optionally show an "Other" free-text field; use the user's typed text as the answer value instead of any option `label`.
3. Build the `answers` map: key = `question` field, value = selected option `label` (or array of labels for multi-select).
4. Call `POST /sessions/:sessionId/questions/respond` with `{ "answers": { ... } }`.
5. The stream resumes with Claude's response to the answers.

If no response is sent within **5 minutes** the server auto-denies and Claude receives a denial.

---

### `session.init`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "cwd": "/home/user/project",
  "model": "claude-opus-4-5",
  "tools": [ ... ],
  "permissionMode": "default",
  "slashCommands": [ ... ],
  "skills": [ ... ],
  "mcpServers": [ ... ],
  "claudeCodeVersion": "1.x.x"
}
```

### `session.status`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "status": "running",
  "permissionMode": null,
  "compactResult": null,
  "compactError": null
}
```

### `message.assistant`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "text": "Here is the explanation…",
  "message": { "role": "assistant", "content": [ ... ] },
  "parentToolUseId": null,
  "error": null
}
```

### `message.delta`

Emitted only when `includePartialMessages: true`.

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "event": { ... },
  "parentToolUseId": null,
  "ttftMs": 312
}
```

### `task.started`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "taskId": "task-1",
  "description": "Reading file src/app.ts",
  "taskType": "tool_use",
  "toolUseId": "toolu_abc"
}
```

### `task.progress`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "taskId": "task-1",
  "description": "Reading file src/app.ts",
  "toolUseId": "toolu_abc",
  "usage": { ... },
  "lastToolName": "Read",
  "summary": null
}
```

### `task.notification`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "taskId": "task-1",
  "toolUseId": "toolu_abc",
  "status": "completed",
  "outputFile": null,
  "summary": "Read 120 lines",
  "usage": { ... }
}
```

### `permission.requested`

Emitted when Claude wants to use a tool that requires approval. **The stream pauses until `POST /sessions/:sessionId/permissions/respond` is called.**

```json
{
  "sessionId": "abc123",
  "toolName": "Bash",
  "toolInput": {
    "command": "rm -rf /tmp/old-build",
    "description": "Remove old build artifacts"
  },
  "toolUseId": "toolu_01XYZ",
  "blockedPath": "/tmp/old-build",
  "decisionReason": "Bash commands require approval"
}
```

| Field | Type | Description |
|---|---|---|
| `toolName` | string | Tool Claude wants to use (e.g. `Bash`, `Write`, `Edit`) |
| `toolInput` | object | Parameters Claude will pass to the tool |
| `toolUseId` | string | Unique identifier for this tool call in the assistant message |
| `blockedPath` | string \| null | File path that triggered the check, if applicable |
| `decisionReason` | string \| null | Explanation of why this check was triggered |

---

### `question.asked`

Emitted when Claude calls `AskUserQuestion` to gather requirements. **The stream pauses until `POST /sessions/:sessionId/questions/respond` is called.**

```json
{
  "sessionId": "abc123",
  "questions": [
    {
      "question": "How should I format the output?",
      "header": "Format",
      "options": [
        { "label": "Summary", "description": "Brief overview of key points" },
        { "label": "Detailed", "description": "Full explanation with examples" }
      ],
      "multiSelect": false
    },
    {
      "question": "Which sections should I include?",
      "header": "Sections",
      "options": [
        { "label": "Introduction", "description": "Opening context" },
        { "label": "Conclusion", "description": "Final summary" }
      ],
      "multiSelect": true
    }
  ]
}
```

Each question object:

| Field | Type | Description |
|---|---|---|
| `question` | string | Full question text to display to the user |
| `header` | string | Short label (max 12 chars), suitable for a chip or tag |
| `options` | array | 2–4 choices. Each has `label` (string) and `description` (string). May also have `preview` (HTML/markdown string) when the session was started with `toolConfig.askUserQuestion.previewFormat` set. |
| `multiSelect` | boolean | If `true`, the user may select multiple options |

The expected response `answers` object maps the `question` text to the selected option `label`:
- Single-select: `"How should I format the output?": "Summary"`
- Multi-select: `"Which sections should I include?": ["Introduction", "Conclusion"]`
- Free-text: use the user's typed text directly as the value

---

### `result`

```json
{
  "sessionId": "abc123",
  "uuid": "...",
  "subtype": "success",
  "isError": false,
  "result": "Final text output from Claude",
  "errors": null,
  "stopReason": "end_turn",
  "terminalReason": null,
  "durationMs": 4200,
  "durationApiMs": 3800,
  "numTurns": 3,
  "totalCostUsd": 0.0042
}
```

### `session.completed`

Terminal event emitted by the server at end-of-run. Always the last event in any SSE stream (original or reattached).

```json
{
  "sessionId": "abc123",
  "subtype": "success"
}
```

### `error`

Emitted if the server encounters an error during streaming.  
The stream closes immediately after.

```json
{
  "message": "Session abc123 already has an active run",
  "code": 409
}
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind address |
| `CLAUDE_AGENT_DEFAULT_MODEL` | *(SDK default)* | Default model for all prompts |
| `CLAUDE_AGENT_DEFAULT_PERMISSION_MODE` | `default` | Default permission mode (`default`, `acceptEdits`, `plan`, `dontAsk`, `auto`) |
| `CLAUDE_AGENT_DEFAULT_SETTING_SOURCES` | `project,user,local` | Comma-separated list of Claude config sources to load |
| `CLAUDE_AGENT_REQUIRE_AUTH_TOKEN` | *(unset)* | When set, require `Authorization: Bearer <token>` on all requests |
| `CLAUDE_AGENT_CONFIG_FILE` | `./config.json` | Override path to the startup config file (see [Config file](#config-file)) |
| `USERNAME` | *(unset)* | When set, appended to the S3 prefix to namespace sessions per user: `{prefix}/{USERNAME}/…` |

---

## Config file

The server optionally reads a `config.json` file at startup for infrastructure-level settings (e.g. session store). The file is Zod-validated; a malformed present file is a hard startup error. An absent file or missing `sessionStore` key is silently ignored — the server starts with local-disk session storage.

### Session store — S3 / S3-compatible

```jsonc
{
  "sessionStore": {
    "type": "s3",
    "bucket": "my-claude-sessions",       // required
    "prefix": "transcripts",              // optional, default ""
    "region": "us-east-1",               // optional, default "us-east-1"
    "endpoint": "http://localhost:9000",  // optional — for MinIO / S3-compatible stores
    "forcePathStyle": true,              // optional — required for most S3-compatible endpoints
    "credentials": {                     // optional — omit to use SDK credential chain (IAM/~/.aws)
      "accessKeyId": "...",
      "secretAccessKey": "..."
    }
  }
}
```

**IAM actions required:** `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`, `s3:DeleteObject` on the bucket and its contents.

**Key layout:** `{prefix}/{USERNAME}/{projectKey}/{sessionId}/part-{epochMs13}-{rand6}.jsonl` — `USERNAME` is injected automatically from the env var; subagent transcripts go one level deeper under `{sessionId}/{subpath}/`.

**Local testing with MinIO:**

```bash
docker run -d -p 9000:9000 minio/minio server /data
# create bucket
docker run --rm --network host minio/mc \
  sh -c 'mc alias set local http://localhost:9000 minioadmin minioadmin && mc mb local/test'

cat > config.json <<'EOF'
{
  "sessionStore": {
    "type": "s3",
    "bucket": "test",
    "endpoint": "http://localhost:9000",
    "forcePathStyle": true,
    "credentials": { "accessKeyId": "minioadmin", "secretAccessKey": "minioadmin" }
  }
}
EOF

npm run dev
```

---

## What's next

The following are not yet implemented:

### Dockerfile / container setup
The server is designed to run inside a container alongside Claude Code.  
A `Dockerfile` and `docker-compose.yml` are needed to:
- install Claude Code and the Node runtime
- copy and build the server
- expose the port
- set a default `ANTHROPIC_API_KEY` mount or env

### OpenAPI spec polish
The draft spec at `spec/openapi/claude-code-wrapper.openapi.json` needs:
- full request/response schemas aligned to the current implementation
- error response schemas for each status code
- concrete examples
- `components/schemas` reuse to avoid duplication

### `startup()` prewarming
The SDK exposes a `startup()` function to prewarm the Claude Code process.  
It has not been used yet. Calling it on server start could reduce first-prompt latency.

### Structured logging
All server output is currently `console.log`.  
A structured logger (e.g. `pino`) would help with filtering and observability in production.
