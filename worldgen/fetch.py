"""Download OSM features and a 1 m bare-earth DEM for an area into worldgen/cache/<area>/.

    python worldgen/fetch.py rincon
"""

import json
import sys
from pathlib import Path

import requests

from areas import AREAS

CACHE = Path(__file__).parent / "cache"
UA = {"User-Agent": "sf-street-racer-worldgen/0.1"}
OVERPASS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
DEM_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
DEM_MARGIN_DEG = 0.0006


def overpass_query(s, w, n, e):
    return f"""[out:json][timeout:180][bbox:{s},{w},{n},{e}];
(
  way[highway];
  way[building]; relation[building];
  way["building:part"];
  way[landuse]; way[leisure]; way[natural]; way[amenity=parking]; way[place=square];
  way[railway];
  node[natural=tree]; node[highway=street_lamp]; node[highway=traffic_signals];
);
out geom;"""


def fetch_osm(bbox, out: Path):
    query = overpass_query(*bbox)
    last = None
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": query}, headers=UA, timeout=240)
            if r.ok and r.text.lstrip().startswith("{"):
                out.write_text(r.text)
                return len(r.json()["elements"])
            last = f"{url}: HTTP {r.status_code}"
        except requests.RequestException as ex:
            last = f"{url}: {ex}"
    raise RuntimeError(f"all Overpass mirrors failed ({last})")


def fetch_dem(bbox, out: Path):
    s, w, n, e = bbox
    m = DEM_MARGIN_DEG
    s, w, n, e = s - m, w - m, n + m, e + m
    # ~1 px per metre
    width = int((e - w) * 111320 * 0.79)
    height = int((n - s) * 110574)
    params = {
        "bbox": f"{w},{s},{e},{n}", "bboxSR": 4326, "imageSR": 4326,
        "size": f"{width},{height}", "format": "tiff", "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation", "f": "image",
    }
    r = requests.get(DEM_URL, params=params, headers=UA, timeout=240)
    r.raise_for_status()
    out.write_bytes(r.content)
    (out.parent / "dem.json").write_text(json.dumps({"bbox": [s, w, n, e], "size": [width, height]}))
    return width, height


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "rincon"
    bbox = AREAS[name]
    d = CACHE / name
    d.mkdir(parents=True, exist_ok=True)
    print(f"[{name}] OSM ...", flush=True)
    print(f"  {fetch_osm(bbox, d / 'osm.json')} elements")
    print(f"[{name}] DEM ...", flush=True)
    print("  %dx%d px" % fetch_dem(bbox, d / "dem.tif"))


if __name__ == "__main__":
    main()
