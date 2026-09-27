"""Compile cached OSM + DEM for an area into a Godot-ready world tile.

    python worldgen/build.py rincon

Outputs (godot/world/):
    <area>.glb         meshes: ground, kerbs, buildings, roofs, bridges, props, trees
    <area>_ground.jpg  painted ground texture (asphalt, markings, sidewalks, parks)
    <area>.json        spawn point, lamp positions, demo drive paths

Local frame: x = east, y = north, z = up (metres). Exported as glTF Y-up: (x, z, -y).
"""

import heapq
import json
import math
import random
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
import shapely
import shapely.affinity
from PIL import Image, ImageDraw, ImageFilter
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import linemerge, substring, unary_union

from areas import AREAS
from glb import write_glb

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
OUT = ROOT.parent / "godot" / "world"

PPM = 5            # ground texture pixels per metre
CELL = 6.0         # ground mesh dicing cell (m); keeps triangles hugging the terrain
KERB = 0.15        # sidewalk / block height above the road surface
FLOOR_H = 3.6

DRIVE = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link", "residential",
    "unclassified", "living_street", "service", "busway",
}
CITY = {"primary", "secondary", "tertiary", "residential", "unclassified"}
DEFAULT_LANES = {"motorway": 3, "trunk": 2, "primary": 4, "secondary": 3, "tertiary": 2,
                 "residential": 2, "unclassified": 2, "living_street": 1, "service": 1, "busway": 1}
SIDEWALK = {"primary": 3.6, "secondary": 3.6, "tertiary": 3.2, "residential": 2.8,
            "unclassified": 2.5, "living_street": 2.0}
CROSSWALK_CLASSES = CITY | {"living_street"}

C = {  # ground palette (RGB 0-255)
    "lot": (138, 132, 122), "sidewalk": (166, 161, 151), "curb": (186, 181, 170),
    "asphalt": (54, 56, 61), "yellow": (222, 170, 40), "white": (220, 220, 212),
    "grass": (98, 136, 70), "park": (90, 132, 66), "forest": (70, 110, 56), "pitch": (80, 128, 72),
    "parking": (92, 94, 98), "plaza": (178, 168, 150), "path": (186, 174, 150),
    "dirt": (140, 120, 94), "water": (70, 120, 150), "rubber": (150, 90, 70),
}
LANDUSE = {
    ("leisure", "park"): "park", ("leisure", "garden"): "grass", ("leisure", "dog_park"): "dirt",
    ("leisure", "playground"): "rubber", ("leisure", "pitch"): "pitch", ("landuse", "grass"): "grass",
    ("natural", "grassland"): "grass", ("natural", "scrub"): "forest", ("landuse", "forest"): "forest",
    ("natural", "wood"): "forest", ("landuse", "construction"): "dirt", ("amenity", "parking"): "parking",
    ("place", "square"): "plaza", ("natural", "water"): "water",
}
WALL_LOW = [(0.93, 0.89, 0.80), (0.82, 0.90, 0.86), (0.95, 0.83, 0.72), (0.96, 0.93, 0.72),
            (0.84, 0.84, 0.92), (0.97, 0.97, 0.95), (0.78, 0.86, 0.93)]
WALL_MID = [(0.86, 0.80, 0.70), (0.78, 0.76, 0.72), (0.72, 0.52, 0.42), (0.90, 0.88, 0.84),
            (0.64, 0.66, 0.68), (0.80, 0.70, 0.60)]
WALL_GLASS = [(0.55, 0.68, 0.78), (0.42, 0.55, 0.62), (0.70, 0.76, 0.80), (0.38, 0.46, 0.52),
              (0.60, 0.72, 0.70)]
ROOFS = [(0.52, 0.52, 0.50), (0.38, 0.39, 0.41), (0.60, 0.58, 0.54), (0.46, 0.43, 0.39),
         (0.56, 0.58, 0.60), (0.68, 0.67, 0.64), (0.32, 0.33, 0.35)]
STYLE_PUNCHED, STYLE_GLASS, STYLE_PLAIN = 0.0, 0.5, 1.0


# ---------------------------------------------------------------- utilities

def num(s, default=None):
    if s is None:
        return default
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", str(s))
    if not m:
        return default
    v = float(m.group(1))
    return v * 0.3048 if "'" in str(s) or "ft" in str(s) else v


def polys(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for sub in g.geoms for p in polys(sub)]
    return []


def lines(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if hasattr(g, "geoms"):
        return [l for sub in g.geoms for l in lines(sub)]
    return []


def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


class Proj:
    def __init__(self, bbox):
        s, w, n, e = bbox
        self.lat0, self.lon0 = (s + n) / 2, (w + e) / 2
        self.kx = 111320 * math.cos(math.radians(self.lat0))
        self.ky = 110574

    def xy(self, lon, lat):
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def lonlat(self, x, y):
        return self.lon0 + x / self.kx, self.lat0 + y / self.ky


def box_blur(a, r):
    k = 2 * r + 1
    p = np.pad(a, r, mode="edge")
    c = p.cumsum(0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    a = (c[k:] - c[:-k]) / k
    c = a.cumsum(1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return (c[:, k:] - c[:, :-k]) / k


class Terrain:
    def __init__(self, dem_path, meta, proj):
        a = np.array(Image.open(dem_path), dtype=np.float64)
        a[~np.isfinite(a) | (a < -100)] = 0
        self.fine = box_blur(box_blur(a, 1), 1)
        self.coarse = box_blur(box_blur(a, 12), 12)
        self.s, self.w, self.n, self.e = meta["bbox"]
        self.W, self.H = meta["size"]
        self.proj = proj

    def _sample(self, arr, x, y):
        lon, lat = self.proj.lonlat(np.asarray(x, float), np.asarray(y, float))
        c = (lon - self.w) / (self.e - self.w) * self.W - 0.5
        r = (self.n - lat) / (self.n - self.s) * self.H - 0.5
        c = np.clip(c, 0, self.W - 1.001)
        r = np.clip(r, 0, self.H - 1.001)
        c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
        fc, fr = c - c0, r - r0
        return (arr[r0, c0] * (1 - fc) * (1 - fr) + arr[r0, c0 + 1] * fc * (1 - fr)
                + arr[r0 + 1, c0] * (1 - fc) * fr + arr[r0 + 1, c0 + 1] * fc * fr)

    def h(self, x, y):
        return self._sample(self.fine, x, y)

    def h_smooth(self, x, y):
        return self._sample(self.coarse, x, y)

    def normal(self, x, y, d=1.5):
        x, y = np.asarray(x, float), np.asarray(y, float)
        dx = self.h(x + d, y) - self.h(x - d, y)
        dy = self.h(x, y + d) - self.h(x, y - d)
        return unit(np.stack([-dx, -dy, np.full_like(x, 2 * d)], -1))


class Mesh:
    """Accumulates triangles in the local z-up frame; winding is fixed from the normals."""

    def __init__(self):
        self.parts = []
        self.count = 0

    def add(self, pos, nrm, uv, col, tris):
        pos = np.asarray(pos, float).reshape(-1, 3)
        k = len(pos)
        if k == 0:
            return
        nrm = np.broadcast_to(np.asarray(nrm, float), (k, 3))
        uv = np.broadcast_to(np.asarray(uv, float), (k, 2)) if uv is not None else np.zeros((k, 2))
        col = np.asarray(col, float)
        if col.shape[-1] == 3:
            col = np.concatenate([col, np.ones(col.shape[:-1] + (1,))], -1)
        col = np.broadcast_to(col, (k, 4))
        self.parts.append((pos, nrm, uv, col, np.asarray(tris, np.int64).reshape(-1, 3) + self.count))
        self.count += k

    def export(self):
        if not self.parts:
            return {"idx": []}
        pos, nrm, uv, col, idx = (np.concatenate(x) for x in zip(*self.parts))
        a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
        gn = np.cross(b - a, c - a)
        vn = nrm[idx[:, 0]] + nrm[idx[:, 1]] + nrm[idx[:, 2]]
        flip = (gn * vn).sum(1) < 0
        idx[flip] = idx[flip][:, [0, 2, 1]]
        swap = lambda v: np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)
        return {"pos": swap(pos), "nrm": swap(nrm), "uv": uv, "col": col, "idx": idx}


def triangulate(poly):
    poly = orient(poly, 1.0)
    rings = [np.asarray(poly.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in poly.interiors]
    rings = [r for r in rings if len(r) >= 3]
    if not rings:
        return np.zeros((0, 2)), np.zeros((0, 3), int)
    verts = np.concatenate(rings)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    tris = earcut.triangulate_float64(verts, ends).reshape(-1, 3)
    return verts, tris


def add_flat(mesh, poly, z, col, up=True, uv_fn=None):
    verts, tris = triangulate(poly)
    if len(tris) == 0:
        return
    zz = np.broadcast_to(np.asarray(z, float), (len(verts),))
    pos = np.column_stack([verts, zz])
    uv = uv_fn(verts) if uv_fn else verts
    mesh.add(pos, (0, 0, 1 if up else -1), uv, col, tris)


def add_wall_strip(mesh, pts, zb, zt, col, outward, u0=0.0, vref=0.0):
    """Vertical quads along a polyline. outward: +1 faces right of travel, -1 faces left."""
    pts = np.asarray(pts, float)
    if len(pts) < 2:
        return u0
    zb = np.broadcast_to(np.asarray(zb, float), (len(pts),))
    zt = np.broadcast_to(np.asarray(zt, float), (len(pts),))
    a, b = pts[:-1], pts[1:]
    d = b - a
    seg = np.linalg.norm(d, axis=1)
    keep = seg > 1e-4
    a, b, d, seg = a[keep], b[keep], d[keep], seg[keep]
    zb0, zb1 = zb[:-1][keep], zb[1:][keep]
    zt0, zt1 = zt[:-1][keep], zt[1:][keep]
    n = len(a)
    if n == 0:
        return u0
    nrm = np.column_stack([d[:, 1], -d[:, 0], np.zeros(n)]) / seg[:, None] * outward
    u = u0 + np.concatenate([[0], np.cumsum(seg)])
    ua, ub = u[:-1], u[1:]
    pos = np.stack([np.column_stack([a, zb0]), np.column_stack([b, zb1]),
                    np.column_stack([b, zt1]), np.column_stack([a, zt0])], 1).reshape(-1, 3)
    uv = np.stack([np.column_stack([ua, zb0 - vref]), np.column_stack([ub, zb1 - vref]),
                   np.column_stack([ub, zt1 - vref]), np.column_stack([ua, zt0 - vref])], 1).reshape(-1, 2)
    base = np.arange(n)[:, None] * 4
    tris = np.concatenate([base + [0, 1, 2], base + [0, 2, 3]])
    mesh.add(pos, np.repeat(nrm, 4, 0), uv, col, tris)
    return u[-1]


def add_extrusion(walls, top, poly, zb, zt, wall_col, top_col, vref, bottom=None):
    poly = orient(poly, 1.0)
    u = 0.0
    for ring in [poly.exterior, *poly.interiors]:
        u = add_wall_strip(walls, np.asarray(ring.coords), zb, zt, wall_col, +1, u, vref)
    add_flat(top, poly, zt, top_col, up=True)
    if bottom is not None:
        add_flat(bottom, poly, zb, top_col, up=False)


def add_box(mesh, cx, cy, sx, sy, z0, sz, ang, col):
    ca, sa = math.cos(ang), math.sin(ang)
    corners = np.array([[-sx, -sy], [sx, -sy], [sx, sy], [-sx, sy], [-sx, -sy]]) / 2
    rot = corners @ np.array([[ca, sa], [-sa, ca]]) + [cx, cy]
    add_wall_strip(mesh, rot, z0, z0 + sz, col, +1)
    add_flat(mesh, Polygon(rot), z0 + sz, col)


def add_cylinder(mesh, cx, cy, r, z0, h, col, seg=10):
    t = np.linspace(0, 2 * np.pi, seg + 1)
    ring = np.column_stack([cx + r * np.cos(t), cy + r * np.sin(t)])
    add_wall_strip(mesh, ring, z0, z0 + h, col, +1)
    add_flat(mesh, Polygon(ring), z0 + h, col)


def _icosphere():
    t = (1 + 5 ** 0.5) / 2
    v = unit(np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
                       [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], float))
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
         [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5],
         [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    tris = v[np.array(f)]
    mids = unit(np.stack([(tris[:, 0] + tris[:, 1]), (tris[:, 1] + tris[:, 2]), (tris[:, 2] + tris[:, 0])], 1))
    sub = []
    for (a, b, c), (ab, bc, ca) in zip(tris, mids):
        sub += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
    return np.array(sub)  # (80, 3, 3)


ICO = _icosphere()


def add_tree(mesh, x, y, z, rng, scale=1.0):
    trunk_h = 2.2 * scale
    add_box(mesh, x, y, 0.3, 0.3, z, trunk_h + 0.6, rng.uniform(0, 3), (0.36, 0.27, 0.2))
    base_green = np.array(rng.choice([(0.36, 0.52, 0.24), (0.42, 0.56, 0.26), (0.32, 0.47, 0.25),
                                      (0.47, 0.55, 0.28)]))
    for _ in range(rng.randint(2, 4)):
        r = rng.uniform(1.3, 2.1) * scale
        c = np.array([x + rng.uniform(-0.9, 0.9) * scale, y + rng.uniform(-0.9, 0.9) * scale,
                      z + trunk_h + r * rng.uniform(0.7, 1.1)])
        tri = ICO * [r, r, r * 0.85] + c
        pos = tri.reshape(-1, 3)
        fn = unit(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]))
        shade = 0.85 + 0.3 * np.clip(fn[:, 2], 0, 1)[:, None]
        col = np.clip(base_green * shade * rng.uniform(0.92, 1.08), 0, 1)
        mesh.add(pos, np.repeat(fn, 3, 0), None, np.repeat(col, 3, 0), np.arange(len(pos)).reshape(-1, 3))


# ---------------------------------------------------------------- OSM parsing

def road_spec(t):
    hw = t.get("highway")
    if hw not in DRIVE or t.get("area") == "yes":
        return None
    if hw == "service" and t.get("service") in ("parking_aisle",):
        return None
    base = hw.replace("_link", "")
    link = hw.endswith("_link")
    lanes = int(num(t.get("lanes"), 1 if link else DEFAULT_LANES.get(base, 2)))
    lanes = max(1, lanes)
    oneway = t.get("oneway") in ("yes", "1", "true") or base == "motorway" or t.get("junction") == "roundabout"
    lane_w = 3.6 if base in ("motorway", "trunk") else 3.3
    parking = 4.4 if base in CITY and not link else 0.0
    width = num(t.get("width")) or lanes * lane_w + parking + (1.0 if base == "motorway" else 0.0)
    if hw == "service":
        width = min(width, 5.0)
    fwd = int(num(t.get("lanes:forward"), 0)) or (lanes if oneway else lanes - lanes // 2)
    back = 0 if oneway else (int(num(t.get("lanes:backward"), 0)) or lanes - fwd)
    return {"cls": base, "hw": hw, "width": width, "lanes": lanes, "fwd": fwd, "back": back,
            "lane_w": lane_w, "oneway": oneway, "sidewalk": SIDEWALK.get(base, 0.0) if not link else 0.0,
            "layer": int(num(t.get("layer"), 0)), "name": t.get("name", ""),
            "bridge": t.get("bridge") not in (None, "no"), "tunnel": t.get("tunnel") not in (None, "no")}


def load(area):
    d = CACHE / area
    osm = json.loads((d / "osm.json").read_text())["elements"]
    dem_meta = json.loads((d / "dem.json").read_text())
    return osm, dem_meta


def way_poly(proj, geom):
    pts = [proj.xy(g["lon"], g["lat"]) for g in geom if g]
    if len(pts) < 4:
        return None
    p = Polygon(pts)
    if not p.is_valid:
        p = p.buffer(0)
    return p if not p.is_empty else None


def relation_poly(proj, el):
    outers, inners = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or "geometry" not in m:
            continue
        ls = LineString([proj.xy(g["lon"], g["lat"]) for g in m["geometry"] if g])
        (inners if m.get("role") == "inner" else outers).append(ls)
    rings = lambda ls: polys(unary_union([Polygon(l.coords) for l in lines(linemerge(ls)) if l.is_ring]))
    shell = unary_union(rings(outers)) if outers else None
    if shell is None or shell.is_empty:
        return None
    if inners:
        shell = shell.difference(unary_union(rings(inners)))
    return shell


# ---------------------------------------------------------------- build

class World:
    def __init__(self, area):
        self.area = area
        bbox = AREAS[area]
        self.proj = Proj(bbox)
        osm, dem_meta = load(area)
        self.osm = osm
        self.T = Terrain(CACHE / area / "dem.tif", dem_meta, self.proj)
        s, w, n, e = bbox
        self.X0, self.Y0 = self.proj.xy(w, s)
        self.X1, self.Y1 = self.proj.xy(e, n)
        self.clip = box(self.X0, self.Y0, self.X1, self.Y1)
        self.meshes = defaultdict(Mesh)
        self.meta = {"area": area, "bbox_m": [self.X0, self.Y0, self.X1, self.Y1], "lamps": [], "paths": {}}

    # -- parse
    def parse(self):
        P = self.proj
        self.roads, self.bridges = [], []
        self.buildings, self.parts = [], []
        self.landuse = defaultdict(list)
        self.paths = []
        self.trees_osm, self.lamps_osm = [], []
        for el in self.osm:
            t = el.get("tags", {})
            if el["type"] == "node":
                xy = P.xy(el["lon"], el["lat"])
                if t.get("natural") == "tree":
                    self.trees_osm.append(xy)
                elif t.get("highway") == "street_lamp":
                    self.lamps_osm.append(xy)
                continue
            geom = el.get("geometry")
            if el["type"] == "way" and geom:
                pts = [P.xy(g["lon"], g["lat"]) for g in geom if g]
                spec = road_spec(t) if "highway" in t else None
                if spec and not spec["tunnel"] and len(pts) >= 2:
                    ls = LineString(pts)
                    spec["line"] = ls
                    spec["coords"] = [(round(g["lon"], 7), round(g["lat"], 7)) for g in geom if g]
                    (self.bridges if spec["bridge"] else self.roads).append(spec)
                    continue
                hw = t.get("highway")
                if hw in ("footway", "path", "pedestrian", "cycleway") and t.get("footway") not in (
                        "sidewalk", "crossing") and t.get("tunnel") in (None, "no") and t.get("bridge") in (
                        None, "no") and int(num(t.get("layer"), 0)) == 0 and len(pts) >= 2:
                    if t.get("area") == "yes" and len(pts) >= 4:
                        self.landuse["plaza"].append(Polygon(pts).buffer(0))
                    else:
                        self.paths.append((LineString(pts), 4.0 if hw == "pedestrian" else 2.0))
                    continue
            if "building" in t or "building:part" in t:
                if int(num(t.get("layer"), 0)) < 0 or t.get("location") == "underground":
                    continue
                poly = relation_poly(P, el) if el["type"] == "relation" else way_poly(P, geom or [])
                if poly is None or poly.area < 4:
                    continue
                kind = t.get("building:part") or t.get("building")
                if kind in ("no",) or (kind == "roof" and "min_height" not in t):
                    continue
                rec = {"id": el["id"], "poly": poly, "tags": t}
                (self.parts if "building:part" in t else self.buildings).append(rec)
                continue
            if int(num(t.get("layer"), 0)) >= 1:
                continue
            for (k, v), cls in LANDUSE.items():
                if t.get(k) == v:
                    poly = relation_poly(P, el) if el["type"] == "relation" else way_poly(P, geom or [])
                    if poly is not None:
                        self.landuse[cls].append(poly)
                    break

    # -- road network
    def build_network(self):
        self.road_union = unary_union([r["line"].buffer(r["width"] / 2, quad_segs=4) for r in self.roads])
        self.road_union = self.road_union.intersection(self.clip)
        sw = [r["line"].buffer(r["width"] / 2 + r["sidewalk"], quad_segs=4) for r in self.roads if r["sidewalk"]]
        self.sidewalk_union = unary_union(sw).intersection(self.clip).difference(self.road_union)
        self.blocks = self.clip.difference(self.road_union)

        arms = defaultdict(list)
        for ri, r in enumerate(self.roads):
            cs = r["coords"]
            for vi, key in enumerate(cs):
                if vi > 0:
                    arms[key].append((ri, vi, -1))
                if vi < len(cs) - 1:
                    arms[key].append((ri, vi, +1))
        self.intersections = []
        for key, a in arms.items():
            if len(a) >= 3:
                xy = self.proj.xy(*key)
                maxw = max(self.roads[ri]["width"] for ri, _, _ in a)
                self.intersections.append({"xy": xy, "arms": a, "maxw": maxw})
        self.disc_union = unary_union([Point(i["xy"]).buffer(i["maxw"] / 2 + 5.5) for i in self.intersections]) \
            if self.intersections else Polygon()

    # -- ground
    def build_ground(self):
        T = self.T
        W, H = self.X1 - self.X0, self.Y1 - self.Y0
        uv_fn = lambda v: np.column_stack([(v[:, 0] - self.X0) / W, (self.Y1 - v[:, 1]) / H])

        def dice(geom):
            if geom.is_empty:
                return []
            x0, y0, x1, y1 = geom.bounds
            xs = np.arange(math.floor(x0 / CELL) * CELL, x1, CELL)
            ys = np.arange(math.floor(y0 / CELL) * CELL, y1, CELL)
            gx, gy = np.meshgrid(xs, ys)
            boxes = shapely.box(gx.ravel(), gy.ravel(), gx.ravel() + CELL, gy.ravel() + CELL)
            shapely.prepare(geom)
            boxes = boxes[shapely.intersects(geom, boxes)]
            return [p for piece in shapely.intersection(boxes, geom) for p in polys(piece) if p.area > 0.01]

        for name, geom, off in (("ground_road", self.road_union, 0.0), ("ground_block", self.blocks, KERB)):
            mesh = self.meshes[name]
            for piece in dice(geom):
                verts, tris = triangulate(piece)
                if len(tris) == 0:
                    continue
                z = T.h(verts[:, 0], verts[:, 1]) + off
                mesh.add(np.column_stack([verts, z]), T.normal(verts[:, 0], verts[:, 1]), uv_fn(verts), (1, 1, 1),
                         tris)

        kerb = self.meshes["kerb"]
        for poly in polys(self.blocks):
            poly = orient(shapely.segmentize(poly, 2.0), 1.0)
            for ring in [poly.exterior, *poly.interiors]:
                c = np.asarray(ring.coords)
                h = T.h(c[:, 0], c[:, 1])
                add_wall_strip(kerb, c, h - 0.3, h + KERB, (0.84, 0.82, 0.78), +1)

    # -- ground texture
    def paint_ground(self, out_png):
        W = int(round((self.X1 - self.X0) * PPM))
        H = int(round((self.Y1 - self.Y0) * PPM))
        img = Image.new("RGB", (W, H), C["lot"])

        def to_px(coords):
            c = np.asarray(coords)
            return [((x - self.X0) * PPM, (self.Y1 - y) * PPM) for x, y in c]

        def paint(geom, color):
            ps = sorted(polys(geom), key=lambda p: -p.area)
            if not ps:
                return
            mask = Image.new("L", (W, H), 0)
            d = ImageDraw.Draw(mask)
            for p in ps:
                d.polygon(to_px(p.exterior.coords), fill=255)
                for r in p.interiors:
                    d.polygon(to_px(r.coords), fill=0)
            img.paste(color, (0, 0), mask)

        for cls in ("parking", "plaza", "dirt", "grass", "park", "forest", "pitch", "rubber", "water"):
            if self.landuse.get(cls):
                paint(unary_union(self.landuse[cls]).intersection(self.clip), C[cls])
        if self.landuse.get("plaza"):
            paint(unary_union(self.landuse["plaza"]).intersection(self.clip), C["plaza"])
        if self.paths:
            paint(unary_union([l.buffer(w / 2) for l, w in self.paths]).intersection(self.clip), C["path"])
        paint(self.sidewalk_union, C["sidewalk"])
        paint(self.road_union.boundary.buffer(0.35).intersection(self.blocks), C["curb"])
        paint(self.road_union, C["asphalt"])

        white, yellow = [], []
        for r in self.roads:
            if r["cls"] in ("service", "busway", "living_street"):
                continue
            line = r["line"]
            lw = r["lane_w"]
            tw = r["lanes"] * lw
            def off(d):
                try:
                    return lines(line.offset_curve(d, quad_segs=4))
                except Exception:
                    return []
            if r["oneway"]:
                dividers = [-tw / 2 + k * lw for k in range(1, r["lanes"])]
                if r["cls"] == "motorway":
                    for d in (-tw / 2 + 0.3, tw / 2 - 0.3):
                        white += [l.buffer(0.1, cap_style="flat") for l in off(d)]
            else:
                c = -tw / 2 + r["fwd"] * lw
                for d in (c - 0.22, c + 0.22):
                    yellow += [l.buffer(0.1, cap_style="flat") for l in off(d)]
                dividers = [-tw / 2 + k * lw for k in range(1, r["fwd"])]
                dividers += [c + k * lw for k in range(1, r["back"])]
            for d in dividers:
                for l in off(d):
                    L = l.length
                    for s in np.arange(0, L, 9.0):
                        seg = substring(l, s, min(s + 3.0, L))
                        if seg.length > 0.5:
                            white.append(seg.buffer(0.1, cap_style="flat"))

        crossings = []
        for inter in self.intersections:
            ox, oy = inter["xy"]
            for ri, vi, direction in inter["arms"]:
                r = self.roads[ri]
                if r["cls"] not in CROSSWALK_CLASSES:
                    continue
                others = [self.roads[j]["width"] for j, _, _ in inter["arms"] if j != ri]
                d0 = (max(others) if others else r["width"]) / 2 + 0.8
                coords = np.asarray(r["line"].coords)
                seq = coords[vi::direction] if direction > 0 else coords[vi::-1]
                arm = LineString(seq) if len(seq) >= 2 else None
                if arm is None or arm.length < d0 + 5:
                    continue
                p0 = np.asarray(arm.interpolate(d0 + 1.6).coords[0])
                p1 = np.asarray(arm.interpolate(d0 + 1.7).coords[0])
                t = unit(p1 - p0)
                n = np.array([-t[1], t[0]])
                half = r["width"] / 2 - 0.4
                for o in np.arange(-half + 0.3, half - 0.2, 1.2):
                    c = p0 + n * o
                    q = [c - t * 1.6 - n * 0.3, c + t * 1.6 - n * 0.3, c + t * 1.6 + n * 0.3, c - t * 1.6 + n * 0.3]
                    crossings.append(Polygon(q))
                inbound = (not r["oneway"]) or direction < 0
                if inbound:
                    lo, hi = (0.0, half) if not r["oneway"] else (-half, half)
                    c = p0 + t * 2.4
                    q = [c + n * lo - t * 0.22, c + n * hi - t * 0.22, c + n * hi + t * 0.22, c + n * lo + t * 0.22]
                    crossings.append(Polygon(q))

        clip_marks = lambda g: unary_union(g).difference(self.disc_union).intersection(self.road_union)
        if white:
            paint(clip_marks(white), C["white"])
        if yellow:
            paint(clip_marks(yellow), C["yellow"])
        if crossings:
            paint(unary_union(crossings).intersection(self.road_union), C["white"])

        a = np.asarray(img, np.float32)
        rng = np.random.default_rng(7)
        blotch = Image.fromarray((rng.random((H // 32 + 2, W // 32 + 2)) * 255).astype(np.uint8))
        blotch = blotch.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(24))
        blotch = np.asarray(blotch, np.float32) / 255
        grain = rng.normal(0, 1, (H, W)).astype(np.float32)
        a *= (0.95 + 0.1 * blotch)[..., None]
        a += grain[..., None] * 3.0
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(out_png, quality=92, subsampling=0)
        return W, H

    # -- buildings
    def build_buildings(self):
        T = self.T
        walls, roofs, props = self.meshes["buildings"], self.meshes["roofs"], self.meshes["roof_props"]
        part_tree = shapely.STRtree([p["poly"] for p in self.parts]) if self.parts else None
        recs = list(self.parts)
        for b in self.buildings:
            if part_tree is not None:
                hits = part_tree.query(b["poly"], predicate="intersects")
                covered = sum(self.parts[i]["poly"].intersection(b["poly"]).area for i in hits)
                if covered > 0.3 * b["poly"].area:
                    continue
            recs.append(b)
        self.footprints = []
        for rec in recs:
            t, rid = rec["tags"], rec["id"]
            poly = rec["poly"].intersection(self.clip)
            if poly.is_empty:
                continue
            rng = random.Random(rid)
            levels = num(t.get("building:levels"))
            height = num(t.get("height")) or (levels * FLOOR_H + 1.0 if levels else None)
            if height is None:
                height = rng.uniform(8, 16) if poly.area < 400 else rng.uniform(12, 24)
            min_h = num(t.get("min_height")) or (num(t.get("building:min_level"), 0) * FLOOR_H)
            for p in polys(poly):
                if p.area < 2:
                    continue
                c = np.asarray(p.exterior.coords)
                hs = T.h(c[:, 0], c[:, 1])
                ref = float(np.mean(hs))
                zb = (ref + min_h) if min_h > 0 else float(hs.min()) - 0.5
                zt = ref + height
                if zt - zb < 0.5:
                    continue
                if height > 60:
                    wall, style = rng.choice(WALL_GLASS), STYLE_GLASS
                elif height > 30:
                    wall, style = (rng.choice(WALL_GLASS), STYLE_GLASS) if rng.random() < 0.45 else (
                        rng.choice(WALL_MID), STYLE_PUNCHED)
                else:
                    wall, style = rng.choice(WALL_LOW + WALL_MID), STYLE_PUNCHED
                if t.get("building") in ("parking", "garage", "garages") or t.get("building:part") == "roof":
                    style = STYLE_PLAIN
                roof = rng.choice(ROOFS)
                add_extrusion(walls, roofs, p, zb, zt, (*wall, style), roof, ref,
                              bottom=roofs if min_h > 0 else None)
                if min_h <= 0:
                    self.footprints.append(p)
                self._roof_detail(p, zt, height, wall, rng, walls, roofs, props, ref)

    def _roof_detail(self, p, zt, height, wall, rng, walls, roofs, props, ref):
        if p.area > 30 and height > 6:
            inner = p.buffer(-0.35, join_style="mitre")
            if not inner.is_empty:
                ring = p.difference(inner)
                for rp in polys(ring):
                    add_extrusion(walls, roofs, rp, zt - 0.05, zt + 0.8, (*wall, STYLE_PLAIN),
                                  tuple(min(1, x * 1.08) for x in wall), ref)
        if p.area < 60:
            return
        mrr = p.minimum_rotated_rectangle
        cc = np.asarray(mrr.exterior.coords)
        e = cc[1] - cc[0]
        ang = math.atan2(e[1], e[0])
        safe = p.buffer(-1.8)
        if safe.is_empty:
            return
        if height > 35 and p.area > 400:
            core = shapely.affinity.scale(mrr, 0.38, 0.38)
            core = core.intersection(safe)
            for cp in polys(core):
                add_extrusion(walls, roofs, cp, zt - 0.1, zt + rng.uniform(3.5, 6.0), (0.78, 0.78, 0.76, STYLE_PLAIN),
                              (0.58, 0.58, 0.58), ref)
        x0, y0, x1, y1 = safe.bounds
        n_units = int(min(14, p.area / 110)) + 1
        shapely.prepare(safe)
        for _ in range(n_units * 4):
            if n_units <= 0:
                break
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if not safe.contains(Point(x, y)):
                continue
            n_units -= 1
            kind = rng.random()
            if kind < 0.55:
                add_box(props, x, y, rng.uniform(1.6, 3.0), rng.uniform(1.2, 2.0), zt, rng.uniform(0.9, 1.5), ang,
                        rng.choice([(0.82, 0.82, 0.8), (0.7, 0.72, 0.72), (0.9, 0.89, 0.86)]))
            elif kind < 0.7 and height < 40:
                add_cylinder(props, x, y, rng.uniform(1.2, 1.8), zt, rng.uniform(2.5, 3.5), (0.55, 0.42, 0.32))
            elif kind < 0.85 and height < 30 and p.area > 150:
                for k in range(rng.randint(2, 4)):
                    off = (k - 1.5) * 1.6
                    px, py = x - math.sin(ang) * off, y + math.cos(ang) * off
                    if safe.contains(Point(px, py)):
                        add_box(props, px, py, 4.0, 1.1, zt + 0.2, 0.15, ang, (0.16, 0.22, 0.36))
            else:
                add_box(props, x, y, 0.8, 0.8, zt, 0.7, ang, (0.6, 0.6, 0.58))

    # -- bridges
    def build_bridges(self):
        T = self.T
        if not self.bridges:
            return
        ground_keys = set()
        for r in self.roads:
            ground_keys.update(r["coords"])

        # densify every bridge way; graph nodes keyed by rounded local coords
        key = lambda x, y: (round(x, 1), round(y, 1))
        adj = defaultdict(list)
        target = {}
        pinned = set()
        dense = []
        for b in self.bridges:
            H = 6.5 + 5.5 * (max(1, b["layer"]) - 1)
            line = shapely.segmentize(b["line"], 4.0)
            pts = np.asarray(line.coords)
            ends = {0: b["coords"][0], len(pts) - 1: b["coords"][-1]}
            keys = [key(*p) for p in pts]
            for i, k in enumerate(keys):
                target[k] = max(target.get(k, 0), H)
                if i in ends and ends[i] in ground_keys:
                    pinned.add(k)
                if i:
                    dd = float(np.linalg.norm(pts[i] - pts[i - 1]))
                    adj[k].append((keys[i - 1], dd))
                    adj[keys[i - 1]].append((k, dd))
            dense.append((b, pts, keys))

        slope = 0.075
        dist = {k: 0.0 for k in pinned}
        pq = [(0.0, k) for k in pinned]
        while pq:
            d, k = heapq.heappop(pq)
            if d > dist.get(k, 1e18):
                continue
            for nb, w in adj[k]:
                nd = d + w
                if nd < dist.get(nb, 1e18):
                    dist[nb] = nd
                    heapq.heappush(pq, (nd, nb))
        off = {k: min(target[k], slope * dist.get(k, 1e18)) for k in target}

        deck, struct = self.meshes["bridge_deck"], self.meshes["bridge_struct"]
        self.deck_z = {}
        road_prep = self.road_union
        shapely.prepare(road_prep)
        for b, pts, keys in dense:
            o = np.array([off[k] for k in keys])
            hg = T.h(pts[:, 0], pts[:, 1])
            hs = T.h_smooth(pts[:, 0], pts[:, 1])
            blend = np.clip(o / 3.0, 0, 1)
            z = hg * (1 - blend) + hs * blend + o + 0.06
            for k, zz in zip(keys, z):
                self.deck_z[k] = float(zz)
            b["pts3"] = np.column_stack([pts, z])
            self._deck(deck, struct, pts, z, b)
            # pillars
            s_along = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
            for s in np.arange(12.0, s_along[-1] - 6, 24.0):
                i = min(np.searchsorted(s_along, s), len(pts) - 1)
                if o[i] < 3.5:
                    continue
                x, y = pts[i]
                if road_prep.contains(Point(x, y)):
                    continue
                t = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
                ang = math.atan2(t[1], t[0])
                g = float(T.h(x, y))
                add_box(struct, x, y, 1.6, min(b["width"] * 0.55, 4.0), g - 0.5, z[i] - 1.2 - g + 0.5, ang,
                        (0.66, 0.65, 0.62))

    def _deck(self, deck, struct, pts, z, b):
        w = b["width"]
        n = len(pts)
        t = np.zeros_like(pts)
        t[1:-1] = pts[2:] - pts[:-2]
        t[0] = pts[1] - pts[0]
        t[-1] = pts[-1] - pts[-2]
        t = unit(t)
        nl = np.column_stack([-t[:, 1], t[:, 0]])
        p = pts.copy()
        p[0] -= t[0] * 0.6
        p[-1] += t[-1] * 0.6
        L, R = p + nl * w / 2, p - nl * w / 2
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
        pos = np.stack([np.column_stack([R, z]), np.column_stack([L, z])], 1).reshape(-1, 3)
        uv = np.stack([np.column_stack([np.zeros(n), s]), np.column_stack([np.ones(n), s])], 1).reshape(-1, 2)
        i = np.arange(n - 1)[:, None] * 2
        tris = np.concatenate([i + [0, 2, 3], i + [0, 3, 1]])
        col = (b["lanes"] / 8, 1.0 if b["oneway"] else 0.0, b["fwd"] / 8, 1)
        deck.add(pos, (0, 0, 1), uv, col, tris)

        concrete = (0.74, 0.73, 0.70)
        bar = 0.35
        Li, Ri = L - nl * bar, R + nl * bar
        add_wall_strip(struct, L, z - 1.3, z + 0.95, concrete, -1)
        add_wall_strip(struct, R, z - 1.3, z + 0.95, concrete, +1)
        add_wall_strip(struct, Li, z, z + 0.95, concrete, +1)
        add_wall_strip(struct, Ri, z, z + 0.95, concrete, -1)
        for A, B in ((L, Li), (Ri, R)):
            ptop = np.stack([np.column_stack([A, z + 0.95]), np.column_stack([B, z + 0.95])], 1).reshape(-1, 3)
            struct.add(ptop, (0, 0, 1), None, concrete, np.concatenate([i + [0, 2, 3], i + [0, 3, 1]]))
        pbot = np.stack([np.column_stack([R, z - 1.3]), np.column_stack([L, z - 1.3])], 1).reshape(-1, 3)
        struct.add(pbot, (0, 0, -1), None, (0.55, 0.55, 0.53), tris)

    # -- street furniture
    TREE_VARIANTS = 4

    def _tree(self, x, y, z, rng, scale=1.0):
        self.meta["trees"].append([round(x, 2), round(z, 2), round(-y, 2), round(rng.uniform(0, 6.283), 2),
                                   round(scale, 2), rng.randrange(self.TREE_VARIANTS)])

    def build_props(self):
        self.meta["trees"] = []
        for v in range(self.TREE_VARIANTS):
            add_tree(self.meshes[f"tree_{v}"], 0.0, 0.0, 0.0, random.Random(100 + v))
        T = self.T
        rng = random.Random(42)
        props, heads = self.meshes["street_props"], self.meshes["lamp_heads"]
        blocked = unary_union(self.footprints).buffer(1.0) if self.footprints else Polygon()
        shapely.prepare(blocked)
        shapely.prepare(self.road_union)
        shapely.prepare(self.disc_union)
        occupied = defaultdict(list)

        def free(x, y, r):
            k = (int(x // 8), int(y // 8))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for (ox, oy) in occupied[(k[0] + dx, k[1] + dy)]:
                        if (ox - x) ** 2 + (oy - y) ** 2 < r * r:
                            return False
            return self.clip.contains(Point(x, y)) and not blocked.contains(Point(x, y)) \
                and not self.road_union.contains(Point(x, y))

        def mark(x, y):
            occupied[(int(x // 8), int(y // 8))].append((x, y))

        for x, y in self.trees_osm:
            if free(x, y, 2.0):
                self._tree(x, y, float(T.h(x, y)) + KERB, rng)
                mark(x, y)

        lamps = []
        for r in self.roads:
            if not r["sidewalk"]:
                continue
            line = r["line"]
            L = line.length
            for s in np.arange(4.0, L - 2, 4.0):
                p0 = np.asarray(line.interpolate(s).coords[0])
                p1 = np.asarray(line.interpolate(min(s + 0.5, L)).coords[0])
                t = unit(p1 - p0)
                n = np.array([-t[1], t[0]])
                for side in (-1, 1):
                    if self.disc_union.contains(Point(*p0)):
                        continue
                    k = int(s // 4)
                    if k % 8 == (0 if side > 0 else 4):
                        q = p0 + n * side * (r["width"] / 2 + 0.45)
                        if free(q[0], q[1], 3.0):
                            lamps.append((q, -n * side))
                            mark(*q)
                    elif k % 2 == 1 and rng.random() < 0.7:
                        q = p0 + n * side * (r["width"] / 2 + min(1.2, r["sidewalk"] * 0.4))
                        if free(q[0], q[1], 4.5):
                            self._tree(q[0], q[1], float(T.h(*q)) + KERB, rng, rng.uniform(0.8, 1.1))
                            mark(*q)

        for poly in self.landuse.get("park", []) + self.landuse.get("forest", []):
            poly = poly.intersection(self.clip)
            if poly.is_empty:
                continue
            x0, y0, x1, y1 = poly.bounds
            shapely.prepare(poly)
            for _ in range(int(poly.area / 70)):
                x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
                if poly.contains(Point(x, y)) and free(x, y, 3.5):
                    self._tree(x, y, float(T.h(x, y)) + KERB, rng, rng.uniform(0.9, 1.3))
                    mark(x, y)

        pole = (0.24, 0.25, 0.27)
        for q, arm in lamps:
            g = float(T.h(*q)) + KERB
            add_box(props, q[0], q[1], 0.18, 0.18, g, 7.2, 0.0, pole)
            hx, hy = q + arm * 1.6
            ang = math.atan2(arm[1], arm[0])
            mx, my = q + arm * 0.8
            add_box(props, mx, my, 1.7, 0.12, g + 7.0, 0.12, ang, pole)
            add_box(heads, hx, hy, 0.9, 0.35, g + 6.8, 0.25, ang, (1.0, 0.9, 0.7))
            self.meta["lamps"].append([round(hx, 2), round(g + 6.6, 2), round(-hy, 2)])

    # -- spawn & demo paths
    def build_meta(self):
        T = self.T
        cx, cy = (self.X0 + self.X1) / 2, (self.Y0 + self.Y1) / 2
        best = None
        for r in self.roads:
            if r["cls"] not in ("secondary", "tertiary", "primary") or r["line"].length < 60:
                continue
            mid = r["line"].interpolate(0.5, normalized=True)
            d = math.hypot(mid.x - cx, mid.y - cy)
            if best is None or d < best[0]:
                best = (d, r)
        if best:
            r = best[1]
            line = r["line"]
            L = line.length
            p0 = np.asarray(line.interpolate(L / 2).coords[0])
            p1 = np.asarray(line.interpolate(L / 2 + 1).coords[0])
            t = unit(p1 - p0)
            n = np.array([-t[1], t[0]])
            lane = -(r["lanes"] * r["lane_w"]) / 2 + r["lane_w"] * (0.5 if r["oneway"] else 1.5)
            q = p0 + n * lane
            self.meta["spawn"] = {"pos": [q[0], float(T.h(*q)) + 1.2, -q[1]],
                                  "dir": [t[0], 0.0, -t[1]]}
            same = [x["line"] for x in self.roads if x["name"] == r["name"] and x["oneway"] == r["oneway"]]
            merged = max(lines(linemerge(same)), key=lambda l: l.length)
            self.meta["paths"]["street"] = self._path3(merged, lane if not r["oneway"] else 0.0,
                                                       lambda x, y: float(T.h(x, y)) + 0.3)
        motor = [b for b in self.bridges if b["cls"] == "motorway"]
        if motor:
            merged = max(lines(linemerge([b["line"] for b in motor])), key=lambda l: l.length)

            def zf(x, y):
                k = min(self.deck_z, key=lambda kk: (kk[0] - x) ** 2 + (kk[1] - y) ** 2)
                return self.deck_z[k] + 0.3
            self.meta["paths"]["freeway"] = self._path3(merged, 0.0, zf)

    def _path3(self, line, lateral, zf):
        if lateral:
            try:
                line = max(lines(line.offset_curve(lateral)), key=lambda l: l.length)
            except Exception:
                pass
        pts = np.asarray(shapely.segmentize(line, 6.0).coords)
        return [[round(x, 2), round(zf(x, y), 2), round(-y, 2)] for x, y in pts]

    def run(self):
        t0 = time.time()
        step = lambda s: print(f"  {time.time() - t0:6.1f}s  {s}", flush=True)
        self.parse()
        step(f"parsed: {len(self.roads)} roads, {len(self.bridges)} bridges, "
             f"{len(self.buildings)} buildings, {len(self.parts)} parts")
        self.build_network()
        step(f"network: {len(self.intersections)} intersections")
        self.build_ground()
        step("ground mesh")
        OUT.mkdir(parents=True, exist_ok=True)
        W, H = self.paint_ground(OUT / f"{self.area}_ground.jpg")
        self.meta["ground_px"] = [W, H]
        step(f"ground texture {W}x{H}")
        self.build_buildings()
        step("buildings")
        self.build_bridges()
        step("bridges")
        self.build_props()
        step(f"props: {len(self.meta['lamps'])} lamps, {len(self.meta['trees'])} trees")
        self.build_meta()
        meshes = [(name, m.export()) for name, m in self.meshes.items()]
        write_glb(OUT / f"{self.area}.glb", meshes)
        (OUT / f"{self.area}.json").write_text(json.dumps(self.meta))
        tri = sum(len(m["idx"]) for _, m in meshes)
        step(f"wrote {self.area}.glb ({tri} triangles, "
             f"{(OUT / f'{self.area}.glb').stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    area = sys.argv[1] if len(sys.argv) > 1 else "rincon"
    print(f"[{area}] building world tile")
    World(area).run()
