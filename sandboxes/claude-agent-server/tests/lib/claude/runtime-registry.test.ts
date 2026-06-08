import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'

import { RuntimeRegistry } from '../../../src/lib/claude/adapters/runtime-registry.js'
import type { NormalizedEvent } from '../../../src/lib/claude/adapters/message-normalizer.js'

function fakeQuery(): Query {
  return {
    interrupt: vi.fn(),
    streamInput: vi.fn(),
    close: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
  } as unknown as Query
}

function event(name: string): NormalizedEvent {
  return { event: name, data: { sessionId: 'sess-1' } }
}

describe('RuntimeRegistry', () => {
  describe('emit / getBufferedEvents', () => {
    it('buffers emitted events in order', () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())

      reg.emit('sess-1', event('a'))
      reg.emit('sess-1', event('b'))
      reg.emit('sess-1', event('c'))

      expect(reg.getBufferedEvents('sess-1')).toEqual([event('a'), event('b'), event('c')])
    })

    it('returns a slice when afterIndex is provided', () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())
      reg.emit('sess-1', event('a'))
      reg.emit('sess-1', event('b'))
      reg.emit('sess-1', event('c'))

      expect(reg.getBufferedEvents('sess-1', 2)).toEqual([event('c')])
      expect(reg.getBufferedEvents('sess-1', 1)).toEqual([event('b'), event('c')])
      expect(reg.getBufferedEvents('sess-1', 3)).toEqual([])
    })

    it('returns [] for unknown session', () => {
      const reg = new RuntimeRegistry()
      expect(reg.getBufferedEvents('unknown')).toEqual([])
    })

    it('is a no-op for unknown session', () => {
      const reg = new RuntimeRegistry()
      expect(() => reg.emit('unknown', event('x'))).not.toThrow()
    })
  })

  describe('subscribe / fan-out', () => {
    it('delivers emitted events to all subscribers', () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())
      const received1: NormalizedEvent[] = []
      const received2: NormalizedEvent[] = []

      reg.subscribe('sess-1', (e) => received1.push(e))
      reg.subscribe('sess-1', (e) => received2.push(e))

      reg.emit('sess-1', event('a'))
      reg.emit('sess-1', event('b'))

      expect(received1).toEqual([event('a'), event('b')])
      expect(received2).toEqual([event('a'), event('b')])
    })

    it('unsubscribe stops future deliveries', () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())
      const received: NormalizedEvent[] = []

      const unsub = reg.subscribe('sess-1', (e) => received.push(e))
      reg.emit('sess-1', event('a'))
      unsub()
      reg.emit('sess-1', event('b'))

      expect(received).toEqual([event('a')])
    })

    it('returns a no-op unsubscribe for unknown session', () => {
      const reg = new RuntimeRegistry()
      const unsub = reg.subscribe('unknown', () => {})
      expect(() => unsub()).not.toThrow()
    })
  })

  describe('completionPromise', () => {
    it('getCompletionPromise returns null for unknown session', () => {
      const reg = new RuntimeRegistry()
      expect(reg.getCompletionPromise('unknown')).toBeNull()
    })

    it('resolves when finish() is called', async () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())
      const promise = reg.getCompletionPromise('sess-1')!

      let resolved = false
      void promise.then(() => { resolved = true })

      expect(resolved).toBe(false)
      reg.finish('sess-1')
      await promise
      expect(resolved).toBe(true)
    })

    it('finish() removes the session from the registry', () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())
      expect(reg.get('sess-1')).not.toBeNull()
      reg.finish('sess-1')
      expect(reg.get('sess-1')).toBeNull()
    })
  })

  describe('disconnect-reconnect scenario', () => {
    it('buffers events during disconnect and delivers them on reconnect', async () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())

      // --- original SSE connection ---
      const originalEvents: NormalizedEvent[] = []
      let originalActive = true
      reg.subscribe('sess-1', (e) => { if (originalActive) originalEvents.push(e) })

      reg.emit('sess-1', event('e0'))
      reg.emit('sess-1', event('e1'))
      reg.emit('sess-1', event('e2'))

      // --- client disconnects (e.g. browser refresh) ---
      // active flag goes false; subscriber is now a noop
      originalActive = false
      const cursorAtDisconnect = reg.getBufferedEvents('sess-1').length // 3

      // agent keeps running and emits more events
      reg.emit('sess-1', event('e3'))
      reg.emit('sess-1', event('e4'))

      // original subscriber received nothing new after disconnect
      expect(originalEvents).toEqual([event('e0'), event('e1'), event('e2')])

      // --- client reconnects via GET /sessions/:id/stream?cursor=3 ---
      const reconnectEvents: NormalizedEvent[] = []
      let reconnectActive = true
      const completionPromise = reg.getCompletionPromise('sess-1')!

      // subscribe before replaying (mirrors route handler order)
      reg.subscribe('sess-1', (e) => { if (reconnectActive) reconnectEvents.push(e) })

      // replay buffered events from cursor
      const missed = reg.getBufferedEvents('sess-1', cursorAtDisconnect)
      for (const e of missed) reconnectEvents.push(e)

      // live event arrives after reconnect
      reg.emit('sess-1', event('e5'))

      // session finishes
      reg.emit('sess-1', event('session.completed'))
      reg.finish('sess-1')
      await completionPromise
      reconnectActive = false

      // reconnect stream received: replayed e3+e4, then live e5 and session.completed
      expect(reconnectEvents).toEqual([
        event('e3'),
        event('e4'),
        event('e5'),
        event('session.completed'),
      ])

      // full buffer has all 6 events + session.completed
      // (buffer was cleared by finish(), so we just confirm the promise resolved)
      expect(reg.get('sess-1')).toBeNull()
    })

    it('no duplicate events when subscriber is registered before replay', () => {
      const reg = new RuntimeRegistry()
      reg.start('sess-1', fakeQuery())

      reg.emit('sess-1', event('e0'))
      reg.emit('sess-1', event('e1'))

      // subscribe (future events go here)
      const received: NormalizedEvent[] = []
      reg.subscribe('sess-1', (e) => received.push(e))

      // replay all buffered events (cursor = 0)
      const buffered = reg.getBufferedEvents('sess-1', 0)
      for (const e of buffered) received.push(e)

      // one more live event
      reg.emit('sess-1', event('e2'))

      // e0 and e1 only appear once (from replay), e2 from live subscriber
      expect(received).toEqual([event('e0'), event('e1'), event('e2')])
    })
  })
})
