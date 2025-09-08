import json
import os
import time
import urllib.parse
import urllib.request
from typing import Optional, Tuple, List, Dict, Any

class GeocodeError(Exception):
    """Raised for transport or parse errors talking to TomTom."""
    pass


def coordinates(
    address: str,
    *,
    country: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 10.0
) -> Optional[Tuple[float, float]]:
    """
    Convert a free-text address into (latitude, longitude) using TomTom Search API.

    Args:
        address: The address string to geocode.
        country: Optional ISO 3166-1 alpha-2 country filter (e.g., "IN", "US").
        api_key: TomTom API key. Defaults to env var TOMTOM_API_KEY.
        timeout: Request timeout in seconds.

    Returns:
        (lat, lng) as floats if a result is found; otherwise None.

    Raises:
        GeocodeError: if the HTTP request fails or the response is malformed.
    """
    if not isinstance(address, str):
        raise TypeError("address must be a string")

    address = address.strip()
    if not address:
        return None

    key = api_key or os.getenv("TOMTOM_API_KEY") or "kKgEbu6mJhXR5MFTfMCoREBnvdgZb0qE"
    if not key:
        raise GeocodeError("TOMTOM_API_KEY not configured")

    base = (
        "https://api.tomtom.com/search/2/geocode/"
        + urllib.parse.quote(address)
        + ".json"
    )
    params = {"key": key, "limit": 1}
    if country:
        params["countrySet"] = country.strip()
    url = base + "?" + urllib.parse.urlencode(params)

    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
    except Exception as e:
        raise GeocodeError(f"request failed: {e}") from e

    # Parse result safely
    if not isinstance(data, dict):
        raise GeocodeError("unexpected response type from TomTom")

    results = data.get("results") or []
    if not results:
        return None

    pos = (results[0] or {}).get("position") or {}
    lat = pos.get("lat")
    lng = pos.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return float(lat), float(lng)
    # No usable coordinates in the first result
    return None


def batch_coordinates(
    addresses: List[str],
    *,
    country: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 10.0
) -> List[Dict[str, Any]]:
    """
    Batch helper that mirrors your original API output schema for each query.
    """
    out: List[Dict[str, Any]] = []
    for q in addresses or []:
        try:
            coords = coordinates(q, country=country, api_key=api_key, timeout=timeout)
            if coords:
                lat, lng = coords
            else:
                lat = lng = None
            out.append({"query": q, "lat": lat, "lng": lng})
        except GeocodeError as e:
            out.append({"query": q, "lat": None, "lng": None, "error": str(e)})
    return out



# ===== Test Location =====
# def test_coordinates():
#     # Test valid address
#     result = coordinates("1600 Amphitheatre Parkway, Mountain View, CA")
#     assert result == (37.4221599, -122.0842744), f"Unexpected result: {result}"

#     # Test invalid address
#     result = coordinates("Invalid Address")
#     assert result is None, f"Unexpected result: {result}"

# test_coordinates()