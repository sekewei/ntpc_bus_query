import { parseCsv } from './csv'

export const CITY = 'NewTaipei'

export interface RouteMeta {
  routeId: string
  routeName: string
  routeNameEn: string
  departure: string
  destination: string
  provider: string
}

export interface StopMeta {
  routeId: string
  stopId: string
  stopName: string
  stopNameEn: string
  sequence: number
  direction: number
}

export interface BusData {
  /** key: `${city}|${routeName}` -> routeId[] */
  routeIndex: Map<string, string[]>
  /** key: routeId -> RouteMeta */
  routeMetaMap: Map<string, RouteMeta>
  /** key: `${routeId}|${direction}` -> stops sorted by seqno */
  stopIndex: Map<string, StopMeta[]>
  loadedAt: string
}

// Normalize user input so route names like "紅28", "R28", "r28", and "red 28" all resolve.
export function normalizeRouteAlias(value: string): string {
  const text = value
    .trim()
    .replace(/[（）()]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()

  // Common color names used by users for bus lines, e.g. "red 28" -> "r28"
  return text
    .replace(/^red$/, 'r')
    .replace(/^blue$/, 'b')
    .replace(/^green$/, 'g')
    .replace(/^orange$/, 'o')
    .replace(/^yellow$/, 'y')
    .replace(/^purple$/, 'p')
    .replace(/^brown$/, 'br')
    .replace(/^black$/, 'k')
    .replace(/^silver$/, 's')
    .replace(/^white$/, 'w')
    .replace(/^gray$/, 'g')
    .replace(/^grey$/, 'g')
}

// Register the canonical route name as well as common alias variants in the lookup index.
function addRouteAlias(routeIndex: Map<string, string[]>, cityKey: string, routeId: string): void {
  const keys = new Set<string>([cityKey])

  const parts = cityKey.split('|')
  const routeName = parts[1] ?? ''
  if (routeName) {
    keys.add(`${parts[0]}|${normalizeRouteAlias(routeName)}`)
    keys.add(`${parts[0]}|${routeName.replace(/\s+/g, '')}`)
    keys.add(`${parts[0]}|${routeName.toLowerCase()}`)
  }

  for (const key of keys) {
    const bucket = routeIndex.get(key) ?? []
    if (!bucket.includes(routeId)) bucket.push(routeId)
    routeIndex.set(key, bucket)
  }
}

function clean(value: unknown): string {
  const s = String(value ?? '').trim()
  // The NTPC feed uses a single space " " as a null placeholder
  return s === ' ' ? '' : s
}

/**
 * Build the in-memory indexes from the two static CSV payloads
 * (bus_routes.csv and bus_stop.csv).
 */
// Build the immutable route stop model used by the API:
// - routeIndex: route name -> routeId[]
// - routeMetaMap: routeId -> metadata
// - stopIndex: routeId + direction -> stop list sorted by seqno
export function buildBusData(routesCsv: string, stopsCsv: string): BusData {
  const routeIndex = new Map<string, string[]>()
  const routeMetaMap = new Map<string, RouteMeta>()
  const stopIndex = new Map<string, StopMeta[]>()

  const routeRows = parseCsv(routesCsv)
  for (const row of routeRows) {
    const routeId = clean(row.id)
    const routeName = clean(row.namezh)
    if (!routeId || !routeName) continue

    const cityKey = `${CITY}|${routeName}`
    addRouteAlias(routeIndex, cityKey, routeId)

    const englishName = clean(row.nameen)
    if (englishName) {
      addRouteAlias(routeIndex, `${CITY}|${englishName}`, routeId)
    }

    routeMetaMap.set(routeId, {
      routeId,
      routeName,
      routeNameEn: clean(row.nameen),
      departure: clean(row.departurezh),
      destination: clean(row.destinationzh),
      provider: clean(row.providername)
    })
  }

  const stopRows = parseCsv(stopsCsv)
  for (const row of stopRows) {
    const routeId = clean(row.routeid)
    const stopId = clean(row.id)
    if (!routeId || !stopId) continue

    const direction = Number(clean(row.goback))
    const stopKey = `${routeId}|${direction}`
    if (!stopIndex.has(stopKey)) stopIndex.set(stopKey, [])

    stopIndex.get(stopKey)!.push({
      routeId,
      stopId,
      stopName: clean(row.namezh),
      stopNameEn: clean(row.nameen),
      sequence: Number(clean(row.seqno)) || 0,
      direction
    })
  }

  // Sort each direction's stop list by seqno once, at init time.
  for (const stopKey of stopIndex.keys()) {
    const stops = stopIndex.get(stopKey) ?? []
    stops.sort((a, b) => a.sequence - b.sequence)
    stopIndex.set(stopKey, stops)
  }

  return {
    routeIndex,
    routeMetaMap,
    stopIndex,
    loadedAt: new Date().toISOString()
  }
}

/**
 * Parse the live ETA CSV (routeid,stopid,estimatetime,goback) into a map.
 * key: `${routeId}|${direction}|${stopId}` -> seconds (null when no data)
 */
export function parseEtaCsv(
  etaCsv: string
): Map<string, number | null> {
  const etaMap = new Map<string, number | null>()
  const rows = parseCsv(etaCsv)
  for (const row of rows) {
    const routeId = clean(row.routeid)
    const stopId = clean(row.stopid)
    const goback = clean(row.goback)
    if (!routeId || !stopId || goback === '') continue

    const raw = Number(clean(row.estimatetime))
    const value = Number.isFinite(raw) && raw >= 0 ? raw : null
    etaMap.set(`${routeId}|${goback}|${stopId}`, value)
  }
  return etaMap
}

/** Human readable waiting time text. */
export function formatWaitingTime(seconds: number | null): string {
  if (seconds === null) return '無即時資訊'
  if (seconds <= 60) return '即將到站'
  const minutes = Math.ceil(seconds / 60)
  return `約 ${minutes} 分鐘`
}
