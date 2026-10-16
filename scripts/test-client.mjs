// Client test script for the NTPC bus route Worker.
//
// Usage:
//   node scripts/test-client.mjs                          // default route R28 dir 0
//   BASE_URL=https://ntpc-bus-query.sekewei.workers.dev node scripts/test-client.mjs
//
// Defaults to the local wrangler dev server (http://127.0.0.1:8787).

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8787'
const routeName = process.argv[2] ?? 'R28'
const direction = process.argv[3] ?? '0'

async function main() {
  const params = new URLSearchParams({
    city: 'NewTaipei',
    routeName,
    direction
  })

  const url = `${BASE_URL}/api/bus/route?${params.toString()}`
  console.log(`GET ${url}\n`)

  const started = Date.now()
  const res = await fetch(url)
  const ms = Date.now() - started
  const body = await res.json()

  console.log(`HTTP ${res.status} (${ms} ms)`)

  if (!res.ok) {
    console.log(JSON.stringify(body, null, 2))
    process.exit(1)
  }

  const { route, stops, generatedAt } = body
  console.log(
    `Route: ${route.routeName} (${route.routeId}) ` +
      `${route.directionLabel} ${route.departure ?? ''} -> ${route.destination ?? ''} ` +
      `[${route.provider ?? ''}]`
  )
  console.log(`Stops: ${stops.length}   generatedAt: ${generatedAt}\n`)

  console.log(pad('seq', 4) + pad('stopId', 10) + pad('remaining', 10) + 'stop')
  console.log('-'.repeat(60))

  for (const s of stops) {
    console.log(
      pad(String(s.sequence), 4) +
        pad(s.stopId, 10) +
        pad(s.remainingSeconds === null ? '-' : String(s.remainingSeconds), 10) +
        `${s.stopName} (${s.waitingTimeText})`
    )
  }
}

function pad(str, width) {
  let w = 0
  for (const ch of str) {
    w += ch.charCodeAt(0) > 0x2e7f ? 2 : 1
  }
  return str + ' '.repeat(Math.max(0, width - w))
}

main().catch((err) => {
  console.error('Request failed:', err.message)
  process.exit(1)
})
