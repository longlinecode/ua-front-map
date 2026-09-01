# 俄乌战场态势图 · 自动更新版

一个每天自动更新的俄乌战线交互式地图，外加一份可直接被其它地图应用当作图层加载的 GeoJSON feed。

- **网页**：`index.html` — 完整交互式态势图（缩放平移、时间轴回溯、12 个图层、3 套制图样式、6 种底图）
- **数据 feed**：`data/latest.geojson` — 当日俄控区、接触线、乌军控制俄境三个要素
- **图层适配器**：`embed/ua-situation-layer.js` — MapLibre / Mapbox / Leaflet / deck.gl / ArcGIS / Cesium

数据每天 04:10 UTC 由 GitHub Actions 自动刷新并重新发布。

---

## 一、部署（约 5 分钟）

1. 在 GitHub 新建一个仓库，把本目录全部内容 push 到 `main` 分支。
2. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
3. **Settings → Actions → General → Workflow permissions** 选 **Read and write permissions**（工作流需要把刷新后的数据提交回仓库）。
4. 到 **Actions** 标签页，手动跑一次 `Update front-line data`（`Run workflow`）验证。

完成后：

| 用途 | 地址 |
|---|---|
| 网页 | `https://<用户名>.github.io/<仓库名>/` |
| 数据 feed | `https://<用户名>.github.io/<仓库名>/data/latest.geojson` |
| 构建状态 | `https://<用户名>.github.io/<仓库名>/data/meta.json` |

页面和 feed 都是公开的，任何拿到链接的人都能访问，无需登录。GitHub Pages 对静态资源返回 `Access-Control-Allow-Origin: *`，所以你的应用可以跨域直接 fetch 这份 feed。

> **注意**：`index.html` 必须通过 HTTP 提供服务（它会 fetch `data/*.json`）。本地预览用 `python3 -m http.server 8000` 然后访问 `http://localhost:8000/`，直接双击打开文件会被同源策略拦住。

---

## 二、接入到你自己的地图（situation room 作为一个图层）

推荐架构不是嵌 iframe，而是**让你的地图直接消费这份 feed**。这样图层顺序、样式、交互、弹窗全部由你的应用控制。

### 最简：三行代码

```js
import { UAFront } from "https://<用户名>.github.io/<仓库名>/embed/ua-situation-layer.js";

const front = new UAFront({ feed: "https://<用户名>.github.io/<仓库名>/data" });
await front.load();
front.addToMapLibre(map);        // 或 addToLeaflet(map, L) / deckLayers(GeoJsonLayer) / ...
```

### 它会创建的图层（id 固定，方便你排序）

| 图层 id | 类型 | 含义 |
|---|---|---|
| `ua-front-russian-control` | fill | 俄军实际控制区 |
| `ua-front-russian-control-outline` | line | 上者轮廓 |
| `ua-front-ua-in-russia` | fill | 乌军控制的俄罗斯领土（库尔斯克／别尔哥罗德） |
| `ua-front-ua-in-russia-outline` | line | 上者轮廓 |
| `ua-front-contact-line` | line | **接触线**（已剔除海岸线与国际边界，只画真正的战线） |

插到你自己某个图层下面：`front.addToMapLibre(map, { before: "your-labels-layer" })`。

### 读数与自动刷新

```js
front.on("update", s => {
  // s.date, s.russianControlKm2, s.pctOfUkraine,
  // s.ukrainianControlInRussiaKm2, s.sources
  hud.textContent = `${s.russianControlKm2.toLocaleString()} km² (${s.pctOfUkraine}%)`;
});
front.startAutoRefresh(6 * 3600e3);   // 每 6 小时检查一次，数据日期变了才重绘
```

### 各框架适配器

```js
front.addToMapLibre(map, { before });          // MapLibre GL
front.addToMapbox(map, { before });            // Mapbox GL（同一套 API）
front.addToLeaflet(map, L, { pane });          // Leaflet
front.deckLayers(GeoJsonLayer);                // deck.gl，返回图层数组由你渲染
front.arcgisLayers({ GeoJSONLayer });          // ArcGIS Maps SDK for JavaScript
await front.addToCesium(viewer, Cesium);       // CesiumJS（贴地）
```

用别的东西？直接拿原始 GeoJSON：

```js
front.collection("russian_control")             // FeatureCollection
front.collection("contact_line")
front.collection("ukrainian_control_in_russia")
front.data                                      // 三者合一的原始 FeatureCollection
```

完整可跑示例见 `embed/examples/maplibre.html`。

### 不写代码的接法

`data/latest.geojson` 是标准 GeoJSON，可以直接：

- ArcGIS Online / Experience Builder：**Add layer from URL** 填 feed 地址
- QGIS：图层 → 添加图层 → 添加矢量图层 → 协议 → GeoJSON
- Mapbox Studio / Felt / Kepler.gl：直接粘贴 URL

---

## 三、数据结构

### `data/latest.geojson`

```jsonc
{
  "type": "FeatureCollection",
  "properties": { "generated": "<ISO 时间>", "data_date": "YYYY-MM-DD" },
  "features": [
    { "properties": { "kind": "russian_control", "area_km2": 117027,
                      "pct_of_ukraine": 19.39, "source": "DeepStateMap" }, ... },
    { "properties": { "kind": "contact_line", "source": "derived from DeepStateMap" }, ... },
    { "properties": { "kind": "ukrainian_control_in_russia", "area_km2": 5.2,
                      "source": "ISW-assessed, schematic geometry" }, ... }
  ]
}
```

### 其它文件

| 文件 | 更新 | 内容 |
|---|---|---|
| `data/base.json` | 静态 | 底图：国界、州界、等深带、水系、水库、建成区、铁路、地名库、战役方向 |
| `data/history.json` | 静态 | 2022-02-24 → 2024-07-07 的 16 个示意性重建帧 |
| `data/current.json` | 每日 | 2024-07-08 至今的双周帧 + 当日帧 |
| `data/series.json` | 每日 | 逐日面积序列（794 个点起） |
| `data/meta.json` | 每日 | 构建时间、数据日期、当前面积、数据源清单 |

---

## 四、数据来源与必须知道的偏差

**2024-07-08 至今**：DeepStateMap.Live 逐日占领区 GeoJSON（经 GitHub 镜像 `cyterat/deepstate-map-data` 获取，每日 03:00 UTC 更新）。本项目独立计算的面积与公开引用值偏差在 **0.05% 以内**。

**2022-02-24 — 2024-07-07**：没有可批量获取的高保真逐日数据，依据 ISW／Critical Threats 每日战况评估与公开战史重建了 16 个关键日期，**精度约 5–10 km**，页面上以斜纹与虚线区分。

**库尔斯克方向**：乌军控制的俄罗斯领土同样是示意性重建，**面积读数一律采用 ISW 的有出处数字**，不用几何面积（残余阵地只有几 km²，在国家尺度上是亚像素的，几何必然偏大）。

### 使用这份数据前请注意

- **ISW 采用"最远推进范围"制图法**——一块地进入地图后，除非有确凿证据证明俄军已撤出，否则一直保留。在渗透式作战下会**系统性高估**俄控范围。
- **DeepState 出于行动保密延迟公布乌军战果**，近实时数据中乌控面积被系统性低估。
- **两家对总面积的估计相差约 1,400 km²**。
- **"渗透"不等于"控制"**——一个居民点可以被渗透数周而不易手。
- **部分地段不存在连续战线**，画成一条清晰的线本身就是简化。
- AI 伪造的"占领"视频已进入战场情报，地理定位画面不能自动视为可信证据。

克里米亚与塞瓦斯托波尔按国际公认边界计为乌克兰领土。面积百分比以乌克兰国土 **603,548 km²** 为分母。

---

## 五、本地开发

```bash
pip install -r build/requirements.txt
python build/update.py          # 刷新 data/
python3 -m http.server 8000     # 然后打开 http://localhost:8000/
```

`build/update.py` 只依赖 `requests` / `shapely` / `pyproj`，跑一次约 1–2 分钟（首次会补齐面积序列，之后每天只增量拉一天）。静态输入在 `build/static/`，不需要 geopandas。

## 六、许可与署名

代码可自由使用。数据请按来源署名：

- 控制区数据 © **DeepStateMap.Live**
- 战况评估 © **Institute for the Study of War / Critical Threats Project**
- 底图 **Natural Earth**（公有领域）、**geoBoundaries**（CC BY 4.0）、**GeoNames**（CC BY 4.0）

在线瓦片底图（OpenStreetMap / ArcGIS）的署名由页面在使用时自动显示。
