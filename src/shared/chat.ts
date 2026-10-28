// What the browser sends to POST /api/chat. One zod schema checks it in both
// places: in the browser for instant feedback, on the server because anyone can
// call the API directly.
import { z } from 'zod'
import type { ModelPricing } from './models'
import type { Usage } from './stream-events'

export const MAX_OUTPUT_TOKENS = 4096

// The messages are written for people: the browser shows them under the field,
// and the server returns the same words if a request skips the browser.
const temperatureRange = 'Temperature must be between 0 and 2.'
const topPRange = 'Top-p must be between 0 and 1.'
const maxTokensRange = `Max tokens must be between 1 and ${MAX_OUTPUT_TOKENS}.`

export const SettingsSchema = z.object({
  model: z.string().min(1, 'Pick a model.').max(200),
  /** '' means no system message is sent. */
  system: z.string().max(100_000, 'The system prompt is limited to 100,000 characters.'),
  temperature: z.number({ error: 'Temperature must be a number.' }).min(0, temperatureRange).max(2, temperatureRange),
  topP: z.number({ error: 'Top-p must be a number.' }).min(0, topPRange).max(1, topPRange),
  maxTokens: z
    .number({ error: 'Max tokens must be a number.' })
    .int('Max tokens must be a whole number.')
    .min(1, maxTokensRange)
    .max(MAX_OUTPUT_TOKENS, maxTokensRange),
  stop: z
    .array(z.string().min(1, 'A stop sequence cannot be empty.').max(100, 'Each stop sequence is limited to 100 characters.'))
    .max(4, 'At most 4 stop sequences.'),
  seed: z.number({ error: 'Seed must be a number.' }).int('Seed must be a whole number.').optional(),
})
export type Settings = z.infer<typeof SettingsSchema>

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(400_000),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatRequestSchema = z.object({
  settings: SettingsSchema,
  messages: z
    .array(ChatMessageSchema)
    .min(1)
    .max(500)
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message must be from the user.'),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

export const DEFAULT_SETTINGS: Omit<Settings, 'model'> = {
  system: '',
  temperature: 0.7,
  topP: 1,
  maxTokens: 1024,
  stop: [],
}

/**
 * Prices are per million tokens. Prompt tokens served from the provider's cache
 * are charged at the cache-read rate when there is one.
 */
export function costUsd(usage: Usage | undefined, pricing: ModelPricing | null): number | null {
  if (!usage || !pricing) return null
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens)
  const cacheRate = pricing.cacheReadPerMtokUsd ?? pricing.inputPerMtokUsd
  return (
    ((usage.promptTokens - cached) * pricing.inputPerMtokUsd + cached * cacheRate + usage.completionTokens * pricing.outputPerMtokUsd) /
    1_000_000
  )
}
