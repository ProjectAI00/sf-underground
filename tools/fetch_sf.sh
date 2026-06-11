#!/bin/bash
# Fetches whole-SF OSM data in pieces (Overpass-friendly sizes).
set -e
cd "$(dirname "$0")/.."
mkdir -p data/raw
OP="https://overpass-api.de/api/interpreter"
BBOX_ALL="37.703,-122.527,37.836,-122.348"

fetch() { # name query
  echo "=== fetching $1 ==="
  curl -s --compressed --retry 3 --retry-delay 20 -X POST -d "$2" "$OP" -o "data/raw/$1.json"
  ls -la "data/raw/$1.json"
  sleep 10
}

fetch roads "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[highway~\"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$\"];
);
out geom;"

fetch land "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[leisure~\"^(park|garden|playground|pitch|golf_course)$\"];
  way[landuse~\"^(grass|recreation_ground|forest|cemetery)$\"];
  way[natural~\"^(water|sand|beach|scrub|wood)$\"];
);
out geom;"

fetch buildings_w "[out:json][timeout:600][maxsize:1073741824][bbox:37.703,-122.527,37.836,-122.4375];
( way[building]; );
out geom;"

fetch buildings_e "[out:json][timeout:600][maxsize:1073741824][bbox:37.703,-122.4375,37.836,-122.348];
( way[building]; );
out geom;"

fetch nodes "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  node[highway=traffic_signals];
  node[highway=street_lamp];
  node[highway=stop];
  node[highway=crossing];
  node[natural=tree];
);
out;"

echo "ALL_FETCHES_DONE"
ls -la data/raw/
