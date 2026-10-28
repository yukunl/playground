import type { Model } from '../shared/models'

const WORDS: Record<string, string> = {
  llama: 'Llama',
  mixtral: 'Mixtral',
  mistral: 'Mistral',
  qwen: 'Qwen',
  coder: 'Coder',
  gemma: 'Gemma',
  deepseek: 'DeepSeek',
  whisper: 'Whisper',
  large: 'Large',
}

/** The name to show: ours from the model table when we know the model, otherwise one made from the ID. */
export function modelName(model: Model | undefined, id: string): string {
  return model?.name ?? displayName(id)
}

/**
 * A readable name from an ID; the raw ID is always shown next to it.
 * "parasail-llama-3.1-70b-instruct" → "Llama 3.1 70B"; "meta-llama/Llama-3.3-70B-Instruct" → "Llama 3.3 70B Instruct".
 */
export function displayName(id: string): string {
  if (id.includes('/')) return (id.split('/').pop() ?? id).replace(/[-_]+/g, ' ')
  return id
    .replace(/^parasail-/, '')
    .split('-')
    .filter((word) => word !== 'instruct')
    .map((word) => WORDS[word] ?? (/^\d+(x\d+)?(\.\d+)?b$/i.test(word) ? word.toUpperCase().replace('X', 'x') : word))
    .join(' ')
}

/** 131072 → "131k". */
export function formatContext(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

export function formatPricing(model: Model): string | null {
  if (!model.pricing) return null
  const f = (n: number) => `$${n.toFixed(2)}`
  return `${f(model.pricing.inputPerMtokUsd)} / ${f(model.pricing.outputPerMtokUsd)} per M`
}

/** Every word of the query must appear in the ID or the friendly name: "70b", "llama 8", "coder". */
export function matchesQuery(model: Model, query: string): boolean {
  const haystack = `${model.id} ${modelName(model, model.id)} ${displayName(model.id)}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}
