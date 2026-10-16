// Upload the static CSV payloads (bus_routes.csv, bus_stop.csv) to the Worker
// as secrets, then deploy.
//
// Usage:
//   node scripts/upload.mjs            // upload secrets + deploy
//   node scripts/upload.mjs --no-deploy // upload secrets only
//
// The CSV files are read from ./design by default. Override with:
//   ROUTES_CSV=... STOPS_CSV=... node scripts/upload.mjs

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const routesCsv = process.env.ROUTES_CSV ?? resolve(root, 'design', 'bus_routes.csv')
const stopsCsv = process.env.STOPS_CSV ?? resolve(root, 'design', 'bus_stop.csv')
const deploy = !process.argv.includes('--no-deploy')

function readCsv(path) {
  const text = readFileSync(path, 'utf8')
  const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)
  console.log(`[upload] ${path} (${kb} KB)`)
  return text
}

function putSecret(name, value) {
  execFileSync('npx', ['wrangler', 'secret', 'put', name, '--name', 'ntpc-bus-query'], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
    cwd: root
  })
  console.log(`[upload] secret ${name} updated`)
}

console.log('[upload] reading CSV files...')
putSecret('BUS_ROUTES_CSV', readCsv(routesCsv))
putSecret('BUS_STOP_CSV', readCsv(stopsCsv))

if (deploy) {
  console.log('[upload] deploying worker...')
  execFileSync('npx', ['wrangler', 'deploy'], {
    stdio: 'inherit',
    cwd: root
  })
  console.log('[upload] done')
} else {
  console.log('[upload] secrets uploaded (skipped deploy)')
}
