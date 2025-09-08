from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import os
import json
from loc_to_cor import batch_coordinates, GeocodeError
from typing import  Dict, Any
import logging
import time
import urllib.request
from core_optimize import optimize_assignments

app = FastAPI()
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # one level up from backend/
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "frontend"))
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')
logger = logging.getLogger("optimizer")

# Serve static assets (CSS/JS) from frontend/static at /static
app.mount(
    "/static",
    StaticFiles(directory=os.path.join(BASE_DIR, "frontend", "static")),
    name="static",
)
# app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "frontend")), name="static")

@app.get("/", response_class=HTMLResponse)
def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "name": "Ayush"})


@app.get("/api/config")
def get_config():
    """
    Returns public configuration for the frontend.
    Do not include any sensitive keys except those safe for client use (e.g., TomTom map key).
    """
    tomtom_key = os.environ.get("TOMTOM_API_KEY", "")
    logger.info("GET /api/config -> tomtom_key_set=%s", bool(tomtom_key))
    return {
        "tomtom_key": tomtom_key,
        "features": {
            "geocoding": True,
            "zones": True,
        },
    }


@app.post("/api/geocode")
async def geocode(payload: dict):
    """
    Batch geocode a list of free-text addresses via TomTom Search API.
    payload: { "addresses": ["..."], "country": "IN" }
    """
    addresses = payload.get("addresses") or []
    country = (payload.get("country") or "").strip()

    if not isinstance(addresses, list) or not all(isinstance(a, str) for a in addresses):
        raise HTTPException(status_code=400, detail="Invalid addresses; expected list of strings")

    t0 = time.time()
    try:
        results = batch_coordinates(addresses, country=country or None)
    except GeocodeError as e:
        # This would only occur if env var missing; keep behavior similar to your original
        raise HTTPException(status_code=500, detail=str(e))

    ok_count = sum(1 for r in results if isinstance(r.get("lat"), (int, float)) and isinstance(r.get("lng"), (int, float)))
    logger.info("POST /api/geocode count=%s ok=%s country=%s ms=%d",
                len(addresses), ok_count, country, int((time.time()-t0)*1000))
    return {"results": results}


@app.post("/api/optimize")
async def optimize(payload: Dict[str, Any]):
    """
    Accepts parsed CSV data and constraints, returns optimized assignments.
    Expected payload keys:
      - vehicles: { headers: [...], rows: [[...], ...] }
      - shipments: { headers: [...], rows: [[...], ...] }
      - zones: [ { type: 'nogo'|'fence', polygon: [[lat,lng], ...] } ]
      - options: { vehicle_restrictions: { long_vehicle: bool, max_length_m: number }, use_road_routes?: bool }
      - nb_api_key?: string (optional override)
      - tt_api_key?: string (optional override)
    """
    t0 = time.time()
    vehicles_in = payload.get("vehicles") or {}
    shipments_in = payload.get("shipments") or {}
    zones = payload.get("zones") or []
    options = payload.get("options") or {}
    nb_api_key = (payload.get("nb_api_key") or "").strip() or None
    tt_api_key = (payload.get("tt_api_key") or "").strip() or None
    use_road_routes = bool(options.get("use_road_routes", True))

    try:
        result = optimize_assignments(
            vehicles_in=vehicles_in,
            shipments_in=shipments_in,
            zones=zones,
            options=options,
            nb_api_key=nb_api_key,
            tt_api_key=tt_api_key,
            use_road_routes=use_road_routes,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # optional log timing, counts, flags here
    _ = int((time.time() - t0) * 1000)
    return result