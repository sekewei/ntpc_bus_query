# 新北市公車到站查詢 API 規格（Cloudflare Worker）

## 1. 背景

本 API 依據新北市公車 CSV 資料設計，目標是讓前端或手機端傳入：

- 路線名稱，如 `紅28`、`淡海線`
- 方向，如 `0`（去程）或 `1`（回程）

回傳該路線依站序排列的各站名稱，以及各站的預估到站剩餘時間。

此設計的核心概念是：

- 路線與站序資料在 Worker 初始化時載入
- 站序在初始化時依 `seqno` 排序並建立索引
- 到站 ETA 資料在每次請求時即時抓取
- 根據 `route name + direction` 過濾並組裝輸出
- 不在每次請求時重複排序，因為 `seqno` 已是固定站序

---

## 2. 資料來源

本 API 依賴三份 CSV：

### 2.1 路線名稱對照資料

欄位示例：

```csv
id,providerid,providername,namezh,nameen,pathattributeid,pathattributename,pathattributeename,buildperiod,departurezh,departureen,destinationzh,destinationen,realsequence,distance,gofirstbustime,backfirstbustime,golastbustime,backlastbustime,peakheadway,offpeakheadway,bustimedesc,headwaydesc,holidaygofirstbustime,holidaybackfirstbustime,holidaygolastbustime,holidaybacklastbustime,holidaybustimedesc,holidaypeakheadway,holidayoffpeakheadway,holidayheadwaydesc,segmentbufferzh,segmentbufferen,ticketpricedescriptionzh,ticketpricedescriptionen
10511,16179,新北市公車,639,639,105110,639,639,10,東勢公園,Dongsheng Park,淡水站,MRT Beimen Station,30,41.78,0500,0500,2150,2150,,,,,0500,0500,2150,2150,,,,,,,,,銝畾萇巨,1 Segment
16487,16179,新北市公車,??8,BL38,157510,??8,BL38,10,樹林,Shulin,板橋公車站,Banqiao Bus Station,112,25.3,0520,0520,0000,0000,,10,1520,,22:30,0520,0520,0000,0000,,10,1520,22:30,,,,銝畾萇巨,1 segments
```

關鍵欄位：

- `id`: 路線 ID（對應最終查詢時的 `routeId`）
- `namezh`: 中文路線名稱
- `nameen`: 英文路線名稱
- `departurezh` / `destinationzh`: 起點與終點中文名稱
- `providerid` / `providername`: 業者資訊

這份資料主要用來建立：

- `routeId -> routeName`
- `routeName -> routeId[]`
- `routeId -> { namezh, nameen, departure, destination }`

### 2.2 路線站序資料

欄位示例：

```csv
id,routeid,namezh,nameen,seqno,pgp,goback,longitude,latitude,address,stoplocationid,showlon,showlat,vector
114541,16288,淡江大學,Tamkang University,0,-1,0,121.447573,25.174327,淡江大學紹謨紀念游泳館前(向南),75101,121.447573,25.174327,999
114542,16288,淡江大學城,Tamkang Community,1,0,0,121.4503864,25.173067,學府路123號旁,74983,121.4503864,25.173067,999
```

關鍵欄位：

- `routeid`: 路線 ID
- `id`: 站牌 ID
- `namezh`: 中文站名
- `seqno`: 站序
- `goback`: 方向，`0`=去程，`1`=回程

### 2.3 到站預估時間資料

欄位示例：

```csv
routeid,stopid,estimatetime,goback
16288,114541,0,0
16288,114542,193,0
16288,114543,296,1
```

關鍵欄位：

- `routeid`: 路線 ID
- `stopid`: 站牌 ID
- `estimatetime`: 剩餘秒數
- `goback`: 方向

> `estimatetime` 可能為 `0`、正數，或 `-3`。`-3` 表示無即時資訊或暫無資料。

---

## 3. API 端點

### 3.1 端點名稱

```http
GET /api/bus/route
```

### 3.2 查詢參數

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `routeName` | string | 是 | 路線名稱，例如 `紅28`、`淡海線` |
| `direction` | integer | 是 | `0`=去程，`1`=回程 |
| `city` | string | 否 | 預設 `NewTaipei` |

### 3.3 範例

```http
GET /api/bus/route?city=NewTaipei&routeName=紅28&direction=0
```

---

## 4. Worker 初始化流程

Worker 啟動時，需要預先載入路線與站序資料，建立索引，避免每次查詢都重掃整份 CSV。

### 4.1 初始化要做的事

1. 讀取 `bus_route.csv`，建立 `routeId -> routeName` 與 `routeName -> routeId[]` 的映射
2. 讀取 `bus_stop.csv`，解析站序資料
3. 建立 `routeIndex`：
   - key: `${city}|${routeName}`
   - value: routeId 清單
4. 建立 `routeMetaMap`：
   - key: `routeId`
   - value: `{ routeName, routeNameEn, departure, destination, provider }`
5. 建立 `stopIndex`：
   - key: `${routeId}|${direction}`
   - value: 依 `seqno` 排序之站序列表
6. 將資料存放在記憶體快取或 KV（可選）

### 4.2 建立索引範例

```ts
const routeIndex = new Map<string, string[]>()
const routeMetaMap = new Map<string, {
  routeId: string
  routeName: string
  routeNameEn: string
  departure: string
  destination: string
  provider: string
}>()
const stopIndex = new Map<string, StopMeta[]>()

for (const row of routeRows) {
  const routeId = String(row.id)
  const routeName = String(row.namezh ?? '').trim()
  const routeNameEn = String(row.nameen ?? '').trim()
  const cityKey = `${city}|${routeName}`

  if (!routeIndex.has(cityKey)) routeIndex.set(cityKey, [])
  routeIndex.get(cityKey)!.push(routeId)

  routeMetaMap.set(routeId, {
    routeId,
    routeName,
    routeNameEn,
    departure: String(row.departurezh ?? ''),
    destination: String(row.destinationzh ?? ''),
    provider: String(row.providername ?? '')
  })
}

for (const row of stopRows) {
  const routeId = String(row.routeid)
  const stopKey = `${routeId}|${row.goback}`
  if (!stopIndex.has(stopKey)) stopIndex.set(stopKey, [])

  stopIndex.get(stopKey)!.push({
    routeId,
    stopId: String(row.id),
    stopName: row.namezh,
    sequence: Number(row.seqno),
    direction: Number(row.goback)
  })
}

for (const stopKey of stopIndex.keys()) {
  const stops = stopIndex.get(stopKey) ?? []
  const ordered = stops.sort((a, b) => a.sequence - b.sequence)
  stopIndex.set(stopKey, ordered)
}
```

> 路線資料中的 `id` 與 `namezh` 形成路線名稱對照表，`routeIndex` 用於從輸入的路線名稱快速解析 `routeId`，而 `routeMetaMap` 則用於回傳路線完整資訊與查詢起訖站。站序列表在初始化時已依 `seqno` 排序，後續查詢直接使用已排序結果，不再在每次請求時重排；這樣可以維持高效能與一致性。

---

## 5. 請求流程

每次 API 請求時：

1. 驗證 `routeName` 和 `direction`
2. 由 `routeIndex` 找到對應 routeId
3. 取出該 routeId 在指定方向的站序列表（已在初始化時按 `seqno` 排序）
4. 抓取最新 ETA 資料
5. 依 `routeId + direction + stopId` 過濾 ETA
6. 將 ETA 映射到每個站點
7. 直接按已排序站列表輸出，不額外重排

> 若要保險起見，也可在最後輸出前做一次防呆排序，但通常不需要，因為 `seqno` 已在初始化時固定成站序順序。

### 5.1 流程圖

```text
Client Request
   ↓
Validate params
   ↓
Lookup routeId from routeIndex
   ↓
Fetch latest ETA data
   ↓
Filter by routeId + direction
   ↓
Join ETA to stop sequence
   ↓
Return ordered stop list with remaining time
```

---

## 6. 回應格式

### 6.1 成功回應（200 OK）

```json
{
  "route": {
    "city": "NewTaipei",
    "routeName": "紅28",
    "routeId": "16288",
    "direction": 0,
    "directionLabel": "去程"
  },
  "stops": [
    {
      "sequence": 0,
      "stopId": "114541",
      "stopName": "淡江大學",
      "remainingSeconds": 0,
      "waitingTimeText": "即將到站"
    },
    {
      "sequence": 1,
      "stopId": "114542",
      "stopName": "淡江大學城",
      "remainingSeconds": 193,
      "waitingTimeText": "約 4 分鐘"
    },
    {
      "sequence": 2,
      "stopId": "195846",
      "stopName": "文宏廣場",
      "remainingSeconds": null,
      "waitingTimeText": "無即時資訊"
    }
  ],
  "generatedAt": "2026-10-15T12:00:00+08:00"
}
```

### 6.2 欄位說明

#### route

| 欄位 | 型別 | 說明 |
|------|------|------|
| `city` | string | 城市名稱 |
| `routeName` | string | 路線名稱 |
| `routeId` | string | 路線 ID |
| `direction` | integer | `0` 或 `1` |
| `directionLabel` | string | `去程` 或 `回程` |

#### stops[]

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sequence` | integer | 站序 |
| `stopId` | string | 站牌 ID |
| `stopName` | string | 站名 |
| `remainingSeconds` | integer \| null | 剩餘秒數，無資料時為 null |
| `waitingTimeText` | string | 人類可讀文字，例如 `即將到站`、`約 4 分鐘` |

---

## 7. 估計時間計算規則

### 7.1 轉換規則

- `estimatetime = 0` -> `即將到站`
- `estimatetime > 0` -> `約 N 分鐘`
- `estimatetime < 0` -> `無即時資訊`

### 7.2 文字規則

```ts
function formatWaitingTime(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '無即時資訊'
  if (seconds <= 60) return '即將到站'
  const minutes = Math.ceil(seconds / 60)
  return `約 ${minutes} 分鐘`
}
```

---

## 8. 主要過濾邏輯

### 8.1 路線與方向過濾

```ts
const routeId = findRouteId(routeName, direction)
const stopRows = stopIndex.get(`${routeId}|${direction}`) || []
```

### 8.2 ETA 過濾

```ts
const etaMap = new Map<string, number | null>()
for (const row of etaRows) {
  if (row.routeId === routeId && Number(row.goback) === direction) {
    const value = Number(row.estimatetime)
    etaMap.set(row.stopId, value >= 0 ? value : null)
  }
}
```

### 8.3 合併站序與 ETA

```ts
const stops = stopRows.map(stop => ({
  sequence: stop.sequence,
  stopId: stop.stopId,
  stopName: stop.stopName,
  remainingSeconds: etaMap.get(stop.stopId) ?? null,
  waitingTimeText: formatWaitingTime(etaMap.get(stop.stopId) ?? null)
}))
```

> `stopRows` 已在初始化時依 `seqno` 排序，因此這段不會再次重排；排序順序已保留在索引中。

---

## 9. 錯誤回應

### 9.1 參數錯誤（400）

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "direction must be 0 or 1"
  }
}
```

### 9.2 路線不存在（404）

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "No route matches the given route name and direction"
  }
}
```

### 9.3 多個路線同名（409）

```json
{
  "error": {
    "code": "AMBIGUOUS_ROUTE",
    "message": "Multiple routes match this route name; please provide more exact input"
  }
}
```

---

## 10. Cloudflare Worker 設計

### 10.1 優點

- 各路線資料在初始化時載入，查詢速度快
- ETA 需要即時更新，因此每次請求再抓取最新資料
- 能直接部署成 Cloudflare Worker
- 可用 KV 或內存快取提升效能

### 10.2 建議快取策略

| 資料類型 | 快取時間 | 說明 |
|----------|----------|------|
| 路線/站序資料 | 1 小時 | 基本上不會頻繁改變 |
| ETA 資料 | 30 秒 | 需要更接近即時 |

### 10.3 建議流程

```ts
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url)
    const routeName = url.searchParams.get('routeName')
    const direction = Number(url.searchParams.get('direction'))

    if (!routeName || ![0, 1].includes(direction)) {
      return Response.json({ error: { code: 'INVALID_PARAMETER', message: 'direction must be 0 or 1' } }, { status: 400 })
    }

    const routeId = resolveRouteId(routeName, direction)
    if (!routeId) {
      return Response.json({ error: { code: 'ROUTE_NOT_FOUND', message: 'No route matches the given route name and direction' } }, { status: 404 })
    }

    const etaRows = await fetchLatestEtaData()
    const result = buildRouteStopResponse(routeId, direction, etaRows)

    return Response.json(result)
  }
}
```

---

## 11. 設計總結

本 API 的核心設計如下：

- 在 Worker 初始化階段載入路線資訊與站序
- 在初始化時依 `seqno` 排序並建立索引
- 於每次查詢時取得最新 ETA
- 依 `route name + direction` 過濾資料
- 直接利用已排序站序輸出各站名稱與剩餘到站時間

這樣可以同時兼顧：

- 效能：初始化快取避免重複掃描大量資料
- 即時性：ETA 每次都更新
- 簡潔性：請求只需輸入 `routeName` 和 `direction`
- 可擴展性：能夠後續擴充成多城市、多路線搜尋

---

## 12. 例子：路線 16288 的輸出

以路線 `16288`、方向 `0` 為例，輸出會類似：

```json
{
  "route": {
    "city": "NewTaipei",
    "routeName": "紅28",
    "routeId": "16288",
    "direction": 0,
    "directionLabel": "去程"
  },
  "stops": [
    {
      "sequence": 0,
      "stopId": "114541",
      "stopName": "淡江大學",
      "remainingSeconds": 0,
      "waitingTimeText": "即將到站"
    },
    {
      "sequence": 1,
      "stopId": "114542",
      "stopName": "淡江大學城",
      "remainingSeconds": 193,
      "waitingTimeText": "約 4 分鐘"
    }
  ]
}
```

這樣的格式最符合「輸入路線名稱與方向，輸出逐站站名與剩餘到站時間」的需求。
