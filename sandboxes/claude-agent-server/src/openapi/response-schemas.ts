/**
 * Zod definitions for every response/event/component schema referenced by the
 * OpenAPI spec. Names are kept identical to the existing component names in
 * `docs/openapi.json` so external consumers do not break when this file is
 * the source of truth for spec generation.
 *
 * Request-body / query-string schemas already live in
 * `src/lib/claude/handlers/schemas.ts` and `src/lib/claude/adapters/schemas.ts`
 * and are wired in via `registry.ts` — they are NOT redefined here.
 */
import './extend.js'

import { z } from 'zod'

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

export const HealthSchema = z
  .object({
    healthy: z.literal(true),
    service: z.string(),
    host: z.string(),
    port: z.number().int(),
    timestamp: z.string().datetime(),
  })
  .openapi('Health')

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

export const RuntimeSchema = z
  .object({
    sessionId: z.string().optional(),
    status: z.enum(['running', 'stopping']).optional(),
    startedAt: z.number().int().optional(),
  })
  .nullable()
  .openapi('Runtime')

export const SessionSchema = z
  .object({
    sessionId: z.string(),
    summary: z.string(),
    lastModified: z.number().int(),
    fileSize: z.number().int().nullable(),
    customTitle: z.string().nullable(),
    firstPrompt: z.string().nullable(),
    gitBranch: z.string().nullable(),
    cwd: z.string().nullable(),
    tag: z.string().nullable(),
    createdAt: z.number().int().nullable(),
  })
  .openapi('Session')

export const SessionWithRuntimeSchema = SessionSchema.extend({
  runtime: RuntimeSchema,
}).openapi('SessionWithRuntime')

export const SessionMessageSchema = z
  .object({
    type: z.enum(['user', 'assistant', 'system']),
    uuid: z.string(),
    sessionId: z.string(),
    message: z.unknown(),
    parentToolUseId: z.string().nullable(),
  })
  .openapi('SessionMessage')

// ---------------------------------------------------------------------------
// Anthropic content block (used inside SSE message.assistant events)
// ---------------------------------------------------------------------------

const anthropicTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

const anthropicToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
})

export const AnthropicContentBlockSchema = z
  .union([anthropicTextBlockSchema, anthropicToolUseBlockSchema])
  .openapi('AnthropicContentBlock')

// ---------------------------------------------------------------------------
// SSE events — discriminated by the `event` property
// ---------------------------------------------------------------------------

export const SseSessionInitEventSchema = z
  .object({
    event: z.literal('session.init'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      cwd: z.string(),
      model: z.string(),
      tools: z.array(z.string()),
      permissionMode: z.string(),
      slashCommands: z.array(z.string()),
      skills: z.array(z.string()),
      mcpServers: z.array(z.unknown()),
      claudeCodeVersion: z.string(),
    }),
  })
  .openapi('SseSessionInitEvent')

export const SseSessionStatusEventSchema = z
  .object({
    event: z.literal('session.status'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      status: z.string(),
      permissionMode: z.string().nullable(),
      compactResult: z.unknown(),
      compactError: z.unknown(),
    }),
  })
  .openapi('SseSessionStatusEvent')

export const SsePermissionRequestedEventSchema = z
  .object({
    event: z.literal('permission.requested'),
    data: z.object({
      sessionId: z.string(),
      toolName: z
        .string()
        .describe('Name of the tool requesting permission (e.g. Bash, Write, Edit)'),
      toolInput: z
        .record(z.string(), z.unknown())
        .describe('Parameters the tool would be called with'),
      toolUseId: z.string().describe('Unique identifier for this tool call within the assistant message'),
      blockedPath: z
        .string()
        .nullable()
        .describe('File path that triggered the permission check, if applicable'),
      decisionReason: z
        .string()
        .nullable()
        .describe('Explanation of why this permission check was triggered'),
    }),
  })
  .openapi('SsePermissionRequestedEvent', {
    description:
      'Emitted when the agent needs user approval to use a tool. The SSE stream pauses until POST /sessions/{sessionId}/permissions/respond is called.',
  })

const askedQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
  preview: z
    .string()
    .optional()
    .describe(
      'Optional HTML/markdown preview (only present when toolConfig.askUserQuestion.previewFormat is set)',
    ),
})

const askedQuestionSchema = z.object({
  question: z.string().describe('Full question text to display'),
  header: z.string().describe('Short label (max 12 chars)'),
  options: z.array(askedQuestionOptionSchema),
  multiSelect: z.boolean().describe('Whether multiple options can be selected'),
})

export const SseQuestionAskedEventSchema = z
  .object({
    event: z.literal('question.asked'),
    data: z.object({
      sessionId: z.string(),
      questions: z
        .array(askedQuestionSchema)
        .describe(
          'Questions Claude is asking. Each item has question, header, options (label+description), and multiSelect.',
        ),
    }),
  })
  .openapi('SseQuestionAskedEvent', {
    description:
      'Emitted when Claude calls AskUserQuestion. The SSE stream pauses until POST /sessions/{sessionId}/questions/respond is called with the user answers.',
  })

const assistantMessageSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  model: z.string(),
  content: z.array(AnthropicContentBlockSchema),
  stop_reason: z.string().nullable().optional(),
  stop_sequence: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().int().optional(),
      output_tokens: z.number().int().optional(),
      cache_creation_input_tokens: z.number().int().optional(),
      cache_read_input_tokens: z.number().int().optional(),
    })
    .optional(),
})

export const SseMessageAssistantEventSchema = z
  .object({
    event: z.literal('message.assistant'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      text: z.string().describe('Concatenated text from all text content blocks'),
      message: assistantMessageSchema.describe('Full Anthropic API message object'),
      parentToolUseId: z
        .string()
        .nullable()
        .describe('Set when this message is a sub-agent response triggered by a tool_use block'),
      error: z.unknown(),
    }),
  })
  .openapi('SseMessageAssistantEvent')

const messageDeltaInnerSchema = z.object({
  type: z.string(),
  index: z.number().int().optional(),
  delta: z
    .object({
      type: z.enum(['text_delta', 'input_json_delta']).optional(),
      text: z.string().optional().describe('Present when delta.type is text_delta'),
      partial_json: z.string().optional().describe('Present when delta.type is input_json_delta'),
    })
    .optional(),
})

export const SseMessageDeltaEventSchema = z
  .object({
    event: z.literal('message.delta'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      event: messageDeltaInnerSchema.describe(
        'Raw Anthropic stream event (content_block_start, content_block_delta, content_block_stop, message_delta, message_start, message_stop)',
      ),
      parentToolUseId: z.string().nullable(),
      ttftMs: z.number().int().nullable().describe('Time to first token in milliseconds'),
    }),
  })
  .openapi('SseMessageDeltaEvent', {
    description: 'Streaming delta — only emitted when includePartialMessages is true',
  })

export const SseResultEventSchema = z
  .object({
    event: z.literal('result'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      subtype: z.enum(['success', 'error_max_turns', 'error_during_execution']),
      isError: z.boolean(),
      result: z.string().nullable().describe('Final result text; populated when subtype is success'),
      errors: z
        .array(z.unknown())
        .nullable()
        .describe('Error objects; populated when subtype is not success'),
      stopReason: z.string(),
      terminalReason: z.string().nullable(),
      durationMs: z.number().int(),
      durationApiMs: z.number().int(),
      numTurns: z.number().int(),
      totalCostUsd: z.number(),
    }),
  })
  .openapi('SseResultEvent')

export const SseTaskStartedEventSchema = z
  .object({
    event: z.literal('task.started'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      taskId: z.string(),
      description: z.string(),
      taskType: z.string().nullable(),
      toolUseId: z.string().nullable(),
    }),
  })
  .openapi('SseTaskStartedEvent')

export const SseTaskProgressEventSchema = z
  .object({
    event: z.literal('task.progress'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      taskId: z.string(),
      description: z.string(),
      toolUseId: z.string().nullable(),
      usage: z.record(z.string(), z.unknown()),
      lastToolName: z.string().nullable(),
      summary: z.string().nullable(),
    }),
  })
  .openapi('SseTaskProgressEvent')

export const SseTaskNotificationEventSchema = z
  .object({
    event: z.literal('task.notification'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      taskId: z.string(),
      toolUseId: z.string().nullable(),
      status: z.string(),
      outputFile: z.unknown(),
      summary: z.string(),
      usage: z.unknown(),
    }),
  })
  .openapi('SseTaskNotificationEvent')

export const SseSessionCompletedEventSchema = z
  .object({
    event: z.literal('session.completed'),
    data: z.object({
      sessionId: z.string(),
      subtype: z.string().nullable(),
    }),
  })
  .openapi('SseSessionCompletedEvent')

export const SseErrorEventSchema = z
  .object({
    event: z.literal('error'),
    data: z.object({
      message: z.string(),
      code: z.number().int().describe('HTTP status code, default 500'),
    }),
  })
  .openapi('SseErrorEvent')

export const SseMessageRawEventSchema = z
  .object({
    event: z.literal('message.raw'),
    data: z.object({
      sessionId: z.string(),
      uuid: z.string(),
      message: z.unknown().describe('Raw unrecognized SDK message object'),
    }),
  })
  .openapi('SseMessageRawEvent', {
    description: 'Catch-all for unrecognized SDK message types',
  })

export const SseEventSchema = z
  .discriminatedUnion('event', [
    SseSessionInitEventSchema,
    SseSessionStatusEventSchema,
    SsePermissionRequestedEventSchema,
    SseQuestionAskedEventSchema,
    SseMessageAssistantEventSchema,
    SseMessageDeltaEventSchema,
    SseResultEventSchema,
    SseTaskStartedEventSchema,
    SseTaskProgressEventSchema,
    SseTaskNotificationEventSchema,
    SseSessionCompletedEventSchema,
    SseErrorEventSchema,
    SseMessageRawEventSchema,
  ])
  .openapi('SseEvent')

// ---------------------------------------------------------------------------
// Aggregate response shapes
// ---------------------------------------------------------------------------

export const StreamedMessageResponseSchema = z
  .object({
    streamed: z.literal(true),
    sessionId: z.string(),
  })
  .openapi('StreamedMessageResponse', {
    description:
      'Returned when a message is injected into an active streaming session via streamInput. The agent response flows through the original SSE stream.',
  })

export const PromptRunResponseSchema = z
  .object({
    sessionId: z.string(),
    result: z.unknown(),
    events: z.array(SseEventSchema),
  })
  .openapi('PromptRunResponse')

export const RewindResultSchema = z
  .object({
    canRewind: z.boolean(),
    filesChanged: z.array(z.string()).optional(),
    insertions: z.number().int().optional(),
    deletions: z.number().int().optional(),
    error: z.string().optional(),
  })
  .openapi('RewindResult')

export const SlashCommandSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    argumentHint: z.string(),
  })
  .openapi('SlashCommand')

export const ModelInfoSchema = z
  .object({
    value: z.string(),
    displayName: z.string(),
    description: z.string(),
    supportsEffort: z.boolean().optional(),
    supportedEffortLevels: z
      .array(z.enum(['low', 'medium', 'high', 'xhigh', 'max']))
      .optional(),
  })
  .openapi('ModelInfo')

export const AgentInfoSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
  })
  .openapi('AgentInfo')

export const ContextUsageCategorySchema = z
  .object({
    name: z.string(),
    tokens: z.number().int(),
    color: z.string(),
    isDeferred: z.boolean().optional(),
  })
  .openapi('ContextUsageCategory')

export const ContextUsageSchema = z
  .object({
    categories: z.array(ContextUsageCategorySchema),
    totalTokens: z.number().int(),
    maxTokens: z.number().int(),
    rawMaxTokens: z.number().int().optional(),
    percentage: z.number(),
    model: z.string(),
    memoryFiles: z
      .array(
        z.object({
          path: z.string().optional(),
          type: z.string().optional(),
          tokens: z.number().int().optional(),
        }),
      )
      .optional(),
  })
  .openapi('ContextUsage')

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorResponse')
