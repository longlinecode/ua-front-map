#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Daily refresh for the Ukraine situation map.

Pulls the newest DeepStateMap occupied-area GeoJSON from its GitHub mirror,
recomputes areas and the contact line, and rewrites:

    data/current.json    fortnightly frames from 2024-07-08 to today
    data/series.json     the full daily area series
    data/latest.geojson  today's control as plain GeoJSON  <- the public feed
    data/meta.json       build stamp and source dates

Static files (data/base.json, data/history.json) are not touched.

Dependencies: requests, shapely, pyproj  — deliberately light so CI is fast.
"""
from __future__ import annotations
import json, os, sys, datetime as dt
from concurrent.futures import ThreadPoolExecutor

import requests
from shapely.geometry import shape, mapping, Point
from shapely.ops import unary_union, transform
from shapely.validation import make_valid
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

MIRROR = ("https://raw.githubusercontent.com/cyterat/deepstate-map-data/"
          "main/data/deepstatemap_data_{}.geojson")
FIRST = dt.date(2024, 7, 8)          # first day the mirror carries
UA_OFFICIAL = 603548.0               # km2, official area of Ukraine
Q = 1000.0                           # coordinate quantisation, 1/1000 deg

# equal-area projection centred on Ukraine, for area maths only
EA = ("+proj=aea +lat_1=45 +lat_2=52 +lat_0=48.5 +lon_0=31 "
      "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs")
_to_ea = Transformer.from_crs("EPSG:4326", EA, always_xy=True).transform
def km2(geom):
    return transform(_to_ea, geom).area / 1e6


# --------------------------------------------------------------------------
def log(*a):
    print(*a, flush=True)


def fetch_day(d: dt.date):
    r = requests.get(MIRROR.format(d.strftime("%Y%m%d")), timeout=60)
    if r.status_code != 200:
        return None
    try:
        gj = r.json()
    except Exception:
        return None
    g = unary_union([make_valid(shape(f["geometry"])) for f in gj["features"]])
    return g.buffer(0)


def enc_rings(geom, tol):
    """Polygon(s) -> delta-encoded integer rings, matching the page's decoder."""
    g = geom.simplify(tol, preserve_topology=True).buffer(0)
    polys = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    out = []
    for p in polys:
        for ring in [p.exterior] + list(p.interiors):
            cs = [(round(x * Q), round(y * Q)) for x, y in ring.coords]
            if len(cs) < 4:
                continue
            arr = [cs[0][0], cs[0][1]]
            for i in range(1, len(cs)):
                arr += [cs[i][0] - cs[i - 1][0], cs[i][1] - cs[i - 1][1]]
            out.append(arr)
    return out


def enc_lines(geom, tol):
    if geom is None or geom.is_empty:
        return []
    parts = ([geom] if geom.geom_type == "LineString"
             else [g for g in getattr(geom, "geoms", []) if g.geom_type == "LineString"])
    out = []
    for ln in parts:
        if ln.length < 0.02:
            continue
        cs = [(round(x * Q), round(y * Q)) for x, y in ln.simplify(tol).coords]
        if len(cs) < 2:
            continue
        arr = [cs[0][0], cs[0][1]]
        for i in range(1, len(cs)):
            arr += [cs[i][0] - cs[i - 1][0], cs[i][1] - cs[i - 1][1]]
        out.append(arr)
    return out


# --------------------------------------------------------------------------
def main():
    ua = shape(json.load(open(os.path.join(STATIC, "ua_outline.json"))))
    ua_inner = ua.buffer(-0.035)
    oblasts = json.load(open(os.path.join(STATIC, "oblasts.json")))
    obl_geoms = [(o["n"], o["cn"], shape(o["g"])) for o in oblasts]
    obl_area = {n: km2(g) for n, _, g in obl_geoms}

    today = dt.date.today()
    # 1. locate the newest published day (mirror updates 03:00 UTC)
    newest, newest_geom = None, None
    for back in range(0, 8):
        d = today - dt.timedelta(days=back)
        g = fetch_day(d)
        if g is not None:
            newest, newest_geom = d, g
            log(f"newest DeepState snapshot: {d}")
            break
    if newest is None:
        log("!! no snapshot found in the last 8 days — leaving data unchanged")
        return 1

    # 2. fortnightly frames from FIRST to newest, plus the newest day itself
    wanted = []
    d = FIRST
    while d < newest:
        wanted.append(d)
        d += dt.timedelta(days=14)
    wanted.append(newest)

    old = {}
    cur_path = os.path.join(DATA, "current.json")
    if os.path.exists(cur_path):
        old = {f["d"]: f for f in json.load(open(cur_path))["frames"]}

    def build(d):
        key = d.isoformat()
        if key in old and d != newest:
            return old[key]                      # already computed, unchanged
        g = newest_geom if d == newest else fetch_day(d)
        if g is None:
            return old.get(key)
        a = km2(g)
        occ = {}
        for n, _cn, og in obl_geoms:
            try:
                f = og.intersection(g).area / og.area
            except Exception:
                f = 0.0
            if f > 0.002:
                occ[n] = round(100 * f, 1)
        try:
            fl = g.boundary.intersection(ua_inner)
        except Exception:
            fl = None
        return dict(d=key, ru=enc_rings(g, 0.006), fl=enc_lines(fl, 0.006),
                    grey=[], grey_km2=0.0, kur=[], kfl=[], kkm2=0.0,
                    km2=round(a), pct=round(100 * a / UA_OFFICIAL, 2),
                    cap="", ph=-1, occ=occ, src="deepstate")

    with ThreadPoolExecutor(8) as ex:
        frames = [f for f in ex.map(build, wanted) if f]
    log(f"frames: {len(frames)}  (newest {frames[-1]['d']}, "
        f"{frames[-1]['km2']:,} km2, {frames[-1]['pct']}%)")

    # captions and phase indices come from the static history file
    tpl = json.load(open(os.path.join(STATIC, "captions.json")))
    for f in frames:
        f["cap"] = pick(tpl["late"], f["d"])
        f["ph"] = pick_phase(tpl["phases"], f["d"])
    # carry the Kursk layer forward from the static milestones
    kur = json.load(open(os.path.join(STATIC, "kursk.json")))
    for f in frames:
        k = pick_kursk(kur, f["d"])
        if k:
            f["kur"], f["kfl"], f["kkm2"] = k["rings"], k["fl"], k["km2"]

    json.dump(dict(frames=frames), open(cur_path, "w"),
              separators=(",", ":"), ensure_ascii=False)

    # 3. full daily area series
    ser_path = os.path.join(DATA, "series.json")
    ser = json.load(open(ser_path))
    known = {s["d"] for s in ser["series"]}
    add = []
    d = max((dt.date.fromisoformat(s["d"]) for s in ser["series"]
             if s["s"] == "d"), default=FIRST) + dt.timedelta(days=1)
    days = []
    while d <= newest:
        if d.isoformat() not in known:
            days.append(d)
        d += dt.timedelta(days=1)
    if days:
        with ThreadPoolExecutor(8) as ex:
            for dd, g in zip(days, ex.map(fetch_day, days)):
                if g is not None:
                    add.append(dict(d=dd.isoformat(), km2=round(km2(g)), g=0, s="d"))
        ser["series"] = sorted(ser["series"] + add, key=lambda s: s["d"])
        json.dump(ser, open(ser_path, "w"), separators=(",", ":"), ensure_ascii=False)
        log(f"series: +{len(add)} days, now {len(ser['series'])} points")

    # 4. the public feed: today's control as plain GeoJSON
    feats = [dict(type="Feature",
                  properties=dict(kind="russian_control", date=newest.isoformat(),
                                  area_km2=round(km2(newest_geom)),
                                  pct_of_ukraine=round(100*km2(newest_geom)/UA_OFFICIAL, 2),
                                  source="DeepStateMap"),
                  geometry=mapping(newest_geom.simplify(0.002, preserve_topology=True)))]
    try:
        cl = newest_geom.boundary.intersection(ua_inner)
        if not cl.is_empty:
            feats.append(dict(type="Feature",
                              properties=dict(kind="contact_line",
                                              date=newest.isoformat(),
                                              source="derived from DeepStateMap"),
                              geometry=mapping(cl.simplify(0.002))))
    except Exception:
        pass
    kk = pick_kursk_geo(kur, newest.isoformat())
    if kk:
        feats.append(dict(type="Feature",
                          properties=dict(kind="ukrainian_control_in_russia",
                                          date=newest.isoformat(),
                                          area_km2=kk["km2"],
                                          source="ISW-assessed, schematic geometry"),
                          geometry=kk["geojson"]))
    fc = dict(type="FeatureCollection",
              properties=dict(generated=dt.datetime.now(dt.timezone.utc).isoformat(),
                              data_date=newest.isoformat()),
              features=feats)
    json.dump(fc, open(os.path.join(DATA, "latest.geojson"), "w"),
              separators=(",", ":"), ensure_ascii=False)

    # 5. build stamp
    json.dump(dict(built=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                   data_date=newest.isoformat(),
                   russian_control_km2=round(km2(newest_geom)),
                   pct_of_ukraine=round(100 * km2(newest_geom) / UA_OFFICIAL, 2),
                   frames=len(frames),
                   sources=["DeepStateMap.Live via cyterat/deepstate-map-data",
                            "ISW / Critical Threats Project daily assessments",
                            "Natural Earth 10m", "geoBoundaries UKR ADM1"]),
              open(os.path.join(DATA, "meta.json"), "w"),
              indent=2, ensure_ascii=False)
    log("done")
    return 0


def pick(table, iso):
    got = [t["t"] for t in table if t["d"] <= iso]
    return got[-1] if got else ""


def pick_phase(phases, iso):
    for i, p in enumerate(phases):
        if p["a"] <= iso < p["b"]:
            return i
    return -1


def pick_kursk(kur, iso):
    got = [k for k in kur if k["d"] <= iso]
    return got[-1] if got else None


def pick_kursk_geo(kur, iso):
    k = pick_kursk(kur, iso)
    return k if k and k.get("geojson") else None


if __name__ == "__main__":
    sys.exit(main())
