import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateOpenApiDocument } from '../src/openapi/generate.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const outPath = join(__dirname, '..', 'docs', 'openapi.json')

const doc = generateOpenApiDocument()
writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
console.log(`Wrote ${outPath}`)
