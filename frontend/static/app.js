// Frontend logic for uploading and previewing CSVs

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const vehicleCountInput = document.getElementById('vehicleCount');
  const proceedVehiclesBtn = document.getElementById('proceedVehiclesBtn');
  const resetBtn = document.getElementById('resetBtn');
  const vehicleCsvInput = document.getElementById('vehicleCsvInput');
  const vehicleCsvStatus = document.getElementById('vehicleCsvStatus');
  const vehicleTableContainer = document.getElementById('vehicleTableContainer');
  const toShipmentsBtn = document.getElementById('toShipmentsBtn');
  const shipmentCsvInput = document.getElementById('shipmentCsvInput');
  const shipmentCsvStatus = document.getElementById('shipmentCsvStatus');
  const shipmentTableContainer = document.getElementById('shipmentTableContainer');
  const downloadVehicleTemplate = document.getElementById('downloadVehicleTemplate');
  const downloadShipmentTemplate = document.getElementById('downloadShipmentTemplate');
  const showMapBtn = document.getElementById('showMapBtn');
  const mapSection = document.getElementById('mapSection');
  const geocodeBtn = document.getElementById('geocodeBtn');
  const addressInput = document.getElementById('addressInput');
  const countryCode = document.getElementById('countryCode');
  const geocodeStatus = document.getElementById('geocodeStatus');
  const startNoGoBtn = document.getElementById('startNoGo');
  const startGeofenceBtn = document.getElementById('startGeofence');
  const finishPolygonBtn = document.getElementById('finishPolygon');
  const clearZonesBtn = document.getElementById('clearZones');
  const optimizeBtn = document.getElementById('optimizeBtn');
  const optimizeStatus = document.getElementById('optimizeStatus');
  const useRoadRoutes = document.getElementById('useRoadRoutes');
  const vehicleLengthM = document.getElementById('vehicleLengthM');
  const nbApiKey = document.getElementById('nbApiKey');
  const ttApiKey = document.getElementById('ttApiKey');
  const toggleRouteSteps = document.getElementById('toggleRouteSteps');
  const toggleInputDetail = document.getElementById('toggleInputDetail');

  // Map state
  let mapInstance = null;
  let markersLayer = null;
  let polygonsLayer = null;
  window._drawState = window._drawState || { mode: null, points: [] }; // mode: 'nogo' | 'fence' | null

  // Fetch config (TomTom key)
  fetch('/api/config')
    .then(r => r.json())
    .then(cfg => { window._tomtomKey = cfg.tomtom_key || null; })
    .catch(() => {});

  // Expected headers
  const VEHICLE_HEADERS = [
    'id',
    'vehicle_description',
    'capacity',
    'start_latitude',
    'start_longitude',
    'end_latitude',
    'end_longitude',
    'shift_start',
    'shift_end',
    'max_tasks',
  ];

  const SHIPMENT_HEADERS = [
    'Pickup Id',
    'Delivery Id',
    'Description',
    'Pickup Location Lat',
    'Pickup Location Lng',
    'Pickup Start Time',
    'Pickup End Time',
    'Delivery Location Lat',
    'Delivery Location Lng',
    'Delivery Start Time',
    'Delivery End Time',
    'Quantity',
    'Priority',
  ];

  let declaredVehicleCount = null;
  let vehiclesParsed = null; // { headers, rows }
  let shipmentsParsed = null; // { headers, rows }

  // Step 1: proceed after entering count
  proceedVehiclesBtn.addEventListener('click', () => {
    const val = Number(vehicleCountInput.value);
    if (!Number.isFinite(val) || val <= 0) {
      notify(vehicleCsvStatus, 'Please enter a valid vehicle count (> 0).', 'error');
      step2.classList.add('hidden');
      return;
    }
    declaredVehicleCount = val;
    step2.classList.remove('hidden');
    step3.classList.add('hidden');
    vehicleCsvStatus.textContent = '';
    vehicleTableContainer.innerHTML = '';
    toShipmentsBtn.disabled = true;
    window.scrollTo({ top: step2.offsetTop - 10, behavior: 'smooth' });
  });

  // Reset flow
  resetBtn.addEventListener('click', () => {
    vehicleCountInput.value = '';
    vehicleCsvInput.value = '';
    shipmentCsvInput.value = '';
    vehicleCsvStatus.textContent = '';
    shipmentCsvStatus.textContent = '';
    vehicleTableContainer.innerHTML = '';
    shipmentTableContainer.innerHTML = '';
    toShipmentsBtn.disabled = true;
    step2.classList.add('hidden');
    step3.classList.add('hidden');
    declaredVehicleCount = null;
  });

  // Vehicle CSV upload
  vehicleCsvInput?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const result = validateHeaders(headers, VEHICLE_HEADERS);
      renderTable(vehicleTableContainer, headers, rows);
      if (!result.valid) {
        notify(
          vehicleCsvStatus,
          'Header mismatch. Expected: ' + VEHICLE_HEADERS.join(', '),
          'error'
        );
        toShipmentsBtn.disabled = true;
        return;
      }
      vehiclesParsed = { headers, rows };
      let msg = `Loaded ${rows.length} vehicle rows.`;
      if (declaredVehicleCount != null && rows.length !== declaredVehicleCount) {
        msg += ` Note: vehicle count (${declaredVehicleCount}) differs from rows (${rows.length}).`;
        notify(vehicleCsvStatus, msg, 'warn');
      } else {
        notify(vehicleCsvStatus, msg, 'success');
      }
      toShipmentsBtn.disabled = false;
      updateMapButtonState();
    } catch (err) {
      console.error(err);
      notify(vehicleCsvStatus, 'Failed to read CSV. Please check the file.', 'error');
      toShipmentsBtn.disabled = true;
      vehiclesParsed = null;
      updateMapButtonState();
    }
  });

  // Proceed to shipments after vehicles parsed
  toShipmentsBtn.addEventListener('click', () => {
    step3.classList.remove('hidden');
    shipmentCsvStatus.textContent = '';
    shipmentTableContainer.innerHTML = '';
    window.scrollTo({ top: step3.offsetTop - 10, behavior: 'smooth' });
  });

  // Shipment CSV upload
  shipmentCsvInput?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, rows } = parseCSV(text);
      const result = validateHeaders(headers, SHIPMENT_HEADERS);
      renderTable(shipmentTableContainer, headers, rows);
      if (!result.valid) {
        notify(
          shipmentCsvStatus,
          'Header mismatch. Expected: ' + SHIPMENT_HEADERS.join(', '),
          'error'
        );
        return;
      }
      shipmentsParsed = { headers, rows };
      notify(shipmentCsvStatus, `Loaded ${rows.length} shipment rows.`, 'success');
      updateMapButtonState();
    } catch (err) {
      console.error(err);
      notify(shipmentCsvStatus, 'Failed to read CSV. Please check the file.', 'error');
      shipmentsParsed = null;
      updateMapButtonState();
    }
  });

  // Template downloads
  downloadVehicleTemplate?.addEventListener('click', () => {
    downloadCSV('vehicles_template.csv', VEHICLE_HEADERS, []);
  });
  downloadShipmentTemplate?.addEventListener('click', () => {
    downloadCSV('shipments_template.csv', SHIPMENT_HEADERS, []);
  });

  // Show Map
  showMapBtn?.addEventListener('click', () => {
    if (!vehiclesParsed || !shipmentsParsed) return;
    mapSection.classList.remove('hidden');
    setTimeout(() => {
      renderMapFromData(vehiclesParsed, shipmentsParsed);
    }, 0);
    window.scrollTo({ top: mapSection.offsetTop - 10, behavior: 'smooth' });
  });

  // Geocode & plot addresses
  geocodeBtn?.addEventListener('click', async () => {
    const text = (addressInput?.value || '').trim();
    if (!text) return;
    const addresses = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!addresses.length) return;
    try {
      notify(geocodeStatus, 'Geocoding addressesâ€¦', '');
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses, country: (countryCode?.value || '').trim() })
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      try { console.log('[API] /api/geocode', { status: res.status, results: (data.results||[]).length }); } catch (e) {}
      const results = data.results || [];
      // Add markers for geocoded points
      ensureMap();
      for (const r of results) {
        if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
          const marker = L.circleMarker([r.lat, r.lng], markerStyle('pickup'))
            .bindPopup(`<strong>${escapeHtml(r.query)}</strong><br>${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`);
          marker.addTo(window._markersLayer);
        }
      }
      if (results.length) {
        const pts = results.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).map(r => [r.lat, r.lng]);
        if (pts.length) window._mapInstance.fitBounds(L.latLngBounds(pts).pad(0.2));
      }
      notify(geocodeStatus, `Geocoded ${results.filter(r=>Number.isFinite(r.lat)).length}/${results.length} addresses.`, 'success');
    } catch (e) {
      notify(geocodeStatus, 'Failed to geocode. Check server/key.', 'error');
    }
  });

  // Zone drawing controls
  // Layer toggles
  toggleInputDetail?.addEventListener('change', () => {
    ensureMap();
    const show = !!toggleInputDetail.checked;
    if (show) {
      if (window._markersLayer && !mapHasLayer(window._markersLayer)) window._markersLayer.addTo(window._mapInstance);
    } else {
      if (window._markersLayer && mapHasLayer(window._markersLayer)) window._markersLayer.remove();
    }
  });
  toggleRouteSteps?.addEventListener('change', () => {
    ensureMap();
    const show = !!toggleRouteSteps.checked;
    if (show) {
      if (window._stepsLayer && !mapHasLayer(window._stepsLayer)) window._stepsLayer.addTo(window._mapInstance);
    } else {
      if (window._stepsLayer && mapHasLayer(window._stepsLayer)) window._stepsLayer.remove();
    }
  });
  startNoGoBtn?.addEventListener('click', () => beginDraw('nogo'));
  startGeofenceBtn?.addEventListener('click', () => beginDraw('fence'));
  finishPolygonBtn?.addEventListener('click', finishPolygon);
  // Optimize routes
  optimizeBtn?.addEventListener('click', async () => {
    if (!vehiclesParsed || !shipmentsParsed) return;
    ensureMap();
    notify(optimizeStatus, 'Optimizing routes…', '');
    try {
      const zones = collectZones();
      const payload = {
        vehicles: { headers: vehiclesParsed.headers, rows: vehiclesParsed.rows },
        shipments: { headers: shipmentsParsed.headers, rows: shipmentsParsed.rows },
        zones,
        options: {
          use_road_routes: !!(useRoadRoutes?.checked),
          vehicle_restrictions: {
            long_vehicle: true, // treat commercial for constraints usage
            max_length_m: parseFloat(vehicleLengthM?.value || '') || undefined,
          }
        },
        nb_api_key: (nbApiKey?.value || '').trim() || undefined,
        tt_api_key: (ttApiKey?.value || '').trim() || undefined,
      };
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      try { console.log('[API] /api/optimize', { status: res.status, assignments: (data.assignments||[]).length, notice: data.notice }); } catch (e) {}
      renderOptimizedRoutes(data);
      renderOptimizationSummary(data);
      let msg = 'Optimization complete.';
      if (data.notice) msg += ' ' + data.notice;
      if (data.provider_error) msg += ' Provider: ' + String(data.provider_error).slice(0,300);
      notify(optimizeStatus, msg, 'success');
    } catch (e) {
      console.error(e);
      notify(optimizeStatus, 'Optimization failed. Check server logs/API key.', 'error');
    }
  });
  clearZonesBtn?.addEventListener('click', clearZones);

  function updateMapButtonState() {
    const ready = !!(vehiclesParsed && shipmentsParsed);
    if (showMapBtn) showMapBtn.disabled = !ready;
    if (optimizeBtn) optimizeBtn.disabled = !ready;
  }
});

// CSV parser that handles quoted fields, commas, CRLF/LF
function parseCSV(text) {
  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const rows = [];
  let cur = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"') {
        if (next === '"') {
          // Escaped quote
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(cur);
        cur = '';
      } else if (c === '\n') {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else if (c === '\r') {
        // Handle CRLF by peeking next '\n'
        if (next === '\n') {
          // consume next in the loop progression
        }
      } else {
        cur += c;
      }
    }
  }
  // Push last cell/row if any
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }

  // Trim possible empty trailing row
  while (rows.length && rows[rows.length - 1].every((x) => x === '')) {
    rows.pop();
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => (h ?? '').trim());
  const dataRows = rows.slice(1).map((r) => {
    const arr = Array.from({ length: headers.length }, (_, i) => (r[i] ?? '').trim());
    return arr;
  });
  return { headers, rows: dataRows };
}

function validateHeaders(actual, expected) {
  const norm = (s) => String(s || '').trim();
  if (actual.length !== expected.length) {
    return { valid: false, reason: 'length', actual, expected };
  }
  for (let i = 0; i < expected.length; i++) {
    if (norm(actual[i]) !== norm(expected[i])) {
      return { valid: false, reason: 'mismatch', index: i, actual, expected };
    }
  }
  return { valid: true };
}

function renderTable(container, headers, rows, limit = 1000) {
  if (!container) return;
  if (!headers || headers.length === 0) {
    container.innerHTML = '<p class="hint">No data to display.</p>';
    return;
  }
  const safe = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const headHtml = '<tr>' + headers.map((h) => `<th>${safe(h)}</th>`).join('') + '</tr>';
  const bodyRows = rows.slice(0, limit).map((r) => '<tr>' + r.map((c) => `<td title="${safe(c)}">${safe(c)}</td>`).join('') + '</tr>').join('');
  container.innerHTML = `<div class="table-scroll"><table><thead>${headHtml}</thead><tbody>${bodyRows}</tbody></table></div>`;
  if (rows.length > limit) {
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = `Showing first ${limit} of ${rows.length} rows.`;
    container.appendChild(note);
  }
}

function notify(el, msg, type = 'info') {
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${type}`;
}

function downloadCSV(filename, headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(','));
  for (const r of rows) {
    lines.push(r.map(csvEscape).join(','));
  }
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

// Map helpers
function renderMapFromData(vehiclesParsed, shipmentsParsed) {
  // Initialize map if needed
  if (!window.L) {
    console.warn('Leaflet not loaded');
    return;
  }
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  if (!window._mapInstance) {
    window._mapInstance = L.map(mapEl).setView([20, 0], 2);
    // Use TomTom raster tiles if key available; otherwise fallback to OSM
    if (window._tomtomKey) {
      L.tileLayer('https://{s}.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=' + encodeURIComponent(window._tomtomKey), {
        subdomains: ['a', 'b', 'c'],
        maxZoom: 20,
        attribution: 'Map tiles &copy; TomTom'
      }).addTo(window._mapInstance);
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(window._mapInstance);
    }
  }
  const map = window._mapInstance;

  // Clear previous layer
  if (window._markersLayer) {
    window._markersLayer.remove();
  }
  window._markersLayer = L.layerGroup().addTo(map);
  if (window._polygonsLayer) {
    window._polygonsLayer.remove();
  }
  window._polygonsLayer = L.layerGroup().addTo(map);

  if (window._routesLayer) { window._routesLayer.remove(); }
  if (window._stepsLayer) { window._stepsLayer.remove(); }
  // Build points
  const vIdx = indexMap(vehiclesParsed.headers);
  const sIdx = indexMap(shipmentsParsed.headers);

  const pts = [];
  // Vehicle starts
  for (const r of vehiclesParsed.rows) {
    const lat = parseFloatSafe(r[vIdx['start_latitude']]);
    const lng = parseFloatSafe(r[vIdx['start_longitude']]);
    if (isFinite(lat) && isFinite(lng)) {
      pts.push({ lat, lng, type: 'vehicle-start', label: `Vehicle ${r[vIdx['id']]} start` });
    }
    const eLat = parseFloatSafe(r[vIdx['end_latitude']]);
    const eLng = parseFloatSafe(r[vIdx['end_longitude']]);
    if (isFinite(eLat) && isFinite(eLng)) {
      pts.push({ lat: eLat, lng: eLng, type: 'vehicle-end', label: `Vehicle ${r[vIdx['id']]} end` });
    }
  }

  // Shipments pickups and deliveries
  for (const r of shipmentsParsed.rows) {
    const pLat = parseFloatSafe(r[sIdx['Pickup Location Lat']]);
    const pLng = parseFloatSafe(r[sIdx['Pickup Location Lng']]);
    if (isFinite(pLat) && isFinite(pLng)) {
      pts.push({ lat: pLat, lng: pLng, type: 'pickup', label: `Pickup ${r[sIdx['Pickup Id']]}` });
    }
    const dLat = parseFloatSafe(r[sIdx['Delivery Location Lat']]);
    const dLng = parseFloatSafe(r[sIdx['Delivery Location Lng']]);
    if (isFinite(dLat) && isFinite(dLng)) {
      pts.push({ lat: dLat, lng: dLng, type: 'delivery', label: `Delivery ${r[sIdx['Delivery Id']]}` });
    }
  }

  // Add markers
  for (const p of pts) {
    const marker = L.circleMarker([p.lat, p.lng], markerStyle(p.type))
      .bindPopup(`<strong>${escapeHtml(p.label)}</strong><br>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`);
    marker.addTo(window._markersLayer);
  }

  // Fit bounds
  if (pts.length) {
    const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds.pad(0.2));
  }
}

function parseFloatSafe(v) {
  const n = parseFloat(String(v || '').trim());
  return Number.isFinite(n) ? n : NaN;
}

function indexMap(headers) {
  const m = {};
  headers.forEach((h, i) => { m[h] = i; });
  return m;
}

function markerStyle(type) {
  const styles = {
    'vehicle-start': { radius: 6, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9 },
    'vehicle-end':   { radius: 6, color: '#67e8f9', fillColor: '#67e8f9', fillOpacity: 0.9 },
    'pickup':        { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.9 },
    'delivery':      { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 },
  };
  return styles[type] || { radius: 5, color: '#a1a1aa', fillColor: '#a1a1aa', fillOpacity: 0.9 };
}

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Simple polygon drawing helpers
function ensureMap() {
  if (!window._mapInstance) {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    window._mapInstance = L.map(mapEl).setView([20, 0], 2);
    if (window._tomtomKey) {
      L.tileLayer('https://{s}.api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=' + encodeURIComponent(window._tomtomKey), {
        subdomains: ['a','b','c'], maxZoom: 20, attribution: 'Map tiles &copy; TomTom'
      }).addTo(window._mapInstance);
    } else {
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(window._mapInstance);
    }
    window._markersLayer = L.layerGroup().addTo(window._mapInstance);
    window._polygonsLayer = L.layerGroup().addTo(window._mapInstance);
  }
}

function beginDraw(mode) {
  ensureMap();
  const finishPolygonBtn = document.getElementById('finishPolygon');
  const geocodeStatus = document.getElementById('geocodeStatus');
  const ds = (window._drawState = window._drawState || { mode: null, points: [] });
  ds.mode = mode;
  ds.points = [];
  if (finishPolygonBtn) finishPolygonBtn.disabled = false;
  notify(geocodeStatus, mode === 'nogo' ? 'Drawing No-Go polygon: click on map to add points' : 'Drawing Geofence polygon: click on map to add points', '');
  window._mapInstance.off('click', onMapClickDraw);
  window._mapInstance.on('click', onMapClickDraw);
}

function onMapClickDraw(ev) {
  const ds = (window._drawState = window._drawState || { mode: null, points: [] });
  if (!ds.mode) return;
  const { lat, lng } = ev.latlng;
  ds.points.push([lat, lng]);
  if (ds._temp) { ds._temp.remove(); }
  ds._temp = L.polyline(ds.points, { color: ds.mode === 'nogo' ? '#ef4444' : '#a855f7', dashArray: '4,4' }).addTo(window._polygonsLayer);
}

function finishPolygon() {
  const finishPolygonBtn = document.getElementById('finishPolygon');
  const ds = (window._drawState = window._drawState || { mode: null, points: [] });
  if (!ds.mode || ds.points.length < 3) return;
  if (ds._temp) { ds._temp.remove(); ds._temp = null; }
  const color = ds.mode === 'nogo' ? '#ef4444' : '#a855f7';
  const poly = L.polygon(ds.points, { color, fillColor: color, fillOpacity: 0.2, weight: 2 }).addTo(window._polygonsLayer);
  poly.options._zoneType = ds.mode;
  ds.mode = null;
  ds.points = [];
  if (finishPolygonBtn) finishPolygonBtn.disabled = true;
  window._mapInstance.off('click', onMapClickDraw);
}

function clearZones() {
  if (window._polygonsLayer) {
    window._polygonsLayer.clearLayers();
  }
}

// Collect zones from drawn polygons
function collectZones() {
  const zones = [];
  const layer = window._polygonsLayer;
  if (!layer) return zones;
  (layer.getLayers() || []).forEach(l => {
    if (typeof l.getLatLngs !== 'function') return;
    const type = (l.options && l.options._zoneType) || 'fence';
    const rings = l.getLatLngs();
    const ring = Array.isArray(rings) ? (Array.isArray(rings[0]) ? rings[0] : rings) : [];
    const poly = ring.map(p => [p.lat, p.lng]);
    if (poly.length >= 3) zones.push({ type, polygon: poly });
  });
  return zones;
}

// Render optimized routes
function renderOptimizedRoutes(resp) {
  const map = window._mapInstance; if (!map) return;
  if (window._routesLayer) { window._routesLayer.remove(); }
  window._routesLayer = L.layerGroup().addTo(map);
  if (window._stepsLayer) { window._stepsLayer.remove(); }
  window._stepsLayer = L.layerGroup().addTo(map);
  const assigns = resp && resp.assignments ? resp.assignments : [];
  assigns.forEach(a => {
    const coords = (a.route && a.route.coordinates) || [];
    const latlngs = coords.map(c => [c[1], c[0]]);
    const color = colorForVehicle(a.vehicle_id);
    if (latlngs.length >= 2) {
      L.polyline(latlngs, { color, weight: 4, opacity: 0.9 }).addTo(window._routesLayer);
    }
    // Stops markers with ETAs and sequence numbers
    let seq = 1;
    (a.stops || []).forEach(st => {
      if (!isFinite(st.lat) || !isFinite(st.lng)) return;
      const t = st.type;
      const eta = st.eta || st.eta_calc;
      const icon = L.divIcon({
        className: 'seq-marker',
        html: '<span style="background:' + color + ';display:inline-block;width:100%;height:100%;border-radius:12px;line-height:18px;">' + seq + '</span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
      const m = L.marker([st.lat, st.lng], { icon })
        .bindPopup('<strong>' + escapeHtml(String(a.vehicle_id)) + ' - ' + escapeHtml(String(t)) + '</strong><br>' + st.lat.toFixed(6) + ', ' + st.lng.toFixed(6) + (eta ? ('<br>ETA: ' + escapeHtml(String(eta))) : ''));
      m.addTo(window._stepsLayer);
      seq++;
    });
  });
  // Respect layer toggles
  var stepsToggle = document.getElementById('toggleRouteSteps');
  if (stepsToggle && !stepsToggle.checked && window._stepsLayer) { window._stepsLayer.remove(); }
  var inputToggle = document.getElementById('toggleInputDetail');
  if (inputToggle && !inputToggle.checked && window._markersLayer) { window._markersLayer.remove(); }
}

function mapHasLayer(layer) {
  try { return !!window._mapInstance && window._mapInstance.hasLayer(layer); } catch (e) { return false; }
}

function renderOptimizationSummary(resp) {
  const el = document.getElementById('optimizeSummary');
  if (!el) return;
  const summary = resp && resp.summary ? resp.summary : {};
  const assigns = resp && resp.assignments ? resp.assignments : [];
  const rows = [];
  rows.push(`<div class="table-scroll"><table><thead><tr><th>Vehicle</th><th>Distance</th><th>Time</th><th>Stops</th></tr></thead><tbody>`);
  for (const a of assigns) {
    const m = a.metrics || {}; const km = (m.distance_m || 0) / 1000;
    const mins = (m.time_s || 0) / 60;
    rows.push(`<tr><td>${escapeHtml(String(a.vehicle_id))}</td><td>${km.toFixed(2)} km</td><td>${mins.toFixed(1)} min</td><td>${(a.stops||[]).length}</td></tr>`);
  }
  rows.push(`</tbody></table></div>`);
  const totalKm = summary.total_distance_km != null ? summary.total_distance_km : (assigns.reduce((s,a)=>s+((a.metrics&&a.metrics.distance_m)||0),0)/1000);
  const totalMin = summary.total_time_min != null ? summary.total_time_min : Math.round(assigns.reduce((s,a)=>s+((a.metrics&&a.metrics.time_s)||0),0)/60);
  rows.push(`<div class="status">Total Distance: <strong>${Number(totalKm).toFixed(2)} km</strong> &nbsp; | &nbsp; Total Time: <strong>${Number(totalMin).toFixed(0)} min</strong></div>`);
  el.innerHTML = rows.join('\n');
}

function colorForVehicle(id) {
  const s = String(id || 'veh');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 75%, 55%)`;
}




