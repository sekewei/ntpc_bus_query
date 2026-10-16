import {
  BusData,
  CITY,
  buildBusData,
  formatWaitingTime,
  normalizeRouteAlias,
  parseEtaCsv
} from './busData'

export interface Env {
  ENVIRONMENT: string
  /** bus_routes.csv content, optionally uploaded via `wrangler secret` */
  BUS_ROUTES_CSV?: string
  /** bus_stop.csv content, optionally uploaded via `wrangler secret` */
  BUS_STOP_CSV?: string
  /** Route CSV endpoint override */
  ROUTE_CSV_URL?: string
  /** Stop CSV endpoint override */
  STOP_CSV_URL?: string
  /** Live ETA CSV endpoint (NTPC open data) */
  ETA_CSV_URL?: string
}

const DEFAULT_ROUTE_URL =
  'https://data.ntpc.gov.tw/api/datasets/0ee4e6bf-cee6-4ec8-8fe1-71f544015127/csv/file'
const DEFAULT_STOP_URL =
  'https://data.ntpc.gov.tw/api/datasets/34b402a8-53d9-483d-9406-24a682c2d6dc/csv/file'
const DEFAULT_ETA_URL =
  'https://data.ntpc.gov.tw/api/datasets/07f7ccb3-ed00-43c4-966d-08e9dab24e95/csv/file'

const ETA_CACHE_TTL_MS = 30_000 // 30 seconds

interface EtaCache {
  fetchedAt: number
  etaMap: Map<string, number | null>
}

// Module-scope state: built once per isolate, shared across requests.
let busData: BusData | null = null
let etaCache: EtaCache | null = null

// Fetch raw CSV payloads from the NTPC open-data endpoints.
// We intentionally prefer the live endpoint unless local env bindings are injected.
async function fetchText(url: string, label: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${res.status} from ${url}`)
  }
  return await res.text()
}

// One-time initialization per Worker isolate.
// This caches the route/stop indexes so repeated requests do not rescan the full CSV payload.
async function getBusData(env: Env): Promise<BusData> {
  if (!busData) {
    const routeCsvRaw = env.BUS_ROUTES_CSV ?? ''
    const stopCsvRaw = env.BUS_STOP_CSV ?? ''
    console.log('[debug] env route csv length:', routeCsvRaw.length)
    console.log('[debug] env stop csv length:', stopCsvRaw.length)
    console.log('[debug] env route csv contains 紅28:', routeCsvRaw.includes('紅28'))

    const routesCsv =
      routeCsvRaw.trim() ||
      await fetchText(env.ROUTE_CSV_URL || DEFAULT_ROUTE_URL, 'route CSV')
    const stopsCsv =
      stopCsvRaw.trim() ||
      await fetchText(env.STOP_CSV_URL || DEFAULT_STOP_URL, 'stop CSV')

    busData = buildBusData(routesCsv, stopsCsv)

    const red28Ids = busData.routeIndex.get('NewTaipei|紅28') ?? []
    console.log('[debug] NewTaipei|紅28 route IDs:', red28Ids)
    console.log('[debug] routeIndex size:', busData.routeMetaMap.size)
  }
  return busData
}

// ETA data is time-sensitive and refreshed on a short TTL to keep the response current.
async function getEtaMap(env: Env): Promise<Map<string, number | null>> {
  const now = Date.now()
  if (etaCache && now - etaCache.fetchedAt < ETA_CACHE_TTL_MS) {
    return etaCache.etaMap
  }

  const url = env.ETA_CSV_URL || DEFAULT_ETA_URL
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ETA CSV: HTTP ${res.status}`)
  }
  const text = await res.text()
  etaCache = { fetchedAt: now, etaMap: parseEtaCsv(text) }
  return etaCache.etaMap
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    }
  })
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status)
}

// Route lookup flow:
// 1) validate city/routeName/direction
// 2) resolve routeId from the normalized route name index
// 3) fetch the direction-specific stops
// 4) attach ETA values keyed by routeId + direction + stopId
async function handleRouteQuery(
  url: URL,
  env: Env
): Promise<Response> {
  const city = url.searchParams.get('city') ?? CITY
  const routeName = (url.searchParams.get('routeName') ?? '').trim()
  const directionRaw = url.searchParams.get('direction')

  if (city !== CITY) {
    return errorResponse(
      'UNSUPPORTED_CITY',
      `Only ${CITY} is supported`,
      400
    )
  }
  if (!routeName) {
    return errorResponse('INVALID_PARAMETER', 'routeName is required', 400)
  }
  if (directionRaw !== '0' && directionRaw !== '1') {
    return errorResponse(
      'INVALID_PARAMETER',
      'direction must be 0 or 1',
      400
    )
  }
  const direction = Number(directionRaw)

  const data = await getBusData(env)

  const lookupNames = new Set<string>([
    routeName,
    routeName.replace(/\s+/g, ''),
    routeName.toLowerCase(),
    normalizeRouteAlias(routeName)
  ])

  let routeIds: string[] | undefined
  for (const name of lookupNames) {
    routeIds = data.routeIndex.get(`${city}|${name}`)
    if (routeIds && routeIds.length > 0) break
  }

  if (!routeIds || routeIds.length === 0) {
    return errorResponse(
      'ROUTE_NOT_FOUND',
      `No route named "${routeName}" found`,
      404
    )
  }
  if (routeIds.length > 1) {
    return errorResponse(
      'AMBIGUOUS_ROUTE',
      `Multiple routes match "${routeName}": ${routeIds.join(', ')}`,
      409
    )
  }
  const routeId = routeIds[0]
  const meta = data.routeMetaMap.get(routeId)

  const stops = data.stopIndex.get(`${routeId}|${direction}`) ?? []
  if (stops.length === 0) {
    return errorResponse(
      'ROUTE_NOT_FOUND',
      `No stops for route ${routeName} in direction ${direction}`,
      404
    )
  }

  const etaMap = await getEtaMap(env)

  const stopList = stops.map((stop) => {
    const remaining = etaMap.get(`${routeId}|${direction}|${stop.stopId}`) ?? null
    return {
      sequence: stop.sequence,
      stopId: stop.stopId,
      stopName: stop.stopName,
      stopNameEn: stop.stopNameEn || undefined,
      remainingSeconds: remaining,
      waitingTimeText: formatWaitingTime(remaining)
    }
  })

  return jsonResponse({
    route: {
      city,
      routeName,
      routeId,
      routeNameEn: meta?.routeNameEn || undefined,
      direction,
      directionLabel: direction === 0 ? '去程' : '回程',
      departure: meta?.departure || undefined,
      destination: meta?.destination || undefined,
      provider: meta?.provider || undefined
    },
    stops: stopList,
    generatedAt: new Date().toISOString()
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'content-type'
        }
      })
    }

    if (request.method !== 'GET') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Use GET', 405)
    }

    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        const data = await getBusData(env)
        return jsonResponse({
          ok: true,
          environment: env.ENVIRONMENT,
          city: CITY,
          routeCount: data.routeMetaMap.size,
          stopIndexKeys: data.stopIndex.size,
          loadedAt: data.loadedAt
        })
      }

      if (url.pathname === '/api/bus/route') {
        return await handleRouteQuery(url, env)
      }

      return errorResponse('NOT_FOUND', `Unknown path ${url.pathname}`, 404)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return errorResponse('INTERNAL_ERROR', message, 500)
    }
  }
} satisfies ExportedHandler<Env>
