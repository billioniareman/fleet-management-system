from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import uvicorn
import os
import urllib.parse
import urllib.request
import json
from typing import List, Dict, Any, Tuple
from datetime import datetime, timedelta
import math
import logging
import time
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
    tomtom_key = os.environ.get("TOMTOM_API_KEY") or "kKgEbu6mJhXR5MFTfMCoREBnvdgZb0qE"
    if not tomtom_key:
        raise HTTPException(status_code=500, detail="TOMTOM_API_KEY not configured on server")

    t0 = time.time()
    addresses = payload.get("addresses") or []
    country = (payload.get("country") or "").strip()
    if not isinstance(addresses, list) or not all(isinstance(a, str) for a in addresses):
        raise HTTPException(status_code=400, detail="Invalid addresses; expected list of strings")

    results = []
    for q in addresses:
        q_str = q.strip()
        if not q_str:
            results.append({"query": q, "lat": None, "lng": None, "raw": None})
            continue
        # Build URL: single-search geocode with optional countrySet and limit=1
        base = "https://api.tomtom.com/search/2/geocode/" + urllib.parse.quote(q_str) + ".json"
        params = {"key": tomtom_key, "limit": 1}
        if country:
            params["countrySet"] = country
        url = base + "?" + urllib.parse.urlencode(params)

        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                data = json.loads(body)
        except Exception as e:
            results.append({"query": q, "lat": None, "lng": None, "error": str(e), "raw": None})
            continue

        lat = lng = None
        if data and isinstance(data, dict):
            try:
                item = (data.get("results") or [None])[0]
                pos = item.get("position") if item else None
                lat = pos.get("lat") if pos else None
                lng = pos.get("lon") if pos else None
            except Exception:
                lat = lng = None
        results.append({"query": q, "lat": lat, "lng": lng, "raw": data})

    ok_count = sum(1 for r in results if isinstance(r.get("lat"), (int, float)) and isinstance(r.get("lng"), (int, float)))
    logger.info("POST /api/geocode count=%s ok=%s country=%s ms=%d", len(addresses), ok_count, country, int((time.time()-t0)*1000))
    return {"results": results}


def _map_vehicle_row(headers: List[str], row: List[str]) -> Dict[str, Any]:
    idx = {h: i for i, h in enumerate(headers)}
    def g(name, default=None):
        return row[idx[name]] if name in idx and idx[name] < len(row) else default
    def fnum(v):
        try:
            return float(str(v).strip())
        except Exception:
            return None
    return {
        "id": g("id"),
        "start": {"lat": fnum(g("start_latitude")), "lng": fnum(g("start_longitude"))},
        "end":   {"lat": fnum(g("end_latitude")),   "lng": fnum(g("end_longitude"))},
        "capacity": _safe_int(g("capacity")),
        "max_tasks": _safe_int(g("max_tasks")),
        "shift": {"start": g("shift_start"), "end": g("shift_end")},
        "description": g("vehicle_description"),
    }


def _map_shipment_row(headers: List[str], row: List[str]) -> Dict[str, Any]:
    idx = {h: i for i, h in enumerate(headers)}
    def g(name, default=None):
        return row[idx[name]] if name in idx and idx[name] < len(row) else default
    def fnum(v):
        try:
            return float(str(v).strip())
        except Exception:
            return None
    return {
        "pickup": {
            "id": g("Pickup Id"),
            "lat": fnum(g("Pickup Location Lat")),
            "lng": fnum(g("Pickup Location Lng")),
            "time_window": [g("Pickup Start Time"), g("Pickup End Time")],
        },
        "delivery": {
            "id": g("Delivery Id"),
            "lat": fnum(g("Delivery Location Lat")),
            "lng": fnum(g("Delivery Location Lng")),
            "time_window": [g("Delivery Start Time"), g("Delivery End Time")],
        },
        "quantity": _safe_int(g("Quantity")),
        "priority": _safe_int(g("Priority")),
        "description": g("Description"),
    }


def _safe_int(v, default=None):
    try:
        return int(str(v).strip())
    except Exception:
        return default


@app.post("/api/optimize")
async def optimize(payload: Dict[str, Any]):
    """
    Accepts parsed CSV data and constraints, returns optimized assignments.
    Expected payload keys:
      - vehicles: { headers: [...], rows: [[...], ...] }
      - shipments: { headers: [...], rows: [[...], ...] }
      - zones: [ { type: 'nogo'|'fence', polygon: [[lat,lng], ...] } ]
      - options: { vehicle_restrictions: { long_vehicle: bool, max_length_m: number } }
    """
    t0 = time.time()
    vehicles_in = payload.get("vehicles") or {}
    shipments_in = payload.get("shipments") or {}
    zones = payload.get("zones") or []
    options = payload.get("options") or {}

    v_headers = vehicles_in.get("headers") or []
    v_rows = vehicles_in.get("rows") or []
    s_headers = shipments_in.get("headers") or []
    s_rows = shipments_in.get("rows") or []

    vehicles = [_map_vehicle_row(v_headers, r) for r in v_rows]
    shipments = [_map_shipment_row(s_headers, r) for r in s_rows]

    nb_key = os.environ.get("NEXTBILLION_API_KEY") or "bf321858e11c473a853fe11ecdd34a16"
    using_mock = False
    result = None

    if nb_key:
        try:
            # Tentative NextBillion endpoint; may differ in production. Fallback to mock on error.
            nb_url = "https://api.nextbillion.io/route-optimization"
            body = {
                "vehicles": vehicles,
                "shipments": shipments,
                "constraints": {
                    "no_go_zones": [z for z in zones if (z.get("type") == "nogo")],
                    "geofences": [z for z in zones if (z.get("type") == "fence")],
                    "vehicle_restrictions": options.get("vehicle_restrictions", {}),
                },
            }
            data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(nb_url, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("X-API-KEY", nb_key)
            with urllib.request.urlopen(req, timeout=25) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            logger.warning("NextBillion API error: %s", e)
            using_mock = True
    else:
        using_mock = True

    if using_mock:
        result = _mock_optimize(vehicles, shipments)
        result["notice"] = "Mock optimization used (NEXTBILLION_API_KEY missing or API call failed)."

    # Optional: enrich geometry with TomTom Routing if requested
    enrich = bool(options.get("use_road_routes", True))
    if enrich:
        try:
            result = _enrich_routes_with_tomtom(result, zones, options)
        except Exception:
            # Swallow enrichment errors; return base result
            pass
    ms = int((time.time()-t0)*1000)
    logger.info(
        "POST /api/optimize vehicles=%d shipments=%d zones=%d using_mock=%s enriched=%s ms=%d",
        len(vehicles), len(shipments), len(zones), using_mock, enrich, ms,
    )
    return result


def _mock_optimize(vehicles: List[Dict[str, Any]], shipments: List[Dict[str, Any]]):
    """Heuristic VRP mock: assign shipments to nearest vehicle start; build routes with pickup-delivery precedence and simple capacity.
    Produces a reasonable baseline when NextBillion is unavailable.
    """
    if not vehicles:
        return {"summary": {}, "assignments": []}

    # Assign shipments to nearest vehicle start
    veh_points = []
    for vi, v in enumerate(vehicles):
        slat = v.get("start", {}).get("lat")
        slng = v.get("start", {}).get("lng")
        if slat is None or slng is None:
            # fallback to first valid point among start/end
            elat = v.get("end", {}).get("lat")
            elng = v.get("end", {}).get("lng")
            slat, slng = elat, elng
        veh_points.append((vi, float(slat) if slat is not None else None, float(slng) if slng is not None else None))

    assignments_idx: List[List[int]] = [[] for _ in vehicles]
    for si, shp in enumerate(shipments):
        plat, plng = shp.get("pickup", {}).get("lat"), shp.get("pickup", {}).get("lng")
        if plat is None or plng is None:
            dlat, dlng = shp.get("delivery", {}).get("lat"), shp.get("delivery", {}).get("lng")
            plat, plng = dlat, dlng
        best_vi = 0
        best_d = float("inf")
        for (vi, vlat, vlng) in veh_points:
            if vlat is None or vlng is None or plat is None or plng is None:
                continue
            d = _haversine_m(vlat, vlng, float(plat), float(plng))
            if d < best_d:
                best_d = d
                best_vi = vi
        assignments_idx[best_vi].append(si)

    # Build routes per vehicle using nearest-neighbor with precedence and simple capacity
    assignments = []
    for vi, v in enumerate(vehicles):
        stops: List[Dict[str, Any]] = []
        if v.get("start", {}).get("lat") is not None:
            stops.append({"type": "start", **v["start"], "eta": v.get("shift", {}).get("start")})

        cur_lat = v.get("start", {}).get("lat") or v.get("end", {}).get("lat")
        cur_lng = v.get("start", {}).get("lng") or v.get("end", {}).get("lng")
        assigned = [shipments[i] for i in assignments_idx[vi]]
        picked = set()  # shipment ids
        delivered = set()
        load = 0
        capacity = v.get("capacity") or None

        def can_pick(shp):
            q = shp.get("quantity") or 0
            if capacity is None:
                return True
            try:
                return (load + int(q)) <= int(capacity)
            except Exception:
                return True

        while True:
            best = None
            best_dist = float("inf")
            # Candidate: any undelivered shipment
            for shp in assigned:
                sid = shp.get("pickup", {}).get("id") or shp.get("delivery", {}).get("id") or "sid"
                if sid in delivered:
                    continue
                # If not picked yet, consider pickup (if capacity allows)
                if sid not in picked:
                    plat, plng = shp["pickup"].get("lat"), shp["pickup"].get("lng")
                    if plat is None or plng is None:
                        continue
                    if not can_pick(shp):
                        continue
                    d = _haversine_m(cur_lat, cur_lng, float(plat), float(plng)) if (cur_lat is not None and cur_lng is not None) else 0
                    if d < best_dist:
                        best_dist = d
                        best = (sid, "pickup", shp)
                else:
                    # picked, consider delivery
                    dlat, dlng = shp["delivery"].get("lat"), shp["delivery"].get("lng")
                    if dlat is None or dlng is None:
                        continue
                    d = _haversine_m(cur_lat, cur_lng, float(dlat), float(dlng)) if (cur_lat is not None and cur_lng is not None) else 0
                    if d < best_dist:
                        best_dist = d
                        best = (sid, "delivery", shp)

            if best is None:
                break

            sid, action, shp = best
            if action == "pickup":
                plat, plng = float(shp["pickup"]["lat"]), float(shp["pickup"]["lng"])
                stops.append({"type": "pickup", "id": shp["pickup"]["id"], "lat": plat, "lng": plng, "eta": shp["pickup"].get("time_window", [None])[0]})
                cur_lat, cur_lng = plat, plng
                picked.add(sid)
                try:
                    load += int(shp.get("quantity") or 0)
                except Exception:
                    pass
            else:
                dlat, dlng = float(shp["delivery"]["lat"]), float(shp["delivery"]["lng"])
                stops.append({"type": "delivery", "id": shp["delivery"]["id"], "lat": dlat, "lng": dlng, "eta": shp["delivery"].get("time_window", [None, None])[0]})
                cur_lat, cur_lng = dlat, dlng
                delivered.add(sid)
                try:
                    load -= int(shp.get("quantity") or 0)
                except Exception:
                    pass

        if v.get("end", {}).get("lat") is not None:
            stops.append({"type": "end", **v["end"], "eta": v.get("shift", {}).get("end")})

        coords = []
        for st in stops:
            if st.get("lat") is not None and st.get("lng") is not None:
                coords.append([st["lng"], st["lat"]])
        route = {"type": "LineString", "coordinates": coords}
        assignments.append({"vehicle_id": v.get("id") or f"veh-{vi+1}", "stops": stops, "route": route})

    return {"summary": {"total_distance_km": 0.0, "total_time_min": 0}, "assignments": assignments}


def _enrich_routes_with_tomtom(result: Dict[str, Any], zones: List[Dict[str, Any]], options: Dict[str, Any]) -> Dict[str, Any]:
    """
    For each assignment, replace straight-line geometry with TomTom routing-based polyline across consecutive stops,
    honoring avoidAreas (from no-go zones) and basic vehicle restriction params when available.
    """
    tt_key = os.environ.get("TOMTOM_API_KEY")
    if not tt_key:
        return result

    avoid_param = _build_tomtom_avoid_areas(zones)
    vehicle_params = _build_vehicle_params(options.get("vehicle_restrictions") or {})

    assignments = result.get("assignments") or []
    total_distance_m = 0.0
    total_time_s = 0.0
    for a in assignments:
        stops = a.get("stops") or []
        coords: List[List[float]] = []  # [lon, lat]
        legs: List[Dict[str, Any]] = []
        prev = None
        leg_idx = 0
        assign_dist_m = 0.0
        assign_time_s = 0.0
        for i, st in enumerate(stops):
            if st.get("lat") is None or st.get("lng") is None:
                prev = None
                continue
            cur = {"lat": float(st["lat"]), "lng": float(st["lng"]) }
            if prev is not None:
                seg_coords, seg_dist_m, seg_time_s = _tomtom_route_segment(prev, cur, tt_key, avoid_param, vehicle_params)
                if seg_coords:
                    if coords:
                        seg_coords = seg_coords[1:]  # skip duplicate
                    coords.extend(seg_coords)
                legs.append({
                    "index": leg_idx,
                    "from": {"lat": prev["lat"], "lng": prev["lng"]},
                    "to": {"lat": cur["lat"], "lng": cur["lng"]},
                    "distance_m": seg_dist_m,
                    "time_s": seg_time_s,
                })
                leg_idx += 1
                assign_dist_m += seg_dist_m
                assign_time_s += seg_time_s
            else:
                coords.append([cur["lng"], cur["lat"]])
            prev = cur
        if coords:
            a["route"] = {"type": "LineString", "coordinates": coords}
        a["metrics"] = {"distance_m": round(assign_dist_m, 1), "time_s": int(assign_time_s)}
        a["legs"] = legs
        total_distance_m += assign_dist_m
        total_time_s += assign_time_s

        # Compute fallback ETAs if not supplied, from start stop eta or now
        _compute_fallback_etas(a)
    # Update overall summary if present
    if isinstance(result.get("summary"), dict):
        result["summary"]["total_distance_km"] = round(total_distance_m / 1000.0, 3)
        result["summary"]["total_time_min"] = int(total_time_s / 60)
    return result


def _build_tomtom_avoid_areas(zones: List[Dict[str, Any]]) -> str:
    polys: List[str] = []
    for z in zones:
        if (z.get("type") != "nogo"):
            continue
        poly = z.get("polygon") or []
        if len(poly) < 3:
            continue
        # TomTom expects polygons with prefix 'poly:' then lat,lon pairs separated by ':'
        # Multiple polygons separated by '|'. Ensure ring is closed.
        parts = []
        for lat, lng in poly:
            try:
                parts.append(f"{float(lat)},{float(lng)}")
            except Exception:
                pass
        # Close ring if not closed
        if parts and parts[0] != parts[-1]:
            parts.append(parts[0])
        if parts:
            polys.append("poly:" + ":".join(parts))
    return "|".join(polys) if polys else ""


def _build_vehicle_params(vr: Dict[str, Any]) -> Dict[str, Any]:
    params: Dict[str, Any] = {}
    if not vr:
        return params
    # Treat long vehicle as commercial and pass length if provided
    if vr.get("long_vehicle"):
        params["vehicleCommercial"] = "true"
    length = vr.get("max_length_m")
    try:
        if length is not None:
            params["vehicleLength"] = str(float(length))
    except Exception:
        pass
    return params


def _tomtom_route_segment(start: Dict[str, float], end: Dict[str, float], key: str, avoid_param: str, vehicle_params: Dict[str, Any]) -> Tuple[List[List[float]], float, float]:
    """Call TomTom routing for a segment and return (coords [ [lon,lat], ... ], distance_m, time_s)."""
    lat1, lon1 = start["lat"], start["lng"]
    lat2, lon2 = end["lat"], end["lng"]
    path = f"{lat1},{lon1}:{lat2},{lon2}"
    qs = {"key": key, "traffic": "true"}
    if avoid_param:
        qs["avoidAreas"] = avoid_param
    qs.update(vehicle_params)
    url = "https://api.tomtom.com/routing/1/calculateRoute/" + path + "/json?" + urllib.parse.urlencode(qs)
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        coords: List[List[float]] = []
        distance_m = 0.0
        time_s = 0.0
        routes = data.get("routes") or []
        if routes:
            r0 = routes[0]
            legs = r0.get("legs") or []
            summ = r0.get("summary") or {}
            distance_m = float(summ.get("lengthInMeters") or 0)
            time_s = float(summ.get("travelTimeInSeconds") or 0)
            for leg in legs:
                pts = leg.get("points") or []
                for p in pts:
                    lat = p.get("latitude") if isinstance(p, dict) else None
                    lon = p.get("longitude") if isinstance(p, dict) else None
                    if lat is not None and lon is not None:
                        coords.append([float(lon), float(lat)])
        return coords, distance_m, time_s
    except Exception as e:
        logger.warning("TomTom routing segment error: %s (url=%s)", e, url)
        # fallback: straight segment with haversine distance and assumed speed 40 km/h
        dist_m = _haversine_m(lat1, lon1, lat2, lon2)
        time_s = dist_m / (40_000/3600)  # 40 km/h
        return [[lon1, lat1], [lon2, lat2]], dist_m, time_s


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def _compute_fallback_etas(assignment: Dict[str, Any]) -> None:
    stops = assignment.get("stops") or []
    legs = assignment.get("legs") or []
    if not stops or not legs:
        return
    # Base time from first stop's eta if parseable, otherwise now
    base_time = _parse_dt(stops[0].get("eta")) or datetime.utcnow()
    t = base_time
    # first stop gets base eta if not present
    if not stops[0].get("eta"):
        stops[0]["eta_calc"] = t.isoformat() + "Z"
    for i in range(len(legs)):
        dt = timedelta(seconds=float(legs[i].get("time_s") or 0))
        t = t + dt
        if i+1 < len(stops) and not stops[i+1].get("eta"):
            stops[i+1]["eta_calc"] = t.isoformat() + "Z"


def _parse_dt(s: Any):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None
