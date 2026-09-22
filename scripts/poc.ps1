$ErrorActionPreference = 'Stop'

python python/scripts/download_osm.py --source overpass
python python/scripts/extract_railway.py
python python/scripts/build_route.py
python python/scripts/build_tunnels.py
python python/scripts/generate_samples.py
python python/scripts/calculate_sun_exposure.py
python python/scripts/validate_results.py

