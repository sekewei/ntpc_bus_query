# 公車路線查詢 API 規格 (Bus Route Query API Spec)

本 API 基於 TDX 開放資料平台 (https://tdx.transportdata.tw) 的兩個端點設計：

| 用途 | TDX 端點 |
|------|----------|
| 路線站序 | `GET /api/basic/v2/Bus/StopOfRoute/City/{City}/{RouteName}` |
| 到站預估時間 | `GET /api/basic/v2/Bus/EstimatedTimeOfArrival/City/{City}/{RouteName}` |

---

## 1. 端點

```
GET /api/bus/routes/{city}/{routeName}/{direction}
```

### 1.1 路徑參數 (Path Parameters)

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `city` | string | 是 | 城市代碼，TDX 格式，例如 `NewTaipei`、`Taipei`、`Taoyuan` |
| `routeName` | string | 是 | 路線名稱，例如 `紅28`、`233`、`617`。需 URL-encode（如 `%E7%B4%8528`） |
| `direction` | integer | 是 | 方向：`0` = 去程 (outbound)，`1` = 回程 (inbound) |

### 1.2 查詢參數 (Query Parameters)

| 參數 | 型別 | 預設值 | 說明 |
|------|------|--------|------|
| `top` | integer | `50` | 傳給 TDX 的 `$top`，限制回傳筆數 |

### 1.3 請求範例

```
GET /api/bus/routes/NewTaipei/%E7%B4%8528/0
```

```bash
curl -X 'GET' \
  'http://localhost:8080/api/bus/routes/NewTaipei/%E7%B4%8528/0' \
  -H 'accept: application/json'
```

---

## 2. 回應

### 2.1 成功 (200 OK)

```json
{
  "route": {
    "routeUid": "NWT16288",
    "routeId": "16288",
    "routeName": "紅28",
    "routeNameEn": "R28",
    "direction": 0,
    "directionLabel": "去程",
    "operator": "淡水客運",
    "city": "NewTaipei"
  },
  "stops": [
    {
      "sequence": 1,
      "stopUid": "NWT114541",
      "stopId": "114541",
      "stopNameZh": "淡江大學",
      "stopNameEn": "Tamkang University",
      "boarding": true,
      "etaSeconds": 423,
      "etaMinutes": 7,
      "etaLabel": "約 7 分鐘",
      "stopStatus": 1,
      "position": {
        "lon": 121.447573,
        "lat": 25.174327
      }
    },
    {
      "sequence": 2,
      "stopUid": "NWT114542",
      "stopId": "114542",
      "stopNameZh": "淡江大學城",
      "stopNameEn": "Tamkang Community",
      "boarding": true,
      "etaSeconds": 581,
      "etaMinutes": 10,
      "etaLabel": "約 10 分鐘",
      "stopStatus": 1,
      "position": {
        "lon": 121.4503864,
        "lat": 25.173067
      }
    }
  ],
  "meta": {
    "sourceUpdateTime": "2026-10-15T14:16:17+08:00",
    "etaUpdateTime": "2026-10-15T16:03:00+08:00",
    "generatedAt": "2026-10-15T16:03:05+08:00",
    "stopCount": 5
  }
}
```

### 2.2 回應欄位說明

#### `route` 物件

| 欄位 | 型別 | 說明 |
|------|------|------|
| `routeUid` | string | TDX 路線 UID，例如 `NWT16288` |
| `routeId` | string | 路線 ID |
| `routeName` | string | 路線名稱（中文） |
| `routeNameEn` | string | 路線名稱（英文） |
| `direction` | integer | `0` 去程 / `1` 回程 |
| `directionLabel` | string | 方向中文標籤：`去程` 或 `回程` |
| `operator` | string | 營運業者名稱，例如 `淡水客運` |
| `city` | string | 城市代碼 |

#### `stops[]` 陣列（依 `StopSequence` 排序）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sequence` | integer | 站序（1 起） |
| `stopUid` | string | 站點 UID，例如 `NWT114541` |
| `stopId` | string | 站點 ID |
| `stopNameZh` | string | 站名（中文），來自 TDX `StopName.Zh_tw` |
| `stopNameEn` | string | 站名（英文），來自 TDX `StopName.En` |
| `boarding` | boolean | 是否可上下車。TDX `StopBoarding`：`0` = 可上下車，`-1` = 僅起訖站（視為 `true`），`1` = 不可上下車（`false`） |
| `etaSeconds` | integer \| null | 預估到站秒數。`null` 表示該站無即時到站資訊 |
| `etaMinutes` | integer \| null | 預估到站分鐘數（`ceil(etaSeconds / 60)`） |
| `etaLabel` | string \| null | 人類可讀的到站時間，例如 `約 7 分鐘`、`即將到站`、`無即時資訊` |
| `stopStatus` | integer \| null | TDX `StopStatus`：`0` = 正常，`1` = 異常/暫停 |
| `position.lon` | number | 經度 |
| `position.lat` | number | 緯度 |

#### `meta` 物件

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sourceUpdateTime` | string | 站序資料的 TDX `UpdateTime` (ISO 8601) |
| `etaUpdateTime` | string | 到站時間資料的 TDX `UpdateTime` (ISO 8601) |
| `generatedAt` | string | 本 API 產生回應的時間 (ISO 8601) |
| `stopCount` | integer | 站點總數 |

### 2.3 `etaLabel` 規則

| 條件 | 標籤 |
|------|------|
| `etaSeconds == null` | `無即時資訊` |
| `etaSeconds <= 60` | `即將到站` |
| `etaSeconds <= 1800` (30 分鐘) | `約 N 分鐘`（N = ceil(秒/60)） |
| `etaSeconds > 1800` | `約 H 小時 M 分鐘` |

---

## 3. 錯誤回應

### 3.1 錯誤格式

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "找不到路線「紅28」於 NewTaipei 的站序資料",
    "details": {
      "city": "NewTaipei",
      "routeName": "紅28",
      "direction": 0
    }
  }
}
```

### 3.2 錯誤碼

| HTTP 狀態碼 | `code` | 說明 |
|-------------|--------|------|
| 400 | `INVALID_PARAMETER` | 參數格式錯誤（例如 `direction` 不是 0 或 1） |
| 404 | `ROUTE_NOT_FOUND` | TDX 回傳空陣列，找不到該路線/方向 |
| 404 | `DIRECTION_NOT_FOUND` | 路線存在但指定方向無資料 |
| 422 | `AMBIGUOUS_ROUTE` | 路線名稱匹配到多條不同 `RouteUID`（例如 `紅28` 與 `紅28直`），需客戶端明確指定 |
| 502 | `UPSTREAM_ERROR` | TDX API 回傳非 200 或逾時 |
| 429 | `RATE_LIMITED` | 觸發 TDX 速率限制（20 次/分鐘） |

---

## 4. 內部處理流程

```
客戶端請求
    │
    ▼
┌─────────────────────────────────┐
│ 1. 驗證參數                      │
│    - direction ∈ {0, 1}         │
│    - city 格式檢查               │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 2. 並行呼叫 TDX（2 個端點）       │
│                                 │
│  2a. GET /Bus/StopOfRoute/      │
│      City/{city}/{routeName}    │
│      → 取得站序 + 營運業者       │
│                                 │
│  2b. GET /Bus/EstimatedTimeOf   │
│      Arrival/City/{city}/       │
│      {routeName}                │
│      → 取得各站到站秒數          │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 3. 過濾與匹配                    │
│                                 │
│  - 從 2a 結果中篩選              │
│    Direction == 指定方向         │
│  - 若匹配到多條 RouteUID →       │
│    回傳 422 AMBIGUOUS_ROUTE     │
│  - 以 StopUID 為 key，將 2b 的   │
│    EstimateTime 對應到各站       │
│  - 注意：2b 回傳的是該站「所有   │
│    路線」的到站時間，需再篩選     │
│    RouteUID + Direction 匹配    │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 4. 組裝回應                      │
│                                 │
│  - 依 StopSequence 排序          │
│  - 計算 etaMinutes / etaLabel   │
│  - 轉換 StopBoarding → boolean  │
│  - 填入 meta 時間戳              │
└──────────────┬──────────────────┘
               │
               ▼
          回傳 JSON
```

### 4.1 關鍵匹配邏輯

TDX `EstimatedTimeOfArrival` 回傳的每筆資料包含 `StopUID`、`RouteUID`、`Direction`。
匹配條件為 **三者皆須相等**：

```
eta.StopUID   == stop.StopUID
eta.RouteUID  == route.RouteUID
eta.Direction == route.Direction
```

同一 `StopUID` 在不同方向可能有不同的站牌（例如「淡江大學」在去程是 `NWT114541`，
回程是 `NWT204373`），因此 **必須用 `StopUID` 而非站名來匹配**。

### 4.2 `StopBoarding` 轉換

| TDX 值 | 意義 | API `boarding` |
|--------|------|----------------|
| `0` | 可上下車 | `true` |
| `-1` | 起訖站（起點或終點） | `true` |
| `1` | 不可上下車（僅通過） | `false` |

---

## 5. 快取策略

| 資料 | 快取時間 | 說明 |
|------|----------|------|
| 站序 (`StopOfRoute`) | 1 小時 | 站序變動頻率低，TDX `VersionID` 可作為 cache-bust |
| 到站時間 (`EstimatedTimeOfArrival`) | 30 秒 | 即時性要求高，但 TDX 本身更新週期約 30~60 秒 |

快取 key 格式：
```
stopofroute:{city}:{routeName}:{direction}
eta:{city}:{routeName}:{direction}
```

---

## 6. 速率限制

TDX 免費層限制：**20 次/分鐘**（`ratelimit-limit: 20`）。

- 本 API 應實作 **token bucket** 或 **fixed window** 限流，避免超過 TDX 上限。
- 建議：對同一 `city + routeName` 的請求做 **請求合併 (request coalescing)**，
  30 秒內的重複請求直接回傳快取。
- 觸發 429 時，回應應包含 `Retry-After` header。

---

## 7. 延伸：模糊搜尋路線名稱

TDX 的 `RouteName` 路徑參數是 **精確匹配**。若使用者輸入不完整的路線名稱
（例如只輸入 `28` 而非 `紅28`），可選實作：

```
GET /api/bus/routes/{city}/search?keyword=28
```

回傳所有 `RouteName.Zh_tw` 或 `RouteName.En` 包含 `keyword` 的路線清單，
供前端下拉選單使用：

```json
{
  "results": [
    {
      "routeUid": "NWT16288",
      "routeName": "紅28",
      "routeNameEn": "R28",
      "directions": [0, 1]
    },
    {
      "routeUid": "NWT16715",
      "routeName": "紅28直",
      "routeNameEn": "R28Sub",
      "directions": [0, 1]
    }
  ]
}
```

> 注意：TDX 不支援路線名稱的 server-side 模糊搜尋，此端點需先拉取
> `/v2/Bus/Route/City/{city}` 全量路線清單後在記憶體中過濾，
> 並快取 1 小時。

---

## 8. 完整 curl 範例

### 8.1 查詢紅28 去程

```bash
curl -s 'http://localhost:8080/api/bus/routes/NewTaipei/%E7%B4%8528/0' \
  | jq .
```

### 8.2 查詢紅28 回程

```bash
curl -s 'http://localhost:8080/api/bus/routes/NewTaipei/%E7%B4%8528/1' \
  | jq .
```

### 8.3 預期輸出（去程，節錄前 2 站）

```json
{
  "route": {
    "routeUid": "NWT16288",
    "routeId": "16288",
    "routeName": "紅28",
    "routeNameEn": "R28",
    "direction": 0,
    "directionLabel": "去程",
    "operator": "淡水客運",
    "city": "NewTaipei"
  },
  "stops": [
    {
      "sequence": 1,
      "stopUid": "NWT114541",
      "stopId": "114541",
      "stopNameZh": "淡江大學",
      "stopNameEn": "Tamkang University",
      "boarding": true,
      "etaSeconds": 423,
      "etaMinutes": 7,
      "etaLabel": "約 7 分鐘",
      "stopStatus": 1,
      "position": { "lon": 121.447573, "lat": 25.174327 }
    },
    {
      "sequence": 2,
      "stopUid": "NWT114542",
      "stopId": "114542",
      "stopNameZh": "淡江大學城",
      "stopNameEn": "Tamkang Community",
      "boarding": true,
      "etaSeconds": 581,
      "etaMinutes": 10,
      "etaLabel": "約 10 分鐘",
      "stopStatus": 1,
      "position": { "lon": 121.4503864, "lat": 25.173067 }
    }
  ],
  "meta": {
    "sourceUpdateTime": "2026-10-15T14:16:17+08:00",
    "etaUpdateTime": "2026-10-15T16:03:00+08:00",
    "generatedAt": "2026-10-15T16:03:05+08:00",
    "stopCount": 5
  }
}
```
