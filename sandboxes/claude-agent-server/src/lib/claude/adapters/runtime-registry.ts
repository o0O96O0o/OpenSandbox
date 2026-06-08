import type { Query } from '@anthropic-ai/claude-agent-sdk'

import { HttpError } from '../../http/errors.js'
import type { NormalizedEvent } from './message-normalizer.js'

export type RuntimeStatus = 'running' | 'stopping'

type ActiveRun = {
  sessionId: string
  query: Query
  status: RuntimeStatus
  startedAt: number
  events: NormalizedEvent[]
  subscribers: Set<(event: NormalizedEvent) => void>
  completionPromise: Promise<void>
  _resolveCompletion: () => void
}

export class RuntimeRegistry {
  private readonly activeRuns = new Map<string, ActiveRun>()

  start(sessionId: string, query: Query) {
    if (this.activeRuns.has(sessionId)) {
      throw new HttpError(409, `Session ${sessionId} already has an active run`)
    }

    let resolve!: () => void
    const completionPromise = new Promise<void>((r) => {
      resolve = r
    })

    this.activeRuns.set(sessionId, {
      sessionId,
      query,
      status: 'running',
      startedAt: Date.now(),
      events: [],
      subscribers: new Set(),
      completionPromise,
      _resolveCompletion: resolve,
    })
  }

  ensureStarted(sessionId: string, query: Query) {
    if (!this.activeRuns.has(sessionId)) {
      this.start(sessionId, query)
    }
  }

  get(sessionId: string) {
    return this.activeRuns.get(sessionId) ?? null
  }

  /**
   * Returns the raw Query handle for a session if an active run exists.
   * Callers can use the handle to invoke Query methods such as
   * rewindFiles(), supportedCommands(), getContextUsage(), etc.
   */
  getQuery(sessionId: string): Query | null {
    return this.activeRuns.get(sessionId)?.query ?? null
  }

  async interrupt(sessionId: string) {
    const activeRun = this.activeRuns.get(sessionId)
    if (!activeRun) {
      throw new HttpError(404, `No active run found for session ${sessionId}`)
    }

    activeRun.status = 'stopping'
    await activeRun.query.interrupt()
  }

  finish(sessionId: string) {
    const activeRun = this.activeRuns.get(sessionId)
    if (activeRun) {
      activeRun._resolveCompletion()
    }
    this.activeRuns.delete(sessionId)
  }

  emit(sessionId: string, event: NormalizedEvent): void {
    const activeRun = this.activeRuns.get(sessionId)
    if (!activeRun) return

    activeRun.events.push(event)
    for (const subscriber of activeRun.subscribers) {
      subscriber(event)
    }
  }

  subscribe(sessionId: string, fn: (event: NormalizedEvent) => void): () => void {
    const activeRun = this.activeRuns.get(sessionId)
    if (!activeRun) {
      return () => {}
    }

    activeRun.subscribers.add(fn)
    return () => {
      activeRun.subscribers.delete(fn)
    }
  }

  getBufferedEvents(sessionId: string, afterIndex?: number): NormalizedEvent[] {
    const activeRun = this.activeRuns.get(sessionId)
    if (!activeRun) return []

    if (afterIndex !== undefined) {
      return activeRun.events.slice(afterIndex)
    }
    return [...activeRun.events]
  }

  getCompletionPromise(sessionId: string): Promise<void> | null {
    return this.activeRuns.get(sessionId)?.completionPromise ?? null
  }
}

export const runtimeRegistry = new RuntimeRegistry()
