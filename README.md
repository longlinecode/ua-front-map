# Russo-Ukrainian War · Situation Map

A daily-updating interactive map of the Russo-Ukrainian front line, plus a plain
GeoJSON feed that any mapping application can load as a layer.

- **Web page** — `index.html`: the full interactive map (pan/zoom, a timeline back
  to February 2022, 12 layers, 3 cartographic styles, 6 basemaps, 7 languages)
- **Data feed** — `data/latest.geojson`: today's Russian-controlled area, the line
  of contact, and Ukrainian-held Russian territory
- **Layer adapter** — `embed/ua-situation-layer.js`: MapLibre / Mapbox / Leaflet /
  deck.gl / ArcGIS / Cesium

GitHub Actions refreshes the data and republishes the site every day at 04:10 UTC.

**Live:** https://longlinecode.github.io/ua-front-map/

---

## 1 · Deployment (about 5 minutes)

1. Create a GitHub repository and push the contents of this directory to `main`.
2. **Settings → Pages → Build and deployment → Source** → **GitHub Actions**.
3. **Settings → Actions → General → Workflow permissions** → **Read and write
   permissions** (the workflow commits the refreshed data back to the repo).
4. Open the **Actions** tab and run `Update front-line data` once by hand to verify.

You then have:

| | |
|---|---|
| Web page | `https://<user>.github.io/<repo>/` |
| Data feed | `https://<user>.github.io/<repo>/data/latest.geojson` |
| Build status | `https://<user>.github.io/<repo>/data/meta.json` |

Both the page and the feed are public — anyone with the link can open them, no
login required. GitHub Pages serves static assets with
`Access-Control-Allow-Origin: *`, so your own application can fetch the feed
cross-origin.

> **Note:** `index.html` must be served over HTTP (it fetches `data/*.json`).
> For a local preview run `python3 -m http.server 8000` and open
> `http://localhost:8000/`; opening the file directly will be blocked by the
> same-origin policy.

---

## 2 · Using it as a layer in your own map

The recommended architecture is not an iframe but letting your map consume the
feed directly, so layer order, styling, interaction and popups all stay under
your control.

### Minimal: three lines

```js
import { UAFront } from "https://<user>.github.io/<repo>/embed/ua-situation-layer.js";

const front = new UAFront({ feed: "https://<user>.github.io/<repo>/data" });
await front.load();
front.addToMapLibre(map);        // or addToLeaflet(map, L) / deckLayers(GeoJsonLayer) / ...
```

### Layers it creates (fixed ids, so you can order them)

| Layer id | Type | Meaning |
|---|---|---|
| `ua-front-russian-control` | fill | Russian-controlled area |
| `ua-front-russian-control-outline` | line | its outline |
| `ua-front-ua-in-russia` | fill | Ukrainian-held Russian territory (Kursk / Belgorod) |
| `ua-front-ua-in-russia-outline` | line | its outline |
| `ua-front-contact-line` | line | **the line of contact** — coastline and international border removed, so this is the fighting front only |

Insert them beneath one of your own layers with
`front.addToMapLibre(map, { before: "your-labels-layer" })`.

### Readouts and auto-refresh

```js
front.on("update", s => {
  // s.date, s.russianControlKm2, s.pctOfUkraine,
  // s.ukrainianControlInRussiaKm2, s.sources
  hud.textContent = `${s.russianControlKm2.toLocaleString()} km² (${s.pctOfUkraine}%)`;
});
front.startAutoRefresh(6 * 3600e3);   // check every 6h; redraws only if the data date changed
```

### Framework adapters

```js
front.addToMapLibre(map, { before });          // MapLibre GL
front.addToMapbox(map, { before });            // Mapbox GL (same API)
front.addToLeaflet(map, L, { pane });          // Leaflet
front.deckLayers(GeoJsonLayer);                // deck.gl — returns layers for you to render
front.arcgisLayers({ GeoJSONLayer });          // ArcGIS Maps SDK for JavaScript
await front.addToCesium(viewer, Cesium);       // CesiumJS (clamped to ground)
```

Using something else? Take the raw GeoJSON:

```js
front.collection("russian_control")             // FeatureCollection
front.collection("contact_line")
front.collection("ukrainian_control_in_russia")
front.data                                      // all three, as one FeatureCollection
```

A complete runnable example is in `embed/examples/maplibre.html`.

### Without writing any code

`data/latest.geojson` is standard GeoJSON, so it drops straight into:

- ArcGIS Online / Experience Builder — **Add layer from URL**
- QGIS — Layer → Add Layer → Add Vector Layer → Protocol → GeoJSON
- Mapbox Studio / Felt / Kepler.gl — paste the URL

---

## 3 · Data structures

### `data/latest.geojson`

```jsonc
{
  "type": "FeatureCollection",
  "properties": { "generated": "<ISO timestamp>", "data_date": "YYYY-MM-DD" },
  "features": [
    { "properties": { "kind": "russian_control", "area_km2": 117027,
                      "pct_of_ukraine": 19.39, "source": "DeepStateMap" }, ... },
    { "properties": { "kind": "contact_line", "source": "derived from DeepStateMap" }, ... },
    { "properties": { "kind": "ukrainian_control_in_russia", "area_km2": 5.2,
                      "source": "ISW-assessed, schematic geometry" }, ... }
  ]
}
```

### Other files

| File | Updated | Contents |
|---|---|---|
| `data/base.json` | static | Basemap: international and oblast boundaries, bathymetry, rivers, reservoirs, built-up areas, railways, gazetteer, axes of advance |
| `data/history.json` | static | 16 schematic reconstruction frames, 2022-02-24 → 2024-07-07 |
| `data/current.json` | daily | Fortnightly frames from 2024-07-08 plus today |
| `data/series.json` | daily | Daily area series (794 points and counting) |
| `data/meta.json` | daily | Build timestamp, data date, current area, source list |

---

## 4 · Sources, and the biases you must know about

**From 2024-07-08:** DeepStateMap.Live daily occupied-area GeoJSON, obtained via
the GitHub mirror `cyterat/deepstate-map-data` (updated 03:00 UTC daily). Areas
computed independently here agree with published figures to within **0.05%**.

**2022-02-24 – 2024-07-07:** No high-fidelity daily data is available in bulk for
this period, so 16 key dates were reconstructed from ISW / Critical Threats daily
assessments and published war history. Accuracy is roughly **5–10 km**; these
frames are drawn with hatching and dashed lines to distinguish them.

**Kursk axis:** Ukrainian-held Russian territory is likewise a schematic
reconstruction. **Area readouts always use ISW's sourced figures**, never the
drawn geometry — the residual positions are only a few km², which is sub-pixel at
national scale, so geometry would necessarily overstate them.

### Read this before using the data

- **ISW maps the furthest extent of advance.** Once ground enters the map it stays
  unless there is firm evidence of Russian withdrawal. Against infiltration
  tactics this **systematically overstates** Russian control.
- **DeepState delays publishing Ukrainian gains** for operational security, so
  Ukrainian-held area is systematically understated in near-real-time data.
- **The two differ by roughly 1,400 km²** on total area.
- **Infiltration is not control.** A settlement can be infiltrated for weeks
  without changing hands.
- **Some sectors have no continuous front line at all.** Drawing one crisp line is
  itself a simplification.
- AI-fabricated "capture" videos have entered battlefield reporting; geolocated
  footage can no longer be treated as self-evidently reliable.

Crimea and Sevastopol are counted as Ukrainian territory per internationally
recognised borders. Percentages use Ukraine's **603,548 km²** as the denominator.

---

## 5 · Local development

```bash
pip install -r build/requirements.txt
python build/update.py          # refresh data/
python3 -m http.server 8000     # then open http://localhost:8000/
```

`build/update.py` depends only on `requests` / `shapely` / `pyproj` and takes
1–2 minutes (the first run backfills the area series; after that it fetches one
day incrementally). Static inputs live in `build/static/`; geopandas is not
required.

---

## 6 · Licence and attribution

The code is free to use. Please attribute the data to its sources:

- Control-area data © **DeepStateMap.Live**
- Situation assessments © **Institute for the Study of War / Critical Threats Project**
- Basemap: **Natural Earth** (public domain), **geoBoundaries** (CC BY 4.0),
  **GeoNames** (CC BY 4.0)

Attribution for the online tile basemaps (OpenStreetMap / ArcGIS) is displayed by
the page automatically when they are in use.
