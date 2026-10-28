// Fails the build if anything that looks like a Parasail key ends up in the
// browser bundle. The server bundle is allowed to hold one; the page never is.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT_DIR = 'dist/client'
const KEY_PATTERN = /psk-[A-Za-z0-9]+-[A-Za-z0-9]+/

const offenders = []
for (const file of walk(CLIENT_DIR)) {
  if (KEY_PATTERN.test(readFileSync(file, 'utf8'))) offenders.push(file)
}

if (offenders.length > 0) {
  console.error(`check-bundle-secrets: found something shaped like a Parasail key in:\n  ${offenders.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-bundle-secrets: no Parasail keys in ${CLIENT_DIR}`)

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}
