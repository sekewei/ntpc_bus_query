// Quick verification harness: runs the real src logic against the real CSVs.
// Usage: npx tsx scripts/verify-local.mjs
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBusData, parseEtaCsv, formatWaitingTime, CITY } from '../src/busData'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const routesCsv = readFileSync(resolve(root, 'design', 'bus_routes.csv'), 'utf8')
const stopsCsv = readFileSync(resolve(root, 'design', 'bus_stop.csv'), 'utf8')
const etaCsv = readFileSync(resolve(root, 'design', 'bus_eta.csv'), 'utf8')

const t0 = Date.now()
const data = buildBusData(routesCsv, stopsCsv)
const t1 = Date.now()
const etaMap = parseEtaCsv(etaCsv)
const t2 = Date.now()

console.log(`routes indexed: ${data.routeMetaMap.size}`)
console.log(`stop index keys: ${data.stopIndex.size}`)
console.log(`eta rows: ${etaMap.size}`)
console.log(`build: ${t1 - t0} ms, eta parse: ${t2 - t1} ms`)

function query(routeName, direction) {
  const routeIds = data.routeIndex.get(`${CITY}|${routeName}`)
  if (!routeIds) return { status: 404, error: 'ROUTE_NOT_FOUND' }
  if (routeIds.length > 1) return { status: 409, error: 'AMBIGUOUS_ROUTE', routeIds }

  const routeId = routeIds[0]
  const meta = data.routeMetaMap.get(routeId)
  const stops = data.stopIndex.get(`${routeId}|${direction}`) ?? []
  if (stops.length === 0) return { status: 404, error: 'NO_STOPS_FOR_DIRECTION' }

  const stopList = stops.map((s) => {
    const remaining = etaMap.get(`${routeId}|${direction}|${s.stopId}`) ?? null
    return {
      sequence: s.sequence,
      stopId: s.stopId,
      stopName: s.stopName,
      remainingSeconds: remaining,
      waitingTimeText: formatWaitingTime(remaining)
    }
  })

  return { status: 200, meta, stopList }
}

function show(label, result) {
  console.log(`\n=== ${label} ===`)
  if (result.status !== 200) {
    console.log(result)
    return
  }

  const { meta, stopList } = result
  console.log(`${meta.routeName} (${meta.routeId}) ${meta.departure} -> ${meta.destination} [${meta.provider}]`)
  console.log(`stops: ${stopList.length}`)

  for (const s of stopList.slice(0, 8)) {
    console.log(
      `  ${String(s.sequence).padStart(3)}  ${s.stopId}  ` +
        `${String(s.remainingSeconds ?? '-').padStart(5)}  ${s.stopName}  (${s.waitingTimeText})`
    )
  }

  if (stopList.length > 8) console.log(`  ... ${stopList.length - 8} more`)
}

// Keep this harness focused on the canonical R28 route used in smoke tests.
show('R28 dir 0', query('R28', 0))
show('R28 dir 1', query('R28', 1))
