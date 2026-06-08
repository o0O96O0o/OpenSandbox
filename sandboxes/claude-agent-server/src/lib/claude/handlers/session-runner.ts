import {
  getSessionInfo,
  query,
  type Options,
  type PermissionMode,
  type SDKResultMessage,
  type SDKUserMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources'

import { config } from '../../config.js'
import { HttpError } from '../../http/errors.js'
import { logger } from '../../logger.js'
import { normalizeMessage, type NormalizedEvent } from '../adapters/message-normalizer.js'
import { runtimeRegistry } from '../adapters/runtime-registry.js'
import { type PromptContent, type QueryOptions } from '../adapters/schemas.js'
import { loadStartupConfig } from '../storage/config.js'
import { buildSessionStore } from '../storage/session-store.js'
import { permissionRegistry, questionRegistry } from './permission-handler.js'

function initSessionStore() {
  try {
    const cfg = loadStartupConfig()
    const store = buildSessionStore(cfg)
    if (store) {
      logger.info('session store: initialized')
    } else {
      logger.info('session store: no session store configured, sessions will not be persisted to S3')
    }
    return { store, flush: cfg.sessionStoreFlush }
  } catch (err) {
    logger.fatal({ err }, 'session store: failed to initialize — server cannot start')
    process.exit(1)
  }
}

const { store: sessionStore, flush: sessionStoreFlush } = initSessionStore()

export type ExecutePromptInput = {
  sessionId?: string
  prompt: PromptContent
  includePartialMessages?: boolean
  forkSession?: boolean
  options?: QueryOptions
  /** When the signal is aborted, the active query will be interrupted. */
  signal?: AbortSignal
}

export type ExecutePromptResult = {
  sessionId: string
  result: SDKResultMessage | null
  events: NormalizedEvent[]
}

function definedEntries<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined),
  )
}

function buildOptions(input: ExecutePromptInput): Options {
  const permissionMode = input.options?.permissionMode ?? config.defaultPermissionMode
  const settingSources = input.options?.settingSources ?? config.defaultSettingSources

  if (permissionMode === 'bypassPermissions' && !config.allowBypassPermissions) {
    throw new HttpError(400, 'permissionMode=bypassPermissions is not enabled in this server')
  }

  const systemPrompt = input.options?.systemPrompt
    ? input.options.systemPrompt
    : definedEntries({
      type: 'preset' as const,
      preset: 'claude_code' as const,
      append: input.options?.appendSystemPrompt,
    })

  return definedEntries({
    cwd: input.options?.cwd,
    model: input.options?.model ?? config.defaultModel,
    permissionMode: permissionMode as PermissionMode,
    settingSources: settingSources as SettingSource[],
    systemPrompt,
    allowedTools: input.options?.allowedTools,
    disallowedTools: input.options?.disallowedTools,
    additionalDirectories: input.options?.additionalDirectories,
    tools: input.options?.tools ?? { type: 'preset' as const, preset: 'claude_code' as const },
    includePartialMessages: input.includePartialMessages ?? false,
    maxTurns: input.options?.maxTurns,
    enableFileCheckpointing: input.options?.enableFileCheckpointing,
    persistSession: true,
    resume: input.sessionId,
    forkSession: input.sessionId ? input.forkSession : undefined,
  }) as Options
}

function toMessageParam(prompt: PromptContent): MessageParam {
  return {
    role: 'user',
    content: typeof prompt === 'string' ? prompt : (prompt as MessageParam['content']),
  }
}

async function* promptToStream(prompt: PromptContent): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: toMessageParam(prompt),
    parent_tool_use_id: null,
  }
}

export async function abortSession(sessionId: string) {
  const activeRun = runtimeRegistry.get(sessionId)

  if (!activeRun) {
    // Distinguish: session exists in the SDK but is idle vs. completely unknown
    const info = await getSessionInfo(sessionId).catch(() => null)
    if (!info) {
      throw new HttpError(404, `Session ${sessionId} not found`)
    }
    throw new HttpError(409, `Session ${sessionId} has no active run to abort`)
  }

  await runtimeRegistry.interrupt(sessionId)
  return { ok: true, sessionId, previousStatus: activeRun.status }
}

function ensureResult(result: SDKResultMessage | null, sessionId: string) {
  if (!result) {
    throw new HttpError(502, `Query for session ${sessionId} completed without a result message`)
  }
}

export async function execute(
  input: ExecutePromptInput,
  onEvent?: (event: NormalizedEvent) => void,
): Promise<ExecutePromptResult> {
  // Reject early if the session already has an active run and we are not forking
  if (input.sessionId && !input.forkSession && runtimeRegistry.get(input.sessionId)) {
    throw new HttpError(409, `Session ${input.sessionId} already has an active run`)
  }

  const queryHandle = query({
    prompt: promptToStream(input.prompt),
    options: {
      ...buildOptions(input),
      ...(sessionStore !== undefined ? {
        sessionStore,
        ...(sessionStoreFlush !== undefined ? { sessionStoreFlush } : {}),
      } : {}),
      stderr: (data) => {
        logger.warn({ data: data.trimEnd() }, 'claude stderr')
      },
      canUseTool: async (toolName, toolInput, options) => {
        const sid = discoveredSessionId ?? input.sessionId ?? 'unknown'

        if (toolName === 'AskUserQuestion') {
          return new Promise((resolve) => {
            const questions = ((toolInput as { questions?: unknown[] }).questions ?? []) as Record<string, unknown>[]
            onEvent?.({
              event: 'question.asked',
              data: { sessionId: sid, questions },
            })
            questionRegistry.register(sid, questions, (answers) => {
              resolve({ behavior: 'allow', updatedInput: { questions, answers } })
            })
            setTimeout(() => {
              if (questionRegistry.has(sid)) {
                questionRegistry.delete(sid)
                resolve({ behavior: 'deny', message: 'Question timed out' })
              }
            }, 5 * 60 * 1000)
          })
        }

        return new Promise((resolve) => {
          onEvent?.({
            event: 'permission.requested',
            data: {
              sessionId: sid,
              toolName,
              toolInput,
              toolUseId: options.toolUseID,
              blockedPath: options.blockedPath ?? null,
              decisionReason: options.decisionReason ?? null,
            },
          })
          permissionRegistry.register(sid, (decision) => {
            if (decision === 'allow') {
              resolve({ behavior: 'allow', updatedInput: toolInput })
            } else {
              resolve({ behavior: 'deny', message: 'User denied this action' })
            }
          })
          // Auto-deny after 5 minutes if no response
          setTimeout(() => {
            if (permissionRegistry.has(sid)) {
              permissionRegistry.delete(sid)
              resolve({ behavior: 'deny', message: 'Permission request timed out' })
            }
          }, 5 * 60 * 1000)
        })
      },
    },
  })

  let discoveredSessionId = input.sessionId ?? null
  let registeredActiveRun = false
  let finalResult: SDKResultMessage | null = null
  const events: NormalizedEvent[] = []

  if (input.sessionId) {
    runtimeRegistry.start(input.sessionId, queryHandle)
    registeredActiveRun = true
    if (onEvent) runtimeRegistry.subscribe(input.sessionId, onEvent)
  }

  function onSignalAbort() {
    void queryHandle.interrupt()
  }

  input.signal?.addEventListener('abort', onSignalAbort, { once: true })

  try {
    for await (const message of queryHandle) {
      const messageSessionId = typeof message.session_id === 'string' ? message.session_id : undefined

      if (!discoveredSessionId) {
        discoveredSessionId = messageSessionId ?? null
      }

      if (discoveredSessionId && !registeredActiveRun) {
        runtimeRegistry.ensureStarted(discoveredSessionId, queryHandle)
        registeredActiveRun = true
        if (onEvent) runtimeRegistry.subscribe(discoveredSessionId, onEvent)
      }

      const event = normalizeMessage(message)
      events.push(event)

      if (event.event === 'session.init') {
        logger.info(
          { sessionId: event.data.sessionId, model: event.data.model, permissionMode: event.data.permissionMode },
          'session initialized',
        )
      } else if (event.event === 'result') {
        logger.info(
          {
            sessionId: event.data.sessionId,
            subtype: event.data.subtype,
            isError: event.data.isError,
            durationMs: event.data.durationMs,
            totalCostUsd: event.data.totalCostUsd,
            numTurns: event.data.numTurns,
          },
          'session result',
        )
      }

      if (discoveredSessionId) {
        runtimeRegistry.emit(discoveredSessionId, event)
      } else {
        onEvent?.(event)
      }

      if (message.type === 'result') {
        finalResult = message
      }
    }

    if (discoveredSessionId) {
      runtimeRegistry.emit(discoveredSessionId, {
        event: 'session.completed',
        data: { sessionId: discoveredSessionId, subtype: finalResult?.subtype ?? null },
      })
    }
  } finally {
    input.signal?.removeEventListener('abort', onSignalAbort)

    if (discoveredSessionId) {
      runtimeRegistry.finish(discoveredSessionId)
    }

    queryHandle.close()
  }

  if (!discoveredSessionId) {
    throw new HttpError(502, 'Claude SDK did not emit a session ID')
  }

  ensureResult(finalResult, discoveredSessionId)

  return {
    sessionId: discoveredSessionId,
    result: finalResult,
    events,
  }
}

export async function streamMessageToSession(
  sessionId: string,
  prompt: PromptContent,
  priority?: 'now' | 'next' | 'later',
): Promise<void> {
  const queryHandle = runtimeRegistry.getQuery(sessionId)
  if (!queryHandle) {
    throw new HttpError(409, `Session ${sessionId} has no active run to stream into`)
  }

  const msg: SDKUserMessage = {
    type: 'user',
    message: toMessageParam(prompt),
    parent_tool_use_id: null,
    ...(priority !== undefined ? { priority } : {}),
  }

  await queryHandle.streamInput(
    (async function* () { yield msg })(),
  )
}
