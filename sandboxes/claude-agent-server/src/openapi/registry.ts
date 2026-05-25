/**
 * OpenAPIRegistry: registers every component schema (request + response) and
 * every path operation that mirrors `docs/openapi.json`.
 */
import './extend.js'

import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

import {
  contentBlockParamSchema,
  imageBlockParamSchema,
  permissionModeSchema,
  promptContentSchema,
  queryOptionsSchema,
  textBlockParamSchema,
} from '../lib/claude/adapters/schemas.js'
import {
  createSessionBodySchema,
  forkSessionBodySchema,
  patchSessionBodySchema,
  rewindSessionBodySchema,
  sendMessageBodySchema,
} from '../lib/claude/handlers/schemas.js'

import {
  AgentInfoSchema,
  AnthropicContentBlockSchema,
  ContextUsageCategorySchema,
  ContextUsageSchema,
  ErrorResponseSchema,
  HealthSchema,
  ModelInfoSchema,
  PromptRunResponseSchema,
  RewindResultSchema,
  RuntimeSchema,
  SessionMessageSchema,
  SessionSchema,
  SessionWithRuntimeSchema,
  SlashCommandSchema,
  SseErrorEventSchema,
  SseEventSchema,
  SseMessageAssistantEventSchema,
  SseMessageDeltaEventSchema,
  SseMessageRawEventSchema,
  SsePermissionRequestedEventSchema,
  SseQuestionAskedEventSchema,
  SseResultEventSchema,
  SseSessionCompletedEventSchema,
  SseSessionInitEventSchema,
  SseSessionStatusEventSchema,
  SseTaskNotificationEventSchema,
  SseTaskProgressEventSchema,
  SseTaskStartedEventSchema,
  StreamedMessageResponseSchema,
} from './response-schemas.js'

export const registry = new OpenAPIRegistry()

// ---------------------------------------------------------------------------
// Component schemas
// ---------------------------------------------------------------------------

// Top-level response component schemas (already tagged via .openapi('Name'))
registry.register('Health', HealthSchema)
registry.register('Runtime', RuntimeSchema)
registry.register('Session', SessionSchema)
registry.register('SessionWithRuntime', SessionWithRuntimeSchema)
registry.register('SessionMessage', SessionMessageSchema)
registry.register('AnthropicContentBlock', AnthropicContentBlockSchema)
registry.register('SseSessionInitEvent', SseSessionInitEventSchema)
registry.register('SseSessionStatusEvent', SseSessionStatusEventSchema)
registry.register('SsePermissionRequestedEvent', SsePermissionRequestedEventSchema)
registry.register('SseQuestionAskedEvent', SseQuestionAskedEventSchema)
registry.register('SseMessageAssistantEvent', SseMessageAssistantEventSchema)
registry.register('SseMessageDeltaEvent', SseMessageDeltaEventSchema)
registry.register('SseResultEvent', SseResultEventSchema)
registry.register('SseTaskStartedEvent', SseTaskStartedEventSchema)
registry.register('SseTaskProgressEvent', SseTaskProgressEventSchema)
registry.register('SseTaskNotificationEvent', SseTaskNotificationEventSchema)
registry.register('SseSessionCompletedEvent', SseSessionCompletedEventSchema)
registry.register('SseErrorEvent', SseErrorEventSchema)
registry.register('SseMessageRawEvent', SseMessageRawEventSchema)
registry.register('SseEvent', SseEventSchema)
registry.register('StreamedMessageResponse', StreamedMessageResponseSchema)
registry.register('PromptRunResponse', PromptRunResponseSchema)
registry.register('RewindResult', RewindResultSchema)
registry.register('SlashCommand', SlashCommandSchema)
registry.register('ModelInfo', ModelInfoSchema)
registry.register('AgentInfo', AgentInfoSchema)
registry.register('ContextUsageCategory', ContextUsageCategorySchema)
registry.register('ContextUsage', ContextUsageSchema)
registry.register('ErrorResponse', ErrorResponseSchema)

// Request/options schemas — shared with route handlers; only metadata is added
registry.register('TextBlockParam', textBlockParamSchema)
registry.register('ImageBlockParam', imageBlockParamSchema)
registry.register('ContentBlockParam', contentBlockParamSchema)
registry.register('PromptContent', promptContentSchema)
registry.register('QueryOptions', queryOptionsSchema)
registry.register('CreateSessionRequest', createSessionBodySchema)
registry.register('SendMessageRequest', sendMessageBodySchema)
registry.register('UpdateSessionRequest', patchSessionBodySchema)
registry.register('ForkSessionRequest', forkSessionBodySchema)
registry.register('RewindRequest', rewindSessionBodySchema)

// ---------------------------------------------------------------------------
// Reusable response components — emitted under `components.responses`
// ---------------------------------------------------------------------------

registry.registerComponent('responses', 'NotFound', {
  description: 'Session not found',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
})

registry.registerComponent('responses', 'Conflict', {
  description: 'Session has no active run (start a prompt first)',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
})

const notFoundRef = { $ref: '#/components/responses/NotFound' as const }
const conflictRef = { $ref: '#/components/responses/Conflict' as const }

// ---------------------------------------------------------------------------
// Reusable param Zod object factories
// ---------------------------------------------------------------------------

const sessionIdParams = z.object({ sessionId: z.string() })
const sessionAndAgentParams = z.object({ sessionId: z.string(), agentId: z.string() })

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/health',
  operationId: 'health.get',
  summary: 'Get server health',
  responses: {
    200: {
      description: 'Healthy response',
      content: { 'application/json': { schema: HealthSchema } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions',
  operationId: 'sessions.list',
  summary: 'List Claude sessions',
  request: {
    query: z.object({
      dir: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      offset: z.number().int().min(0).optional(),
      includeWorktrees: z.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Session list',
      content: {
        'application/json': {
          schema: z.object({ sessions: z.array(SessionSchema) }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions',
  operationId: 'sessions.create',
  summary: 'Create a new Claude session by sending the first prompt',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createSessionBodySchema } },
    },
  },
  responses: {
    201: {
      description: 'Created session and completed first run',
      content: { 'application/json': { schema: PromptRunResponseSchema } },
    },
    200: {
      description: 'SSE stream for first run',
      content: { 'text/event-stream': { schema: SseEventSchema } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}',
  operationId: 'sessions.get',
  summary: 'Get session metadata',
  request: {
    params: sessionIdParams,
    query: z.object({ dir: z.string().optional() }),
  },
  responses: {
    200: {
      description: 'Session metadata',
      content: {
        'application/json': {
          schema: z.object({ session: SessionWithRuntimeSchema }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/sessions/{sessionId}',
  operationId: 'sessions.update',
  summary: 'Rename or tag a session',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { 'application/json': { schema: patchSessionBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Updated session',
      content: {
        'application/json': {
          schema: z.object({ session: SessionWithRuntimeSchema }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/messages',
  operationId: 'sessions.messages.list',
  summary: 'Get session messages',
  request: {
    params: sessionIdParams,
    query: z.object({
      dir: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      offset: z.number().int().min(0).optional(),
      includeSystemMessages: z.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Session messages',
      content: {
        'application/json': {
          schema: z.object({ messages: z.array(SessionMessageSchema) }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/messages',
  operationId: 'sessions.messages.create',
  summary: 'Send a prompt or inject a message into an active session',
  description:
    "When the session is idle, starts a new query turn (batch or SSE). When the session has an active run, injects the message via streamInput and returns 202 — the agent's response events flow through the original SSE stream.",
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { 'application/json': { schema: sendMessageBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Completed prompt run or SSE stream',
      content: {
        'application/json': { schema: PromptRunResponseSchema },
        'text/event-stream': { schema: SseEventSchema },
      },
    },
    202: {
      description:
        'Message injected into active run — response events flow through the original SSE stream',
      content: {
        'application/json': { schema: StreamedMessageResponseSchema },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/abort',
  operationId: 'sessions.abort',
  summary: 'Interrupt an active session run',
  request: { params: sessionIdParams },
  responses: {
    200: {
      description: 'Abort acknowledged',
      content: {
        'application/json': {
          schema: z.object({ ok: z.literal(true) }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/fork',
  operationId: 'sessions.fork',
  summary: 'Fork a session into a new branch',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { 'application/json': { schema: forkSessionBodySchema } },
    },
  },
  responses: {
    201: {
      description: 'Forked session',
      content: {
        'application/json': {
          schema: z.object({ session: SessionWithRuntimeSchema }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/rewind',
  operationId: 'sessions.rewind',
  summary: 'Rewind file changes to a prior user message turn',
  description:
    'Rolls back file changes to the state at a specific user message. Requires the session to have been started with options.enableFileCheckpointing=true and to have an active run.',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { 'application/json': { schema: rewindSessionBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Rewind result',
      content: { 'application/json': { schema: RewindResultSchema } },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/commands',
  operationId: 'sessions.commands',
  summary: 'List slash commands supported by the active session',
  description:
    'Returns slash commands available in the running Claude Code process. Requires an active run.',
  request: { params: sessionIdParams },
  responses: {
    200: {
      description: 'Supported commands',
      content: {
        'application/json': {
          schema: z.object({ commands: z.array(SlashCommandSchema) }),
        },
      },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/models',
  operationId: 'sessions.models',
  summary: 'List models available in the active session',
  description:
    'Returns model info from the running Claude Code process. Requires an active run.',
  request: { params: sessionIdParams },
  responses: {
    200: {
      description: 'Available models',
      content: {
        'application/json': {
          schema: z.object({ models: z.array(ModelInfoSchema) }),
        },
      },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/agents',
  operationId: 'sessions.agents',
  summary: 'List agents available in the active session',
  description:
    'Returns agent info from the running Claude Code process. Requires an active run.',
  request: { params: sessionIdParams },
  responses: {
    200: {
      description: 'Available agents',
      content: {
        'application/json': {
          schema: z.object({ agents: z.array(AgentInfoSchema) }),
        },
      },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/context',
  operationId: 'sessions.context',
  summary: 'Get context-window token usage for the active session',
  description:
    'Returns a token usage breakdown by category. Requires an active run.',
  request: { params: sessionIdParams },
  responses: {
    200: {
      description: 'Context usage',
      content: { 'application/json': { schema: ContextUsageSchema } },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/subagents',
  operationId: 'sessions.subagents.list',
  summary: 'List subagents (not yet implemented)',
  request: { params: sessionIdParams },
  responses: {
    501: { description: 'Not implemented' },
  },
})

registry.registerPath({
  method: 'get',
  path: '/sessions/{sessionId}/subagents/{agentId}/messages',
  operationId: 'sessions.subagents.messages',
  summary: 'Get subagent messages',
  request: {
    params: sessionAndAgentParams,
    query: z.object({
      dir: z.string().optional(),
      limit: z.number().int().min(1).optional(),
      offset: z.number().int().min(0).optional(),
      includeSystemMessages: z.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Subagent messages',
      content: {
        'application/json': {
          schema: z.object({ messages: z.array(SessionMessageSchema) }),
        },
      },
    },
  },
})

registry.registerPath({
  method: 'patch',
  path: '/sessions/{sessionId}/model',
  operationId: 'sessions.setModel',
  summary: 'Hot-swap model on a running session',
  description: 'Changes the model on an active session. Requires an active run.',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ model: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Model updated',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.literal(true),
            sessionId: z.string(),
            model: z.string().optional(),
          }),
        },
      },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'patch',
  path: '/sessions/{sessionId}/permission-mode',
  operationId: 'sessions.setPermissionMode',
  summary: 'Change permission mode on a running session',
  description:
    'Changes the permission mode on an active session. bypassPermissions is rejected with 400. Requires an active run.',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ permissionMode: permissionModeSchema }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Permission mode updated',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.literal(true),
            sessionId: z.string(),
            permissionMode: z.string(),
          }),
        },
      },
    },
    400: {
      description: 'Bad request (e.g. bypassPermissions is not allowed)',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: notFoundRef,
    409: conflictRef,
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/permissions/respond',
  operationId: 'sessions.permissions.respond',
  summary: 'Respond to a pending tool permission request',
  description:
    'Resolves the paused canUseTool callback after a permission.requested SSE event. Returns 404 if no permission request is currently pending for the session.',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({ decision: z.enum(['allow', 'deny']) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Permission resolved',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.literal(true),
            sessionId: z.string(),
            decision: z.enum(['allow', 'deny']),
          }),
        },
      },
    },
    404: notFoundRef,
  },
})

registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/questions/respond',
  operationId: 'sessions.questions.respond',
  summary: 'Answer a pending AskUserQuestion request',
  description:
    'Resolves the paused AskUserQuestion canUseTool callback after a question.asked SSE event. Returns 404 if no question is currently pending for the session.',
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            answers: z
              .record(z.string(), z.union([z.string(), z.array(z.string())]))
              .describe(
                'Map of question text to selected option label(s). For multi-select questions, pass an array of labels.',
              ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Question answered',
      content: {
        'application/json': {
          schema: z.object({
            ok: z.literal(true),
            sessionId: z.string(),
          }),
        },
      },
    },
    404: notFoundRef,
  },
})
