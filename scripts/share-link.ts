// Turns an agent's proposal (a JSON file) into a playground link: docs/agent-handoff.md.
//
//   npm run share-link -- proposal.json [--base https://playground.example/]
//
// The link is encoded the way the Share button encodes one, and checked against the
// schema the page uses to open it, so a link this prints is one the page accepts.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { encodeShare, LONG_LINK_CHARS, SharePayloadSchema, shareUrl, type SharePayload } from '../src/client/share/share-link'
import { DEFAULT_SETTINGS } from '../src/shared/chat'

const DEFAULT_BASE = 'http://localhost:3000/'

/**
 * Fills in what an agent may leave out (the version, the mode, any setting left at
 * its default), then checks the rest. Throws with every problem, in words.
 */
export function payloadFromJson(input: unknown): SharePayload {
  const filled =
    input && typeof input === 'object' && !Array.isArray(input)
      ? {
          v: 1,
          mode: 'setup',
          ...input,
          columns: Array.isArray((input as { columns?: unknown }).columns)
            ? (input as { columns: unknown[] }).columns.map((col) =>
                col && typeof col === 'object' && 'settings' in col && col.settings && typeof col.settings === 'object'
                  ? { ...col, settings: { ...DEFAULT_SETTINGS, ...col.settings } }
                  : col,
              )
            : (input as { columns?: unknown }).columns,
        }
      : input
  const parsed = SharePayloadSchema.safeParse(filled)
  if (!parsed.success) throw new Error(`The proposal isn't valid:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}

export async function linkFor(payload: SharePayload, base = DEFAULT_BASE): Promise<string> {
  const url = new URL(base)
  return shareUrl(await encodeShare(payload), { origin: url.origin, pathname: url.pathname })
}

async function main(args: string[]) {
  const baseAt = args.indexOf('--base')
  const base = baseAt >= 0 ? args[baseAt + 1] : (process.env.PLAYGROUND_URL ?? DEFAULT_BASE)
  const file = args.find((arg, i) => !arg.startsWith('--') && (baseAt < 0 || i !== baseAt + 1))
  if (!file || !base) {
    console.error('Usage: npm run share-link -- proposal.json [--base https://playground.example/]')
    process.exit(2)
  }
  const link = await linkFor(payloadFromJson(JSON.parse(await readFile(file, 'utf8'))), base)
  if (link.length > LONG_LINK_CHARS) console.error(`Note: the link is ${link.length} characters, and some apps cut long links off.`)
  console.log(link)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
