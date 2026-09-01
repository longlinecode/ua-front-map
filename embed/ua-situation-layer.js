/*!
 * ua-situation-layer — drop the Ukraine front line into an existing map.
 *
 * Framework-agnostic: it fetches the feed, normalises it, and hands you plain
 * GeoJSON plus ready-made adapters for MapLibre / Mapbox GL, Leaflet, deck.gl,
 * ArcGIS Maps SDK and Cesium. No dependencies, no build step, ESM + UMD.
 *
 *   import { UAFront } from "./ua-situation-layer.js";
 *   const front = new UAFront({ feed: "https://<you>.github.io/<repo>/data" });
 *   await front.load();
 *   front.addToMapLibre(map);            // or addToLeaflet / addToDeck / ...
 *   front.on("update", s => console.log(s.date, s.russianControlKm2));
 *   front.startAutoRefresh(6 * 3600e3);  // re-check every 6 h
 *
 * Layer ids / pane names it creates, so you can order them yourself:
 *   ua-front-russian-control   fill      Russian-held area
 *   ua-front-contact-line      line      the contact line only (no coast/border)
 *   ua-front-ua-in-russia      fill      Ukrainian-held ground inside Russia
 *
 * Data: DeepStateMap (daily) + ISW/CTP assessments. See the repo README for the
 * accuracy caveats — this is OSINT, not a survey product.
 */
const DEFAULTS = {
  feed: "data",
  colors: {
    russian: "#B0524C", russianLine: "#7C2F2A",
    contact: "#C2410C",
    uaInRussia: "#3D77AE", uaInRussiaLine: "#26527E",
  },
  opacity: { fill: 0.55, uaFill: 0.6 },
  lineWidth: { contact: 2.4, outline: 0.8 },
};

const KIND = {
  RU: "russian_control",
  CONTACT: "contact_line",
  UA_RU: "ukrainian_control_in_russia",
};

export class UAFront {
  constructor(opts = {}) {
    this.o = {
      ...DEFAULTS, ...opts,
      colors: { ...DEFAULTS.colors, ...(opts.colors || {}) },
      opacity: { ...DEFAULTS.opacity, ...(opts.opacity || {}) },
      lineWidth: { ...DEFAULTS.lineWidth, ...(opts.lineWidth || {}) },
    };
    this.feed = this.o.feed.replace(/\/$/, "");
    this.data = null;      // the whole FeatureCollection
    this.meta = null;      // data/meta.json
    this._handlers = { update: [], error: [] };
    this._timer = null;
    this._bound = [];      // {refresh(), remove()}
  }

  /* ---------------- data ---------------- */

  async load() {
    const bust = "?t=" + Math.floor(Date.now() / 60000);   // 1-minute cache key
    const [fc, meta] = await Promise.all([
      fetch(this.feed + "/latest.geojson" + bust).then(this._ok),
      fetch(this.feed + "/meta.json" + bust).then(this._ok).catch(() => null),
    ]);
    this.data = fc;
    this.meta = meta;
    this._emit("update", this.status());
    return this;
  }

  _ok(r) {
    if (!r.ok) throw new Error("UAFront: HTTP " + r.status + " for " + r.url);
    return r.json();
  }

  feature(kind) {
    return (this.data?.features || []).find(f => f.properties.kind === kind) || null;
  }

  collection(kind) {
    const f = this.feature(kind);
    return { type: "FeatureCollection", features: f ? [f] : [] };
  }

  /** Everything a caller normally wants to show in their own chrome. */
  status() {
    const ru = this.feature(KIND.RU)?.properties || {};
    const ua = this.feature(KIND.UA_RU)?.properties || {};
    return {
      date: this.data?.properties?.data_date || ru.date || null,
      generated: this.data?.properties?.generated || null,
      russianControlKm2: ru.area_km2 ?? null,
      pctOfUkraine: ru.pct_of_ukraine ?? null,
      ukrainianControlInRussiaKm2: ua.area_km2 ?? 0,
      sources: this.meta?.sources || [],
    };
  }

  on(evt, fn) { (this._handlers[evt] ||= []).push(fn); return this; }
  _emit(evt, arg) { (this._handlers[evt] || []).forEach(f => { try { f(arg); } catch (e) { console.error(e); } }); }

  /** Poll the feed; layers already added refresh themselves in place. */
  startAutoRefresh(ms = 6 * 3600e3) {
    this.stopAutoRefresh();
    this._timer = setInterval(async () => {
      const before = this.status().date;
      try {
        await this.load();
        if (this.status().date !== before) this._bound.forEach(b => b.refresh());
      } catch (e) { this._emit("error", e); }
    }, ms);
    return this;
  }
  stopAutoRefresh() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  /** Remove every layer this instance added, from every map. */
  removeAll() { this._bound.splice(0).forEach(b => { try { b.remove(); } catch (e) {} }); }

  _need() { if (!this.data) throw new Error("UAFront: call await load() first"); }

  /* ---------------- MapLibre GL / Mapbox GL ---------------- */

  addToMapLibre(map, { before, ids = {} } = {}) {
    this._need();
    const c = this.o.colors, id = {
      ru: ids.ru || "ua-front-russian-control",
      cl: ids.contact || "ua-front-contact-line",
      ua: ids.uaInRussia || "ua-front-ua-in-russia",
    };
    const src = {
      ru: id.ru + "-src", cl: id.cl + "-src", ua: id.ua + "-src",
    };
    const set = () => {
      for (const [k, kind] of [["ru", KIND.RU], ["cl", KIND.CONTACT], ["ua", KIND.UA_RU]]) {
        const gj = this.collection(kind);
        if (map.getSource(src[k])) map.getSource(src[k]).setData(gj);
        else map.addSource(src[k], { type: "geojson", data: gj });
      }
    };
    set();
    if (!map.getLayer(id.ru)) {
      map.addLayer({ id: id.ru, type: "fill", source: src.ru,
        paint: { "fill-color": c.russian, "fill-opacity": this.o.opacity.fill } }, before);
      map.addLayer({ id: id.ru + "-outline", type: "line", source: src.ru,
        paint: { "line-color": c.russianLine, "line-width": this.o.lineWidth.outline } }, before);
      map.addLayer({ id: id.ua, type: "fill", source: src.ua,
        paint: { "fill-color": c.uaInRussia, "fill-opacity": this.o.opacity.uaFill } }, before);
      map.addLayer({ id: id.ua + "-outline", type: "line", source: src.ua,
        paint: { "line-color": c.uaInRussiaLine, "line-width": this.o.lineWidth.outline } }, before);
      map.addLayer({ id: id.cl, type: "line", source: src.cl,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.contact, "line-width": this.o.lineWidth.contact } }, before);
    }
    const handle = {
      refresh: set,
      remove: () => {
        [id.cl, id.ua + "-outline", id.ua, id.ru + "-outline", id.ru]
          .forEach(l => map.getLayer(l) && map.removeLayer(l));
        Object.values(src).forEach(s => map.getSource(s) && map.removeSource(s));
      },
      layerIds: [id.ru, id.ru + "-outline", id.ua, id.ua + "-outline", id.cl],
    };
    this._bound.push(handle);
    return handle;
  }

  addToMapbox(map, opts) { return this.addToMapLibre(map, opts); }

  /* ---------------- Leaflet ---------------- */

  addToLeaflet(map, L, { pane } = {}) {
    this._need();
    const c = this.o.colors;
    const group = L.layerGroup().addTo(map);
    const build = () => {
      group.clearLayers();
      L.geoJSON(this.collection(KIND.RU), {
        pane, style: { color: c.russianLine, weight: this.o.lineWidth.outline,
                       fillColor: c.russian, fillOpacity: this.o.opacity.fill },
      }).addTo(group);
      L.geoJSON(this.collection(KIND.UA_RU), {
        pane, style: { color: c.uaInRussiaLine, weight: this.o.lineWidth.outline,
                       fillColor: c.uaInRussia, fillOpacity: this.o.opacity.uaFill },
      }).addTo(group);
      L.geoJSON(this.collection(KIND.CONTACT), {
        pane, style: { color: c.contact, weight: this.o.lineWidth.contact,
                       lineCap: "round", lineJoin: "round" },
      }).addTo(group);
    };
    build();
    const handle = { refresh: build, remove: () => map.removeLayer(group), group };
    this._bound.push(handle);
    return handle;
  }

  /* ---------------- deck.gl ---------------- */

  /** Returns deck.gl layer instances; you own the deck and re-render. */
  deckLayers(GeoJsonLayer, { idPrefix = "ua-front" } = {}) {
    this._need();
    const c = this.o.colors, hex = h => [
      parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const v = this.status().date;
    return [
      new GeoJsonLayer({
        id: idPrefix + "-russian-control", data: this.collection(KIND.RU),
        filled: true, stroked: true, getFillColor: [...hex(c.russian), 140],
        getLineColor: hex(c.russianLine), lineWidthMinPixels: 1, updateTriggers: { data: v },
      }),
      new GeoJsonLayer({
        id: idPrefix + "-ua-in-russia", data: this.collection(KIND.UA_RU),
        filled: true, stroked: true, getFillColor: [...hex(c.uaInRussia), 155],
        getLineColor: hex(c.uaInRussiaLine), lineWidthMinPixels: 1, updateTriggers: { data: v },
      }),
      new GeoJsonLayer({
        id: idPrefix + "-contact-line", data: this.collection(KIND.CONTACT),
        stroked: true, filled: false, getLineColor: hex(c.contact),
        lineWidthMinPixels: 2, updateTriggers: { data: v },
      }),
    ];
  }

  /* ---------------- ArcGIS Maps SDK for JavaScript ---------------- */

  /** `mods` = {GeoJSONLayer}. Returns the layers; add them to your map. */
  arcgisLayers({ GeoJSONLayer }) {
    this._need();
    const c = this.o.colors, url = k => URL.createObjectURL(
      new Blob([JSON.stringify(this.collection(k))], { type: "application/json" }));
    return [
      new GeoJSONLayer({ url: url(KIND.RU), title: "俄军实际控制", renderer: { type: "simple",
        symbol: { type: "simple-fill", color: c.russian + "8C",
                  outline: { color: c.russianLine, width: 0.8 } } } }),
      new GeoJSONLayer({ url: url(KIND.UA_RU), title: "乌军控制俄境", renderer: { type: "simple",
        symbol: { type: "simple-fill", color: c.uaInRussia + "99",
                  outline: { color: c.uaInRussiaLine, width: 0.8 } } } }),
      new GeoJSONLayer({ url: url(KIND.CONTACT), title: "接触线", renderer: { type: "simple",
        symbol: { type: "simple-line", color: c.contact, width: 2.4 } } }),
    ];
  }

  /* ---------------- Cesium ---------------- */

  async addToCesium(viewer, Cesium) {
    this._need();
    const c = this.o.colors;
    const add = async (kind, fill, stroke) => {
      const ds = await Cesium.GeoJsonDataSource.load(this.collection(kind), {
        fill: fill ? Cesium.Color.fromCssColorString(fill).withAlpha(0.55) : undefined,
        stroke: Cesium.Color.fromCssColorString(stroke), strokeWidth: 3, clampToGround: true,
      });
      await viewer.dataSources.add(ds);
      return ds;
    };
    const sources = [
      await add(KIND.RU, c.russian, c.russianLine),
      await add(KIND.UA_RU, c.uaInRussia, c.uaInRussiaLine),
      await add(KIND.CONTACT, null, c.contact),
    ];
    const handle = {
      refresh: async () => { sources.forEach(s => viewer.dataSources.remove(s, true)); },
      remove: () => sources.forEach(s => viewer.dataSources.remove(s, true)),
      sources,
    };
    this._bound.push(handle);
    return handle;
  }
}

export default UAFront;
export { KIND as UA_FRONT_KINDS };

/* UMD-ish global for non-module pages */
if (typeof window !== "undefined") window.UAFront = UAFront;
