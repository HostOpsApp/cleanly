export function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Normalize a date string to YYYY-MM-DD.
 * Handles: MM/DD/YY (QBO format), MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD, MM-DD-YYYY,
 * and ISO datetime strings like "2024-03-15T10:00:00"
 */
export function normalizeDate(val) {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim();
  if (!s) return '';

  // Already ISO date YYYY-MM-DD (optionally with time)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 10);
  }

  // MM/DD/YY (QBO format: e.g. 05/14/26) — two-digit year, assume 2000s
  const slashYYMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (slashYYMatch) {
    const [, m, d, yy] = slashYYMatch;
    const year = parseInt(yy, 10) >= 0 ? `20${yy.padStart(2, '0')}` : `19${yy.padStart(2, '0')}`;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM-DD-YYYY
  const dashMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (dashMatch) {
    const [, m, d, y] = dashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try native Date parse as a last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().substring(0, 10);
  }

  return s;
}

/**
 * Normalize a datetime string to ISO 8601.
 * Handles same formats as normalizeDate but keeps time if present.
 */
export function normalizeDateTime(val) {
  if (!val || typeof val !== 'string') return '';
  const s = val.trim();
  if (!s) return '';

  // Already ISO datetime
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;

  // YYYY-MM-DD with no time — return as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY HH:MM or MM/DD/YYYY
  const slashDt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})([\sT](\d{2}:\d{2}.*))?/);
  if (slashDt) {
    const [, m, d, y, , time] = slashDt;
    const base = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return time ? `${base}T${time.trim()}` : base;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();

  return s;
}

/**
 * Pick the first defined, non-empty value from the row for a list of possible column names.
 * Case-insensitive matching against all keys.
 */
export function col(row, ...names) {
  // Build a lowercased key map once per call
  const lowerRow = {};
  Object.keys(row).forEach(k => { lowerRow[k.toLowerCase()] = row[k]; });

  for (const name of names) {
    // Exact match first
    if (row[name] !== undefined && row[name] !== '') return row[name];
    // Case-insensitive
    const lk = name.toLowerCase();
    if (lowerRow[lk] !== undefined && lowerRow[lk] !== '') return lowerRow[lk];
  }
  return '';
}

/**
 * Normalize reservation key based on channel:
 * - Airbnb: extract the confirmation code = everything after the last hyphen in channelReservationId
 * - All others (HM direct, VRBO, etc.): use existing HM-code logic or fall back to reservationId
 */
export function normalizeReservationKey(externalReservationId, reservationId, channel, channelReservationId) {
  const channelLower = (channel || '').toLowerCase();

  // Airbnb: use everything after the last hyphen in channelReservationId
  if (channelLower.includes('airbnb') && channelReservationId && channelReservationId.trim()) {
    const parts = channelReservationId.trim().split('-');
    const code = parts[parts.length - 1].trim();
    if (code) return code.toUpperCase();
  }

  // Non-Airbnb: use externalReservationId if it looks like an HM code
  let key = '';
  if (externalReservationId && externalReservationId.trim()) {
    const ext = externalReservationId.trim();
    if (ext.length >= 10) {
      const last10 = ext.slice(-10);
      if (/^HM/i.test(last10)) {
        key = last10.toUpperCase();
      } else {
        key = ext;
      }
    } else {
      key = ext;
    }
  } else {
    key = (reservationId || '').trim();
  }

  // If key doesn't start with a letter, fall back to reservationId
  if (key && !/^[A-Za-z]/.test(key)) {
    key = (reservationId || '').trim();
  }

  // If key is over 20 characters, fall back to reservationId
  if (key && key.length > 20) {
    key = (reservationId || '').trim();
  }

  return key || (reservationId || '').trim();
}

export function classifyQboFeeType(description) {
  if (!description) return 'Error / Needs Review';
  const d = description.trim().toLowerCase();
  if (d.startsWith('pet')) return 'Pet Fee';
  if (d.startsWith('cleaning')) return 'Cleaning Fee';
  if (d.includes('pet fee')) return 'Pet Fee';
  if (d.includes('cleaning fee')) return 'Cleaning Fee';
  return 'Error / Needs Review';
}

/**
 * Debug helper: log all column names found in the CSV rows.
 */
export function getCSVColumns(rows) {
  if (!rows || rows.length === 0) return [];
  return Object.keys(rows[0]);
}