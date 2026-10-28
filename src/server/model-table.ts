import type { ModelPricing } from '../shared/models'

// What we know about models that the API doesn't tell us. Parasail's /v1/models
// returns only `id`, `object` and `owned_by`: no names, prices, context sizes or
// capabilities, most models listed twice, and non-chat models mixed in.
// The real fix is for the API to return this metadata; until then, this table.

/**
 * Parasail list prices per million tokens, copied from https://www.parasail.io/pricing
 * on this date (the page has no date of its own). Shown in the UI as approximate.
 */
export const PRICES_AS_OF = '2026-10-24'

export type ModelEntry = {
  /** The ID we send upstream. */
  id: string
  /** Other IDs the live list uses for the same model; they collapse into this one. */
  aliases?: string[]
  name: string
  kind: 'chat' | 'embedding' | 'speech'
  pricing?: ModelPricing
  /** Only from an official source. Parasail publishes none today, so it's left out. */
  contextLength?: number
}

/** Chat models in the order the picker features them; the first live one is the default. */
export const MODEL_TABLE: ModelEntry[] = [
  {
    id: 'parasail-llama-33-70b-fp8',
    aliases: ['meta-llama/Llama-3.3-70B-Instruct'],
    name: 'Llama 3.3 70B',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.22, cacheReadPerMtokUsd: 0.11, outputPerMtokUsd: 0.5 },
  },
  {
    id: 'parasail-gpt-oss-120b',
    aliases: ['openai/gpt-oss-120b'],
    name: 'gpt-oss 120B',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.1, cacheReadPerMtokUsd: 0.055, outputPerMtokUsd: 0.75 },
  },
  {
    id: 'parasail-qwen3-235b-a22b-instruct-2507',
    aliases: ['Qwen/Qwen3-235B-A22B-Instruct-2507'],
    name: 'Qwen3 235B (2507)',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.14, cacheReadPerMtokUsd: 0.05, outputPerMtokUsd: 0.8 },
  },
  {
    id: 'parasail-deepseek-v4-flash',
    aliases: ['deepseek-ai/DeepSeek-V4-Flash'],
    name: 'DeepSeek V4 Flash',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.14, cacheReadPerMtokUsd: 0.07, outputPerMtokUsd: 0.28 },
  },
  {
    id: 'parasail-kimi-k26',
    aliases: ['moonshotai/Kimi-K2.6'],
    name: 'Kimi K2.6',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.75, cacheReadPerMtokUsd: 0.16, outputPerMtokUsd: 3.5 },
  },
  {
    id: 'parasail-gpt-oss-20b',
    aliases: ['openai/gpt-oss-20b'],
    name: 'gpt-oss 20B',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.04, cacheReadPerMtokUsd: 0.02, outputPerMtokUsd: 0.2 },
  },
  {
    id: 'parasail-mistral-small-32-24b',
    aliases: ['mistralai/Mistral-Small-3.2-24B-Instruct-2506'],
    name: 'Mistral Small 3.2 24B',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.09, cacheReadPerMtokUsd: 0.05, outputPerMtokUsd: 0.3 },
  },
  {
    id: 'parasail-gemma-4-31b-it',
    aliases: ['google/gemma-4-31B-it', 'google/gemma-4-31b-it'],
    name: 'Gemma 4 31B',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.15, cacheReadPerMtokUsd: 0.06, outputPerMtokUsd: 0.4 },
  },
  {
    id: 'parasail-qwen3-coder-next',
    aliases: ['Qwen/Qwen3-Coder-Next'],
    name: 'Qwen3 Coder Next',
    kind: 'chat',
    pricing: { inputPerMtokUsd: 0.12, cacheReadPerMtokUsd: 0.07, outputPerMtokUsd: 0.8 },
  },

  // Not chat models: listed so they're hidden from a chat playground.
  { id: 'parasail-bge-m3', aliases: ['BAAI/bge-m3'], name: 'BGE-M3', kind: 'embedding' },
  { id: 'parasail-resemble-tts-en', name: 'Resemble TTS (English)', kind: 'speech' },
]

/** For live models we don't know: IDs that look like embeddings, speech or rerankers are hidden too. */
export const NON_CHAT_ID = /(^|[-_/])(bge|embed|embedding|tts|whisper|rerank|reranker)([-_/]|$)/i
