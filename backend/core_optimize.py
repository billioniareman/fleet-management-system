from __future__ import annotations
import os
import json
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional
from utils import (
    _map_shipment_row,
    _mock_optimize,
    _build_nextbillion_payload,
    _enrich_routes_with_tomtom,
)

class ProviderError(Exception):
    pass


def _nextbillion_optimize(
    nb_api_key: str,
    nb_payload: Dict[str, Any],
    *,
    timeout: float = 30.0,
    endpoint: str = "https://api.nextbillion.io/route-optimization",
) -> Dict[str, Any]:
    """Calls NextBillion; retries with alternate header casing on 401."""
    data = json.dumps(nb_payload).encode("utf-8")

    def _call(header_name: str) -> Dict[str, Any]:
        req = urllib.request.Request(endpoint, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header(header_name, nb_api_key)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    try:
        try:
            return _call("x-api-key")
        except urllib.error.HTTPError as he:
            body = he.read().decode("utf-8", errors="ignore") if hasattr(he, "read") else str(he)
            if getattr(he, "code", None) == 401:
                return _call("X-API-KEY")
            raise ProviderError(f"NextBillion HTTP {getattr(he, 'code', '?')}: {body}") from he
    except urllib.error.URLError as e:
        raise ProviderError(f"NextBillion transport error: {e}") from e


def optimize_assignments(
    *,
    vehicles_in: Dict[str, Any],
    shipments_in: Dict[str, Any],
    zones: List[Dict[str, Any]],
    options: Dict[str, Any],
    nb_api_key: Optional[str] = None,
    tt_api_key: Optional[str] = None,
    use_road_routes: bool = True,
) -> Dict[str, Any]:
    """
    Pure function: maps inputs, calls provider or mock, and (optionally) enriches with TomTom.
    """
    v_headers = vehicles_in.get("headers") or []
    v_rows = vehicles_in.get("rows") or []
    s_headers = shipments_in.get("headers") or []
    s_rows = shipments_in.get("rows") or []

    # Vehicles are already dict-shaped in your pipeline; pass through
    vehicles: List[Dict[str, Any]] = [
        {h: (row[i] if i < len(row) else None) for i, h in enumerate(v_headers)}
        for row in v_rows
    ]

    # Shipments are mapped via your utility
    shipments: List[Dict[str, Any]] = [_map_shipment_row(s_headers, r) for r in s_rows]

    # Keys: request override → env
    nb_key = (nb_api_key or "").strip() or os.getenv("NEXTBILLION_API_KEY")
    tt_key = (tt_api_key or "").strip() or os.getenv("TOMTOM_API_KEY")

    # Try provider → fallback to mock
    using_mock = False
    if nb_key:
        try:
            nb_payload = _build_nextbillion_payload(vehicles, shipments, zones, options)
            result = _nextbillion_optimize(nb_key, nb_payload)
        except ProviderError as e:
            result = {"provider_error": str(e)}
            using_mock = True
    else:
        using_mock = True
        result = {}

    if using_mock:
        result = _mock_optimize(vehicles, shipments)
        result["notice"] = "Mock optimization used (NEXTBILLION_API_KEY missing or provider returned error)."
        if nb_key:
            result.setdefault("provider_error", "Provider call failed; check server logs for details.")

    # Optional enrichment via your utility (swallow errors)
    if use_road_routes:
        try:
            result = _enrich_routes_with_tomtom(result, zones, options, tt_key)
        except Exception:
            pass

    return result
