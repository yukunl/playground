import type { ChatRequest } from './chat'

/**
 * The exact body sent to /v1/chat/completions. Same input, same bytes: a retry
 * resends an identical request, which gives the inference server's prefix cache
 * its best chance to skip prefill.
 */
export function buildChatRequest({ settings, messages }: ChatRequest) {
  return {
    model: settings.model,
    messages: [...(settings.system ? [{ role: 'system' as const, content: settings.system }] : []), ...messages],
    temperature: settings.temperature,
    top_p: settings.topP,
    max_tokens: settings.maxTokens,
    ...(settings.stop.length > 0 ? { stop: settings.stop } : {}),
    ...(settings.seed !== undefined ? { seed: settings.seed } : {}),
    stream: true,
    // OpenAI-style APIs only report usage in a stream when asked.
    stream_options: { include_usage: true },
  }
}
