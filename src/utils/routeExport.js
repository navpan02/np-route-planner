/**
 * Route export utilities — Google Maps URL builder + CSV download helpers
 */

const CHUNK = 23; // 23 waypoints + origin + destination = 25 total (Google Maps max)

/**
 * Build an array of Google Maps direction URLs for a stop sequence.
 * Each URL covers up to 25 stops (CHUNK waypoints + origin + dest).
 *
 * @param {Stop[]} stops — ordered stop list with lat/lng
 * @returns {string[]}
 */
export function buildGoogleMapsUrls(stops) {
  if (!stops || stops.length === 0) return [];
  const urls = [];
  for (let i = 0; i < stops.length; i += CHUNK) {
    const chunk = stops.slice(i, Math.min(i + CHUNK + 1, stops.length));
    const encoded = chunk.map(s => `${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`);
    const origin = encoded[0];
    const dest = encoded[encoded.length - 1];
    const waypoints = encoded.slice(1, -1).join('/');
    const url = waypoints
      ? `https://maps.google.com/maps/dir/${origin}/${waypoints}/${dest}`
      : `https://maps.google.com/maps/dir/${origin}/${dest}`;
    urls.push(url);
  }
  return urls;
}

/**
 * Trigger a CSV download in the browser.
 *
 * @param {string} filename
 * @param {string[][]} rows — 2D array; first row is headers
 */
function downloadCSV(filename, rows) {
  const csv = rows
    .map(row =>
      row
        .map(cell => {
          const s = cell === null || cell === undefined ? '' : String(cell);
          // Quote cells containing comma, quote, or newline
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const HEADERS = [
  'sequence_number',
  'unique_id',
  'address',
  'city',
  'state',
  'zip',
  'lat',
  'lng',
  'lead_type',
  'cluster_id',
  'agent_name',
  'plan_date',
];

function stopToRow(stop, seqNum, agentName, planDate) {
  return [
    seqNum === null ? '' : seqNum,
    stop.unique_id ?? '',
    stop.address ?? '',
    stop.city ?? '',
    stop.state ?? '',
    stop.zip ?? '',
    stop.lat !== undefined ? Number(stop.lat).toFixed(6) : '',
    stop.lng !== undefined ? Number(stop.lng).toFixed(6) : '',
    stop.address_type ?? '',
    stop.cluster_id ?? '',
    agentName,
    planDate,
  ];
}

/**
 * Download a CSV for a single agent's route.
 *
 * @param {{ agent_name: string, stop_sequence: Stop[] }} route
 * @param {string} planDate — YYYY-MM-DD
 */
export function exportAgentCSV(route, planDate) {
  const rows = [HEADERS];
  route.stop_sequence.forEach((stop, i) => {
    rows.push(stopToRow(stop, i + 1, route.agent_name, planDate));
  });
  const safeName = route.agent_name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  downloadCSV(`route_${safeName}_${planDate}.csv`, rows);
}

/**
 * Download a combined CSV for all agents, including UNASSIGNED rows.
 *
 * @param {{ agent_name: string, stop_sequence: Stop[] }[]} routes
 * @param {Stop[]} unassigned
 * @param {string} planDate — YYYY-MM-DD
 */
export function exportAllCSV(routes, unassigned, planDate) {
  const rows = [HEADERS];
  for (const route of routes) {
    route.stop_sequence.forEach((stop, i) => {
      rows.push(stopToRow(stop, i + 1, route.agent_name, planDate));
    });
  }
  for (const stop of unassigned ?? []) {
    rows.push(stopToRow(stop, null, 'UNASSIGNED', planDate));
  }
  downloadCSV(`routes_all_${planDate}.csv`, rows);
}
