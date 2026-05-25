/**
 * Side-effect module that registers `.openapi(...)` metadata on Zod.
 * Import this once at the top of every other openapi file before using Zod.
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

extendZodWithOpenApi(z)
