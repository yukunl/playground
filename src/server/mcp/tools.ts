// The three tools the playground offers a coding agent over MCP (docs/connect-an-agent.md).
// The agent does the searching and the judging; the playground runs what it asks,
// measures it the way the page does, and turns its top choices into a link.
import { z } from 'zod'
import { encodeShare, LONG_LINK_CHARS, SharePayloadSchema, shareUrl, type SharePayload } from '../../client/share/share-link'
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../../shared/chat'
import type { Model } from '../../shared/models'
import { PRICES_AS_OF } from '../model-table'
import { measuredCompletion, type Completion, type Limiter } from './complete'
import type { UpstreamDeps } from '../upstream/client'

export const MAX_INPUTS_PER_RUN = 5

const SetupSchema = SettingsSchema.partial({ system: true, temperature: true, topP: true, maxTokens: true, stop: true }).describe(
  'A model ID from list_models and any settings to change. Unset settings take the playground defaults, the same ones the page starts with: no system prompt, temperature 0.7, top-p 1, max tokens 1024, no stop sequences, no seed. For answers you will compare with expected ones, use temperature 0.',
)

const RunInput = z.object({
  setup: SetupSchema,
  inputs: z
    .array(z.string().min(1).max(100_000))
    .min(1)
    .max(MAX_INPUTS_PER_RUN)
    .describe(`1 to ${MAX_INPUTS_PER_RUN} user messages. Each is sent on its own, as the first message of a new chat, with the system prompt before it.`),
})

const OpenInput = z.object({
  by: z.string().trim().min(1).max(40).describe('Your name, shown as "Proposed by …": for example "Claude Code" or "Codex".'),
  title: z.string().trim().min(1).max(120).describe('What the person is choosing between, in one line.'),
  summary: z
    .string()
    .trim()
    .max(2_000)
    .optional()
    .describe('What you tested and found: how many inputs, how many matched the expected answers, what it cost, what failed. Line breaks are kept.'),
  choices: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60).optional().describe('A short name, such as "Cheapest that matched 8 of 8".'),
        why: z.string().trim().max(1_000).optional().describe('Why this choice, with the numbers you measured.'),
        setup: SetupSchema,
      }),
    )
    .min(1)
    .max(2)
    .describe('Your top one or two setups. The first opens on the left (A), the second on the right (B).'),
  testQuestion: z.string().max(100_000).optional().describe('Goes in the message box, ready to run. Pick the input that best shows the difference.'),
})

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type ToolContext = {
  upstream: UpstreamDeps & { now: () => number }
  models: () => Promise<Model[]>
  limiter: Limiter
  /** Takes `count` runs from the caller's allowance; false when there aren't enough left. */
  allow: (count: number) => boolean
  requestId: string
  signal: AbortSignal
  /** The playground's address, for links. */
  origin: string
}

type Tool = {
  name: string
  title: string
  description: string
  input: z.ZodType
  annotations: { readOnlyHint: boolean; openWorldHint: boolean }
  call: (args: unknown, ctx: ToolContext) => Promise<ToolResult>
}

export const TOOLS: Tool[] = [
  {
    name: 'list_models',
    title: 'List models',
    description: "The Parasail models this playground can run, with their IDs and list prices per million tokens. Parasail's own model list has no prices; these come from the playground's table.",
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async call(_args, ctx) {
      const models = await ctx.models()
      return ok({
        models: models.map((m) => ({
          id: m.id,
          ...(m.name ? { name: m.name } : {}),
          pricePerMillionTokensUsd: m.pricing
            ? { input: m.pricing.inputPerMtokUsd, output: m.pricing.outputPerMtokUsd, ...(m.pricing.cacheReadPerMtokUsd ? { cachedInput: m.pricing.cacheReadPerMtokUsd } : {}) }
            : null,
        })),
        ...(models.some((m) => m.priceSource === 'table') ? { pricesAsOf: PRICES_AS_OF } : {}),
      })
    },
  },
  {
    name: 'run',
    title: 'Run a setup',
    description: `Runs one setup (model, system prompt, settings) on 1 to ${MAX_INPUTS_PER_RUN} inputs through the playground and returns each answer with the time to its first token, total time, tokens per second, token counts and cost at list prices, measured the way the playground page measures them. Calls run one or two at a time, and rate-limited calls are retried, so a call can take a while. You judge the answers; nothing is scored here.`,
    input: RunInput,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async call(args, ctx) {
      const parsed = RunInput.safeParse(args)
      if (!parsed.success) return toolError(z.prettifyError(parsed.error))
      const { setup, inputs } = parsed.data
      const model = await knownModel(ctx, setup.model)
      if (typeof model === 'string') return toolError(model)
      if (!ctx.allow(inputs.length)) return toolError("This agent token has used all its runs. Ask the person to make a new one in the playground: Agent → Make a token.")

      const settings: Settings = { ...DEFAULT_SETTINGS, ...setup }
      const results = await Promise.all(
        inputs.map((input, i) =>
          ctx.limiter.run(() => measuredCompletion(ctx.upstream, settings, input, model, { requestId: ctx.requestId, runId: `${ctx.requestId}_${i + 1}` }, ctx.signal)),
        ),
      )
      const costs = results.map((r) => r.costUsd)
      return ok(
        {
          settings,
          results: results.map((r, i) => ({ input: i + 1, ...r })),
          totalCostUsd: costs.every((c) => c !== null) ? costs.reduce<number>((sum, c) => sum + c, 0) : null,
        },
        results.every((r: Completion) => r.error),
      )
    },
  },
  {
    name: 'open_in_playground',
    title: 'Open in the playground',
    description:
      'Turns your top one or two setups into a playground link for the person. It opens them side by side in Compare, with your title, summary and reasons above them as your claims, and the test question in the message box. Nothing runs until they press ⌘↵ (Ctrl+Enter), so the answers they see are live, not yours. Give them the link.',
    input: OpenInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    async call(args, ctx) {
      const parsed = OpenInput.safeParse(args)
      if (!parsed.success) return toolError(z.prettifyError(parsed.error))
      const { by, title, summary, choices, testQuestion } = parsed.data
      for (const choice of choices) {
        const model = await knownModel(ctx, choice.setup.model)
        if (typeof model === 'string') return toolError(model)
      }

      const payload: SharePayload = {
        v: 1,
        mode: 'setup',
        proposal: { by, title, ...(summary ? { summary } : {}) },
        columns: choices.map((choice) => ({
          settings: { ...DEFAULT_SETTINGS, ...choice.setup },
          ...(choice.label ? { label: choice.label } : {}),
          ...(choice.why ? { why: choice.why } : {}),
        })),
        ...(testQuestion?.trim() ? { draft: testQuestion } : {}),
      }
      // The same check the page makes when it opens the link.
      const checked = SharePayloadSchema.safeParse(payload)
      if (!checked.success) return toolError(z.prettifyError(checked.error))
      const url = shareUrl(await encodeShare(checked.data), { origin: ctx.origin, pathname: '/' })
      const long = url.length > LONG_LINK_CHARS
      return {
        content: [
          {
            type: 'text',
            text:
              `Give the person this link. It opens ${choices.length === 2 ? 'both choices side by side' : 'your choice'} with your claims above, and ⌘↵ runs ${choices.length === 2 ? 'them' : 'it'} live:\n${url}` +
              (long ? `\n\nThe link is ${url.length} characters; some apps cut long links off, so paste it whole.` : ''),
          },
        ],
        structuredContent: { url, characters: url.length },
      }
    },
  },
]

/** The model, or what to tell the agent if it isn't one this playground lists. */
async function knownModel(ctx: ToolContext, id: string): Promise<Model | string> {
  const models = await ctx.models()
  return models.find((m) => m.id === id) ?? `Unknown model: ${id}. Call list_models for the IDs this playground can run.`
}

function ok(structured: Record<string, unknown>, isError = false): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured, ...(isError ? { isError } : {}) }
}

function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** What tools/list sends: JSON Schema made from the same zod schemas the calls are checked with. */
export function toolDefinitions() {
  return TOOLS.map(({ name, title, description, input, annotations }) => {
    const { $schema: _, ...inputSchema } = z.toJSONSchema(input, { io: 'input' }) as Record<string, unknown>
    return { name, title, description, inputSchema, annotations }
  })
}
