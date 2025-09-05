# TomTom & NextBillion Integration – Phase 1 (Fleet Routing Optimization)

Version: Prototype
Date: 05-09-2025
Prepared By: Madhur

This plan breaks the prototype into practical phases covering all requested points (ingestion, constraints, optimization, visualization, and performance), with concrete API references and deliverables.

## Phase A — Input, Geocoding, Map

- Scope: Capture vehicles + deliveries, basic constraints, and visualize points on a TomTom map.
- Frontend:
  - Form inputs: number of vehicles, uploads or address list, constraint toggles (time windows, zones, long-vehicle restrictions).
  - Map: TomTom Maps SDK for Web. Draw markers, polygons for no‑go/geofence zones.
- Backend (FastAPI):
  - `POST /api/geocode`: batch geocodes free‑text addresses via TomTom.
  - `GET /api/config`: returns feature flags and required keys (frontend avoids hardcoding keys).
- Third‑party APIs (TomTom):
  - Geocoding (single): `GET https://api.tomtom.com/search/2/geocode/{query}.json?key=TT_KEY`.
  - Geocoding (batch): `POST https://api.tomtom.com/search/2/batch.json?key=TT_KEY` with `queries` body.
  - Maps SDK Web: `https://developer.tomtom.com/maps-sdk-web/documentation`.
- Deliverables:
  - Basic UI with inputs and zones drawing.
  - Working `/api/geocode` to convert addresses → lat/lng.
  - Map shows vehicle depots and delivery points.

## Phase B — Optimization + Constraints

- Scope: Build request payload from vehicles, deliveries, and constraints; call NextBillion Route Optimization; handle time windows and zones.
- Backend (FastAPI):
  - `POST /api/optimize`: accepts vehicles, deliveries, constraints JSON; calls NextBillion optimization; returns assignments + route geometries.
  - Constraint encoding:
    - Time windows per stop and vehicle shifts.
    - Vehicle capacity, max tasks, skills (optional).
    - Zones: geofences and no‑go polygons; enforce via NextBillion constraints and/or TomTom `avoidAreas` when drawing fallback routes.
  - TomTom Routing (optional, for drawing with restrictions):
    - Calculate route: `GET https://api.tomtom.com/routing/1/calculateRoute/{lat1},{lng1}:{lat2},{lng2}/json?key=TT_KEY&traffic=true&avoidAreas=poly(...)&vehicleCommercial=true&vehicleWeight=...&vehicleLength=...`
    - Supports `avoidAreas` polygons and vehicle restriction params for long vehicles.
- Third‑party APIs:
  - NextBillion Route Optimization API (VRP/VRPTW). See docs: `https://docs.nextbillion.ai/` (Route Optimization). Typical fields:
    - `vehicles`: id, start/end, capacity, shift/time_window.
    - `jobs` or `shipments`: locations, service times, time_windows, quantities, priorities.
    - `forbidden_zones` / polygons and other constraints.
  - TomTom Routing API docs: `https://developer.tomtom.com/routing-api/documentation` (calculate route, avoid areas, vehicle params).
- Deliverables:
  - Validated request builder for NextBillion from CSV/inputs.
  - End‑to‑end `/api/optimize` returning optimized assignments and route shapes.

## Phase C — Visualization, Performance, UX

- Scope: Vehicle‑wise colored routes on TomTom map, legends, summaries, and performance targets.
- Frontend:
  - Draw returned polylines/GeoJSON per vehicle with distinct colors; highlight stops with ETAs.
  - Toggle layers: traffic, zones, no‑go overlays.
  - CSV scale test: 20+ vehicles, 150+ deliveries; graceful progress UI.
- Backend:
  - Normalize route geometries (polyline or GeoJSON) to frontend format.
  - Simple caching for geocodes and optimization requests during a session.
- Deliverables:
  - Clear vehicle‑wise routes honoring constraints.
  - Measured end‑to‑end time (<10s target for 20v/150pts, subject to network/API limits).

---

## API Contracts (Prototype)

### `POST /api/geocode`
- Input:
```json
{
  "addresses": ["12 MG Road, Bengaluru", "..."],
  "country": "IN"
}
```
- Output:
```json
{
  "results": [{"query":"12 MG Road, Bengaluru","lat":12.97,"lng":77.59,"raw":{}}]
}
```

### `POST /api/optimize`
- Input (simplified):
```json
{
  "vehicles": [
    {
      "id": "v1",
      "start": {"lat": 12.97, "lng": 77.59},
      "end":   {"lat": 12.98, "lng": 77.60},
      "capacity": 100,
      "shift": {"start": "2025-09-05T08:00:00Z", "end": "2025-09-05T18:00:00Z"}
    }
  ],
  "shipments": [
    {
      "pickup":   {"id":"p1","lat":12.95,"lng":77.58,"time_window":["2025-09-05T09:00:00Z","2025-09-05T12:00:00Z"]},
      "delivery": {"id":"d1","lat":12.99,"lng":77.62,"time_window":["2025-09-05T10:00:00Z","2025-09-05T15:00:00Z"]},
      "quantity": 10,
      "priority": 1
    }
  ],
  "constraints": {
    "no_go_zones": [ {"polygon": [[lat,lng],[lat,lng],...] } ],
    "geofences":   [ {"polygon": [[lat,lng],[lat,lng],...] } ],
    "vehicle_restrictions": {"long_vehicle": true, "max_length_m": 12}
  }
}
```
- Output (simplified):
```json
{
  "summary": {"total_distance_km": 123.4, "total_time_min": 456},
  "assignments": [
    {
      "vehicle_id": "v1",
      "stops": [
        {"type":"start","lat":12.97,"lng":77.59,"eta":"2025-09-05T08:00:00Z"},
        {"type":"pickup","id":"p1","lat":12.95,"lng":77.58,"eta":"2025-09-05T09:30:00Z"},
        {"type":"delivery","id":"d1","lat":12.99,"lng":77.62,"eta":"2025-09-05T11:10:00Z"},
        {"type":"end","lat":12.98,"lng":77.60,"eta":"2025-09-05T17:00:00Z"}
      ],
      "route": {"type":"LineString","coordinates":[[lng,lat],[lng,lat],...]}
    }
  ]
}
```

---

## Keys, Config, and Security

- Store `TOMTOM_API_KEY` and `NEXTBILLION_API_KEY` in environment; the backend reads them; the frontend requests a short‑lived token or uses backend proxy endpoints.
- Never ship API keys to the browser or commit to source control.

---

## Notes and Assumptions

- Backend framework: Current codebase uses FastAPI (not Flask). We’ll proceed with FastAPI for speed unless a change to Flask is required.
- Scale target (prototype): up to 50 vehicles and 500 delivery points.
- Phase 1 is a static plan (no real‑time re‑optimization). Traffic is used where supported by APIs.

