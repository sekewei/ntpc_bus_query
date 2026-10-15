# 新北市公車到站查詢 API 設計

## 1. 背景

本 API 依照新北市公車公開 CSV 資料設計，主要目標是讓前端或手機端在輸入：

- 路線名稱，如 `紅28`、`淡海線`
- 方向，如 `0`（去程）或 `1`（回程）

後可查詢該路線在指定方向的所有站點，並附帶每站最新預估到站時間。

本 API 的核心設計重點為：

- 路線資料與站序資料在 Worker 啟動時預先載入
- 建立 `routeName -> routeId` 與 `routeId -> routeName` 的對照表
- 站序資料依 `seqno` 排序後建立索引
- ETA 每次請求時即時抓取最新資料
- 回傳時直接沿用已排序站序，不重複排序

---

## 2. 資料來源

本 API 依賴三份 CSV 資料：

### 2.1 路線名稱對照資料

來源：

```text
https://data.ntpc.gov.tw/api/datasets/0ee4e6bf-cee6-4ec8-8fe1-71f544015127/csv
```

欄位示例：

```csv
id,providerid,providername,namezh,nameen,pathattributeid,pathattributename,pathattributeename,buildperiod,departurezh,departureen,destinationzh,destinationen,realsequence,distance,gofirstbustime,backfirstbustime,golastbustime,backlastbustime,peakheadway,offpeakheadway,bustimedesc,headwaydesc,holidaygofirstbustime,holidaybackfirstbustime,holidaygolastbustime,holidaybacklastbustime,holidaybustimedesc,holidaypeakheadway,holidayoffpeakheadway,holidayheadwaydesc,segmentbufferzh,segmentbufferen,ticketpricedescriptionzh,ticketpricedescriptionen
16715,16186,淡水客運,紅28直,R28Sub,157812,紅28直,R28 Sub,10,淡江大學,Tamkang University,捷運淡水站,MRT Tamsui Sta.,33,2.85,0624," ",1930," ",,,,,," "," "," "," ",,,,,,,一段票,"1 segments"
16288,16186,淡水客運,紅28,R28,160578,紅28,R28,10,淡江大學,Tamkang University,捷運淡水站,MRT Tamsui Sta.,120,3.5,0600,0600,2220,2220,,,,,0640,0640,2220,2220,,,,,,,一段票,"1 segments"
```

關鍵欄位：

- `id`: 路線 ID
- `namezh`: 中文路線名稱
- `nameen`: 英文路線名稱
- `departurezh`: 起點
- `destinationzh`: 終點
- `providername`: 業者名稱

這些欄位用來建立下列索引：

- `routeId -> routeName`
- `routeName -> routeId[]`
- `routeId -> { routeName, routeNameEn, departure, destination, provider }`

### 2.2 路線站序資料

來源：

```text
https://data.ntpc.gov.tw/api/datasets/34b402a8-53d9-483d-9406-24a682c2d6dc/csv
```

欄位示例：

```csv
id,routeid,namezh,nameen,seqno,pgp,goback,longitude,latitude,address,stoplocationid,showlon,showlat,vector
213893,5413,四川橋,Sichuan Bridge,0,0,0,121.644816,25.105065,新北市汐止區汐萬路三段252巷27號(向南),71020,121.644816,25.105065,999
213894,5413,烘內,Hongnei,1,0,0,121.6439911,25.104621,新北市汐止區汐萬路三段252巷1號,71026,121.6439911,25.104621,999
```

關鍵欄位：

- `routeid`: 路線 ID
- `id`: 站牌 ID
- `namezh`: 站名（中文）
- `seqno`: 站序
- `goback`: 方向，`0`=去程，`1`=回程

### 2.3 到站預估時間資料

來源：

```text
https://data.ntpc.gov.tw/api/datasets/07f7ccb3-ed00-43c4-966d-08e9dab24e95/csv
```

欄位示例：

```csv
routeid,stopid,estimatetime,goback
17700,187088,3401,0
17700,187089,3435,0
16552,187093,3051,1
```

關鍵欄位：

- `routeid`: 路線 ID
- `stopid`: 站牌 ID
- `estimatetime`: 剩餘秒數
- `goback`: 方向

> `estimatetime` 可能是 `0`、正數，或 `-3`；`-3` 表示無即時資料。

---

## 3. API 端點

### 3.1 端點

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

Worker 啟動時需要預先載入路線與站序資料，建立索引，避免每次查詢都重掃整份 CSV。

### 4.1 初始化要做的事

1. 讀取 `bus_routes.csv`，建立 `routeId <-> routeName` 對照表
2. 讀取 `bus_stop.csv`，建立站序索引
3. 建立 `routeIndex`：
   - key: `${city}|${routeName}`
   - value: `routeId[]`
4. 建立 `routeMetaMap`：
   - key: `routeId`
   - value: `{ routeName, routeNameEn, departure, destination, provider }`
5. 建立 `stopIndex`：
   - key: `${routeId}|${direction}`
   - value: 依 `seqno` 排序後的站點列表
6. 將資料放入記憶體快取或 KV（可選）

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

> 路線資料中的 `id` 與 `namezh` 形成路線名稱對照表。`routeIndex` 負責將輸入的路線名稱轉成 `routeId`，而 `routeMetaMap` 可回傳路線的中文/英文名稱、起點、終點與業者資訊。

---

## 5. 請求流程

每次 API 請求時：

1. 驗證 `routeName` 和 `direction`
2. 由 `routeIndex` 解析出 `routeId`
3. 再由 `routeMetaMap` 取得路線資訊（名稱、起訖點、業者）
4. 取出該 `routeId` 在指定方向的站序列表（已在初始化時依 `seqno` 排序）
5. 抓取最新 ETA 資料
6. 依 `routeId + direction + stopId` 過濾 ETA
7. 將 ETA 映射到每個站點
8. 直接按已排序站列表輸出

### 5.1 流程圖

```text
Client Request
   ↓
Validate params
   ↓
Lookup routeId from routeIndex
   ↓
Lookup route metadata from routeMetaMap
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
    "routeNameEn": "R28",
    "routeId": "16288",
    "departure": "淡江大學",
    "destination": "捷運淡水站",
    "provider": "淡水客運",
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
| `routeName` | string | 中文路線名稱 |
| `routeNameEn` | string | 英文路線名稱 |
| `routeId` | string | 路線 ID |
| `departure` | string | 起點站名 |
| `destination` | string | 終點站名 |
| `provider` | string | 公車業者 |
| `direction` | integer | `0` 或 `1` |
| `directionLabel` | string | `去程` 或 `回程` |

#### stops[]

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sequence` | integer | 站序 |
| `stopId` | string | 站牌 ID |
| `stopName` | string | 中文站名 |
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
const routeMeta = routeMetaMap.get(routeId)
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

> `stopRows` 已在初始化時依 `seqno` 排序，因此這段不會再次重排。

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

- 初始化時建立 `routeName` 與 `routeId` 對照表，查詢效率高
- ETA 仍每次請求即時抓取，保持時效性
- 可直接部署到 Cloudflare Worker
- 可利用 KV 或記憶體快取提升速度

### 10.2 建議快取策略

| 資料類型 | 快取時間 | 說明 |
|----------|----------|------|
| 路線/站序資料 | 1 小時 | 基本不會頻繁改變 |
| 路線名稱對照資料 | 1 小時 | 路線清單通常穩定 |
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

    const routeMeta = routeMetaMap.get(routeId)
    const etaRows = await fetchLatestEtaData()
    const result = buildRouteStopResponse(routeId, direction, etaRows, routeMeta)

    return Response.json(result)
  }
}
```

---

## 11. 設計總結

本 API 的核心設計如下：

- 在 Worker 初始化時載入路線資訊、路線對照表與站序
- 建立 `routeName -> routeId` 與 `routeId -> routeMeta` 的索引
- 在初始化時依 `seqno` 排序並建立站序索引
- 在每次請求時抓取最新 ETA
- 依 `routeName + direction` 解析路線，再組裝站序與到站時間

這樣可以同時兼顧：

- 效能：預先建立索引，避免重掃整份 CSV
- 即時性：ETA 每次都更新
- 清晰性：`routeId` 與 `routeName` 對照明確
- 可擴展性：後續可支援多城市、多路線與多種查詢模式

---

## 12. 路線 16288 的實例

以路線 `16288`、方向 `0` 為例，路線相關資訊可從路線 CSV 解析為：

```json
{
  "routeId": "16288",
  "routeName": "紅28",
  "routeNameEn": "R28",
  "departure": "淡江大學",
  "destination": "捷運淡水站",
  "provider": "淡水客運"
}
```

對應回應會包含該路線在去程方向的站點順序與預估到站時間。
