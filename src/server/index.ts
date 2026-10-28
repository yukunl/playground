import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { loadConfig, type Config } from './config'

const CLIENT_DIR = './dist/client'
const SHUTDOWN_GRACE_MS = 30_000

// A local .env (not committed) fills in anything the environment doesn't set.
// Real environment variables win, so platform secrets always take precedence.
if (existsSync('.env')) process.loadEnvFile('.env')

let config: Config
try {
  config = loadConfig()
} catch (err) {
  console.error(JSON.stringify({ event: 'config_error', error: (err as Error).message }))
  process.exit(1)
}

const app = createApp({ config })

// After `npm run build`, the same process serves the page. Any path that isn't
// /api or a file falls back to index.html.
if (existsSync(`${CLIENT_DIR}/index.html`)) {
  app.use('/*', serveStatic({ root: CLIENT_DIR }))
  app.get('*', serveStatic({ path: `${CLIENT_DIR}/index.html` }))
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    JSON.stringify({
      event: 'server_started',
      port: info.port,
      version: config.version,
      upstream: config.parasailBaseUrl,
      upstreamKind: config.upstreamKind,
      faultsEnabled: config.faultsEnabled,
      passwordGate: Boolean(config.playgroundPassword),
    }),
  )
})

// On a deploy: stop taking new requests, let open streams finish, then exit.
function shutdown(signal: string) {
  console.log(JSON.stringify({ event: 'shutdown', signal }))
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
