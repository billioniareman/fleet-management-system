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
      let msg = `Loaded ${rows.length} vehicle rows.`;
      if (declaredVehicleCount != null && rows.length !== declaredVehicleCount) {
        msg += ` Note: vehicle count (${declaredVehicleCount}) differs from rows (${rows.length}).`;
        notify(vehicleCsvStatus, msg, 'warn');
      } else {
        notify(vehicleCsvStatus, msg, 'success');
      }
      toShipmentsBtn.disabled = false;
    } catch (err) {
      console.error(err);
      notify(vehicleCsvStatus, 'Failed to read CSV. Please check the file.', 'error');
      toShipmentsBtn.disabled = true;
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
      notify(shipmentCsvStatus, `Loaded ${rows.length} shipment rows.`, 'success');
    } catch (err) {
      console.error(err);
      notify(shipmentCsvStatus, 'Failed to read CSV. Please check the file.', 'error');
    }
  });

  // Template downloads
  downloadVehicleTemplate?.addEventListener('click', () => {
    downloadCSV('vehicles_template.csv', VEHICLE_HEADERS, []);
  });
  downloadShipmentTemplate?.addEventListener('click', () => {
    downloadCSV('shipments_template.csv', SHIPMENT_HEADERS, []);
  });
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
