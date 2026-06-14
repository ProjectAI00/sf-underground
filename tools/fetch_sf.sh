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

# Roads - all drivable roads
fetch roads "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[highway~\"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$\"];
);
out geom;"

# Land features - parks, nature, water
fetch land "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[leisure~\"^(park|garden|playground|pitch|golf_course|swimming_pool)$\"];
  way[landuse~\"^(grass|recreation_ground|forest|cemetery|meadow|village_green)$\"];
  way[natural~\"^(water|sand|beach|scrub|wood|grassland|wetland)$\"];
);
out geom;"

# Parking lots and structures
fetch parking "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[amenity=parking];
  way[amenity=parking_space];
  way[parking=surface];
  way[parking=multi-storey];
);
out geom;"

# Piers, docks, marinas (waterfront)
fetch waterfront "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[man_made=pier];
  way[man_made=breakwater];
  way[leisure=marina];
  way[waterway=dock];
  way[waterway=boatyard];
  way[landuse=harbour];
);
out geom;"

# Commercial/industrial/retail areas
fetch zones "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[landuse=retail];
  way[landuse=commercial];
  way[landuse=industrial];
);
out geom;"

# Railway lines (MUNI, BART, Caltrain)
fetch railways "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[railway~\"^(rail|light_rail|tram|subway)$\"];
);
out geom;"

# Pedestrian areas and plazas
fetch pedestrian "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  way[highway=pedestrian][area=yes];
  way[leisure=plaza];
  way[place=square];
);
out geom;"

# Buildings (split into west/east for size)
fetch buildings_w "[out:json][timeout:600][maxsize:1073741824][bbox:37.703,-122.527,37.836,-122.4375];
( way[building]; );
out geom;"

fetch buildings_e "[out:json][timeout:600][maxsize:1073741824][bbox:37.703,-122.4375,37.836,-122.348];
( way[building]; );
out geom;"

# Point features
fetch nodes "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  node[highway=traffic_signals];
  node[highway=street_lamp];
  node[highway=stop];
  node[highway=crossing];
  node[natural=tree];
);
out;"

# Points of interest
fetch pois "[out:json][timeout:300][maxsize:1073741824][bbox:$BBOX_ALL];
(
  node[amenity=fuel];
  node[amenity=fast_food];
  node[amenity=restaurant];
  node[amenity=cafe];
  node[amenity=bank];
  node[amenity=atm];
  node[shop];
  node[tourism~\"^(hotel|motel|hostel|viewpoint|attraction)$\"];
);
out;"

echo "ALL_FETCHES_DONE"
ls -la data/raw/
