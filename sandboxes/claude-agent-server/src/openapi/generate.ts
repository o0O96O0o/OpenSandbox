import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi'

import { registry } from './registry.js'

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.1',
    info: {
      title: 'claude-agent-server',
      version: '0.1.0',
      description:
        'Minimal HTTP wrapper around Claude Code using the stable Claude Agent SDK.',
    },
  })
}
