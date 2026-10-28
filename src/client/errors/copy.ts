// All error wording lives here. The headline says what happened in
// a few plain words; the body is specific, with real values and what to do next.
// Button labels stay plain too.
import type { LucideIcon } from 'lucide-react'
import { Archive, CalendarClock, CircleAlert, Hourglass, Lock, Ruler, ServerOff, Timer, TriangleAlert, Unplug, WifiOff, Wrench } from 'lucide-react'
import type { ApiError } from '../../shared/api-error'
import { MAX_RETRIES } from '../chat/retry'

/** Who can fix it: the user, nobody (it fixes itself), or the playground's operators. */
export type Bucket = 'you' | 'itself' | 'us'

export type ErrorAction = 'retry' | 'switchModel' | 'newChat' | 'resetSetting' | 'copyDebugInfo'

export type ErrorCopy = {
  bucket: Bucket
  icon: LucideIcon
  headline: string
  body: string
  actions: ErrorAction[]
  /** Label for the retry button, when there is one. */
  retryLabel?: string
}

type Context = {
  /** Friendly model name: "Llama 3.3 70B". */
  model: string
  /** While waiting to retry: seconds left and which retry is coming. Null seconds = waiting to come back online. */
  retrying?: { seconds: number | null; retry: number }
  /** Tokens already on screen (for stream_interrupted). */
  tokens?: number
}

const STATUS_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

export function describeError(error: ApiError, ctx: Context): ErrorCopy {
  const d = error.details ?? {}
  const retries = typeof d.gaveUpAfterRetries === 'number' ? d.gaveUpAfterRetries : 0
  const seconds = typeof d.waitedMs === 'number' ? Math.max(1, Math.round(d.waitedMs / 1000)) : 0
  const countdown = ctx.retrying
    ? ctx.retrying.seconds === null
      ? ''
      : ` Retrying in ${ctx.retrying.seconds}s (retry ${ctx.retrying.retry} of ${MAX_RETRIES})…`
    : ''

  switch (error.type) {
    case 'invalid_request':
      return {
        bucket: 'you',
        icon: CircleAlert,
        headline: 'Invalid request',
        body: sentence(error.message),
        actions: typeof d.field === 'string' && d.field.startsWith('settings.') && d.field !== 'settings.model' ? ['resetSetting', 'retry'] : d.field === 'settings.model' ? ['switchModel'] : ['retry'],
        retryLabel: 'Try again',
      }

    case 'context_too_long':
      return {
        bucket: 'you',
        icon: Ruler,
        headline: 'Chat too long for this model',
        body: `This chat is longer than ${ctx.model} can read. ${sentence(error.message)} Switch to a model with a bigger context window, or start a new chat.`,
        actions: ['switchModel', 'newChat'],
      }

    case 'model_not_found':
      return {
        bucket: 'you',
        icon: Archive,
        headline: 'Model no longer available',
        body: `${ctx.model} is no longer available. Pick another model and run it again.`,
        actions: ['switchModel'],
      }

    case 'rate_limited':
      if (error.source === 'playground') {
        if (d.scope === 'daily_budget') {
          return {
            bucket: 'you',
            icon: CalendarClock,
            headline: 'Daily limit reached',
            body: 'The playground has reached today’s usage limit. It resets at 00:00 UTC.',
            actions: [],
          }
        }
        return {
          bucket: ctx.retrying ? 'itself' : 'you',
          icon: Timer,
          headline: 'Too many runs',
          body: `You’re sending runs faster than the playground allows.${countdown || ' Try again in a moment.'}`,
          actions: ctx.retrying ? [] : ['retry'],
        }
      }
      return {
        bucket: 'itself',
        icon: Hourglass,
        headline: 'Model is busy',
        body: ctx.retrying
          ? `${ctx.model} is getting more requests than it can handle right now.${countdown}`
          : `${ctx.model} was still too busy${retries ? ` after ${retries} ${retries === 1 ? 'retry' : 'retries'}` : ''}. Try again in a minute, or use another model.`,
        actions: ['retry', 'switchModel', 'copyDebugInfo'],
      }

    case 'inference_unavailable': {
      const cause =
        d.reason === 'timeout'
          ? 'didn’t start responding within 30 seconds'
          : d.reason === 'unreachable'
            ? 'couldn’t be reached'
            : d.reason === 'bad_response'
              ? 'sent a response the playground couldn’t read'
              : `didn’t respond${error.status ? ` (${error.status}${STATUS_TEXT[error.status] ? ` ${STATUS_TEXT[error.status]}` : ''})` : ''}`
      if (ctx.retrying) {
        return { bucket: 'itself', icon: ServerOff, headline: 'Model not responding', body: `${ctx.model} ${cause}.${countdown}`, actions: [] }
      }
      return {
        bucket: 'itself',
        icon: ServerOff,
        headline: 'Model unavailable',
        body: retries
          ? `${ctx.model} was unavailable for ${retries} ${retries === 1 ? 'retry' : 'retries'} over about ${seconds} seconds. The problem is on the model server, not in your request.`
          : `${ctx.model} ${cause}. The problem is on the model server, not in your request.`,
        actions: ['retry', 'switchModel', 'copyDebugInfo'],
      }
    }

    case 'network_error': {
      const offline = d.reason === 'offline' || (ctx.retrying && ctx.retrying.seconds === null)
      return {
        bucket: 'itself',
        icon: WifiOff,
        headline: offline ? 'You’re offline' : 'Can’t reach the playground',
        body: offline
          ? 'Your device seems to be offline. Your message will be sent as soon as you’re back online.'
          : `Couldn’t reach the playground server. Check your connection or VPN.${countdown}`,
        actions: ctx.retrying ? [] : ['retry'],
      }
    }

    case 'stream_interrupted': {
      const reasons: Record<string, string> = {
        closed_early: 'The model server closed the connection',
        stall: 'The model server stopped sending for 20 seconds',
        connection_lost: 'The connection to the model server was lost',
        upstream_error: 'The model server reported an error partway through',
        bad_chunk: 'The model server sent something unreadable',
        connection_dropped: 'Your connection to the playground dropped',
      }
      const why = reasons[String(d.reason)] ?? (error.source === 'network' ? reasons.connection_dropped : reasons.closed_early)
      // The server counts chunks (about 3 tokens each on the real API); the page estimates tokens from the text.
      const tokens = ctx.tokens
      return {
        bucket: 'itself',
        icon: Unplug,
        headline: 'Response interrupted',
        body: `${ctx.model}’s response stopped partway${tokens ? `, after about ${tokens} tokens` : ''}. ${why}${d.fault ? ' (a test fault)' : ''}. What arrived is kept above.`,
        actions: ['retry', 'copyDebugInfo'],
        retryLabel: 'Retry from the start',
      }
    }

    case 'service_misconfigured':
      return {
        bucket: 'us',
        icon: Wrench,
        headline: 'Playground setup problem',
        body: 'The playground couldn’t sign in to the inference API. That’s our problem; there’s nothing you need to change. Your message wasn’t sent to any model.',
        actions: ['copyDebugInfo'],
      }

    case 'unauthorized':
      return {
        bucket: 'you',
        icon: Lock,
        headline: 'Signed out',
        body: 'Your sign-in ended, or the playground’s password changed. Reload the page to sign in again. Your message wasn’t sent to any model.',
        actions: ['copyDebugInfo'],
      }

    case 'internal_error':
      return {
        bucket: 'us',
        icon: TriangleAlert,
        headline: 'Playground error',
        body: 'Something went wrong inside the playground. It’s a bug on our side, not your request.',
        actions: ['retry', 'copyDebugInfo'],
        retryLabel: 'Try again',
      }
  }
}

function sentence(text: string): string {
  const t = text.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}
