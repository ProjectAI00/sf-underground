#!/bin/bash
set -e
cd "$(dirname "$0")/.."
OP="https://overpass-api.de/api/interpreter"
BBOX_ALL="37.703,-122.527,37.836,-122.348"

echo "=== land ==="
curl -s --compressed --max-time 400 --retry 3 --retry-delay 30 -X POST -d "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[leisure~\"^(park|garden|playground|pitch|golf_course)$\"];
  way[landuse~\"^(grass|recreation_ground|forest|cemetery)$\"];
  way[natural~\"^(water|sand|beach|scrub|wood)$\"];
);
out geom;" "$OP" -o data/raw/land.json
ls -la data/raw/land.json
sleep 15

echo "=== buildings_e ==="
curl -s --compressed --max-time 400 --retry 3 --retry-delay 30 -X POST -d "[out:json][timeout:600][maxsize:1073741824][bbox:37.703,-122.4375,37.836,-122.348];
( way[building]; );
out geom;" "$OP" -o data/raw/buildings_e.json
ls -la data/raw/buildings_e.json
echo "RETRY_DONE"
