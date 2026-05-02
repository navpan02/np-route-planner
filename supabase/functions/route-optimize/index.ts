import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface InputAddress {
  unique_id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  address_type: string;
  lat?: number;
  lng?: number;
}

interface Agent {
  id: string;
  name: string;
  start_address: string;
  start_lat?: number;
  start_lng?: number;
}

interface Constraints {
  max_stops: number;
  max_miles: number;
  excluded_zips: string[];
  priority_order: string[];
  cluster_radius_m: number;
  min_cluster_size: number;
  clustering_algorithm: 'dbscan' | 'dbscan_2opt' | 'hdbscan' | 'voronoi';
}

interface Stop {
  unique_id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  address_type: string;
  lat: number;
  lng: number;
  priority_score: number;
  cluster_id?: string;
  stop_order?: number;
}

interface Cluster {
  id: string;
  center: { lat: number; lng: number };
  size: number;
  stops: Stop[];
  priority_score: number;
}

interface RouteResult {
  agent_id: string;
  agent_name: string;
  assignment_id: string;
  clusters: Cluster[];
  stop_sequence: Stop[];
  total_stops: number;
  total_miles: number;
  est_hours: number;
  google_maps_urls: string[];
  view_token: string;
}

// ─── Geo utilities ────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clusterCenter(stops: Stop[]): { lat: number; lng: number } {
  const lat = stops.reduce((s, p) => s + p.lat, 0) / stops.length;
  const lng = stops.reduce((s, p) => s + p.lng, 0) / stops.length;
  return { lat, lng };
}

// ─── Nominatim geocoding (cache-first) ───────────────────────────────────────

function normaliseKey(addr: string): string {
  return addr.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function geocodeBatch(
  addresses: InputAddress[],
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, { lat: number; lng: number } | null>> {
  const result = new Map<string, { lat: number; lng: number } | null>();
  const needGeocoding: InputAddress[] = [];

  for (const addr of addresses) {
    // Parse as Number() first — PostgreSQL numeric columns come back as strings via PostgREST
    const lat = Number(addr.lat);
    const lng = Number(addr.lng);
    if (
      addr.lat != null && addr.lng != null &&
      isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180 &&
      !(lat === 0 && lng === 0)
    ) {
      result.set(addr.unique_id, { lat, lng });
    } else {
      needGeocoding.push(addr);
    }
  }

  if (needGeocoding.length === 0) return result;

  const keyToId = new Map<string, string[]>();
  for (const addr of needGeocoding) {
    const full = `${addr.address}, ${addr.city}, ${addr.state} ${addr.zip}`;
    const key = normaliseKey(full);
    if (!keyToId.has(key)) keyToId.set(key, []);
    keyToId.get(key)!.push(addr.unique_id);
  }

  const keys = Array.from(keyToId.keys());
  const { data: cached } = await supabase
    .from('geocode_cache')
    .select('address_key, lat, lng')
    .in('address_key', keys);

  const cachedKeys = new Set<string>();
  for (const row of cached ?? []) {
    cachedKeys.add(row.address_key);
    const ids = keyToId.get(row.address_key) ?? [];
    for (const id of ids) {
      result.set(id, { lat: Number(row.lat), lng: Number(row.lng) });
    }
  }

  const misses = needGeocoding.filter(a => {
    const full = `${a.address}, ${a.city}, ${a.state} ${a.zip}`;
    return !cachedKeys.has(normaliseKey(full));
  });

  const seen = new Set<string>();
  for (const addr of misses) {
    const full = `${addr.address}, ${addr.city}, ${addr.state} ${addr.zip}`;
    const key = normaliseKey(full);
    if (seen.has(key)) continue;
    seen.add(key);

    await new Promise(r => setTimeout(r, 1100));

    try {
      const q = encodeURIComponent(full);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
        { headers: { 'User-Agent': 'NPLawn-RouteOptimizer/1.0' } },
      );
      const json = await res.json();
      if (json.length > 0) {
        const geo = { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) };
        await supabase.from('geocode_cache').upsert({
          address_key: key,
          raw_address: full,
          lat: geo.lat,
          lng: geo.lng,
          source: 'nominatim',
        });
        for (const id of keyToId.get(key) ?? []) {
          result.set(id, geo);
        }
      } else {
        for (const id of keyToId.get(key) ?? []) {
          result.set(id, null);
        }
      }
    } catch {
      for (const id of keyToId.get(key) ?? []) {
        result.set(id, null);
      }
    }
  }

  return result;
}

// ─── DBSCAN clustering ────────────────────────────────────────────────────────

function dbscan(
  points: Stop[],
  epsKm: number,
  minPts: number,
): Map<number, string> {
  const labels = new Map<number, string>();
  let clusterId = 0;

  const regionQuery = (idx: number): number[] => {
    const neighbors: number[] = [];
    for (let j = 0; j < points.length; j++) {
      if (j === idx) continue;
      if (haversineKm(points[idx].lat, points[idx].lng, points[j].lat, points[j].lng) <= epsKm) {
        neighbors.push(j);
      }
    }
    return neighbors;
  };

  for (let i = 0; i < points.length; i++) {
    if (labels.has(i)) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts - 1) {
      labels.set(i, 'noise');
      continue;
    }
    const cid = `C${clusterId++}`;
    labels.set(i, cid);
    const queue = [...neighbors];
    while (queue.length > 0) {
      const q = queue.shift()!;
      if (labels.get(q) === 'noise') labels.set(q, cid);
      if (labels.has(q) && labels.get(q) !== 'noise') continue;
      labels.set(q, cid);
      const qNeighbors = regionQuery(q);
      if (qNeighbors.length >= minPts - 1) queue.push(...qNeighbors);
    }
  }

  const clusterPoints = new Map<string, Stop[]>();
  for (const [i, cid] of labels.entries()) {
    if (cid !== 'noise') {
      if (!clusterPoints.has(cid)) clusterPoints.set(cid, []);
      clusterPoints.get(cid)!.push(points[i]);
    }
  }
  for (const [i, cid] of labels.entries()) {
    if (cid !== 'noise') continue;
    let bestCluster = 'noise';
    let bestDist = 1.0;
    for (const [clId, cPoints] of clusterPoints.entries()) {
      const center = clusterCenter(cPoints);
      const d = haversineKm(points[i].lat, points[i].lng, center.lat, center.lng);
      if (d < bestDist) { bestDist = d; bestCluster = clId; }
    }
    labels.set(i, bestCluster);
  }

  return labels;
}

// ─── UnionFind (for HDBSCAN) ──────────────────────────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x: number, y: number): boolean {
    const px = this.find(x), py = this.find(y);
    if (px === py) return false;
    if (this.rank[px] < this.rank[py]) { this.parent[px] = py; }
    else if (this.rank[px] > this.rank[py]) { this.parent[py] = px; }
    else { this.parent[py] = px; this.rank[px]++; }
    return true;
  }
}

// ─── Build Cluster[] from index→label map ────────────────────────────────────

function buildClustersFromLabels(
  points: Stop[],
  labels: Map<number, string>,
  unassignedOut: Stop[],
): Cluster[] {
  const clusterMap = new Map<string, Stop[]>();
  for (const [i, cid] of labels.entries()) {
    if (cid === 'noise') { unassignedOut.push(points[i]); continue; }
    if (!clusterMap.has(cid)) clusterMap.set(cid, []);
    clusterMap.get(cid)!.push(points[i]);
  }
  const clusters: Cluster[] = [];
  for (const [cid, stops] of clusterMap.entries()) {
    const center = clusterCenter(stops);
    const priority_score = stops.reduce((s, p) => s + p.priority_score, 0);
    clusters.push({ id: cid, center, size: stops.length, stops, priority_score });
  }
  clusters.sort((a, b) => b.priority_score - a.priority_score);
  return clusters;
}

// ─── HDBSCAN clustering ───────────────────────────────────────────────────────

function hdbscan(
  points: Stop[],
  minPts: number,
): Map<number, string> {
  const n = points.length;
  if (n === 0) return new Map();

  const coreDist: number[] = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const dists: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) dists.push(haversineKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng));
    }
    dists.sort((a, b) => a - b);
    coreDist[i] = dists[Math.min(minPts - 1, dists.length - 1)];
  }

  const mrd = (i: number, j: number) =>
    Math.max(coreDist[i], coreDist[j], haversineKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng));

  const inMST = new Array(n).fill(false);
  const cheapest = new Array(n).fill(Infinity);
  const cheapestFrom = new Array(n).fill(-1);
  const edges: { u: number; v: number; w: number }[] = [];
  cheapest[0] = 0;

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inMST[i] && (u === -1 || cheapest[i] < cheapest[u])) u = i;
    }
    inMST[u] = true;
    if (cheapestFrom[u] !== -1) edges.push({ u: cheapestFrom[u], v: u, w: cheapest[u] });
    for (let v = 0; v < n; v++) {
      if (!inMST[v]) {
        const d = mrd(u, v);
        if (d < cheapest[v]) { cheapest[v] = d; cheapestFrom[v] = u; }
      }
    }
  }

  const sorted = [...edges].sort((a, b) => b.w - a.w);
  let cutThreshold = sorted[0]?.w ?? 1;
  if (sorted.length > 1) {
    let maxGap = 0;
    let cutIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i].w - sorted[i + 1].w;
      if (gap > maxGap) { maxGap = gap; cutIdx = i; }
    }
    cutThreshold = sorted[cutIdx].w;
  }

  const uf = new UnionFind(n);
  for (const e of edges) {
    if (e.w < cutThreshold) uf.union(e.u, e.v);
  }

  const rootCount = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    rootCount.set(r, (rootCount.get(r) ?? 0) + 1);
  }

  let cidCounter = 0;
  const rootToLabel = new Map<number, string>();
  for (const [root, count] of rootCount.entries()) {
    rootToLabel.set(root, count >= minPts ? `C${cidCounter++}` : 'noise');
  }

  const labels = new Map<number, string>();
  for (let i = 0; i < n; i++) {
    labels.set(i, rootToLabel.get(uf.find(i))!);
  }

  const clusterPoints = new Map<string, Stop[]>();
  for (const [i, cid] of labels.entries()) {
    if (cid !== 'noise') {
      if (!clusterPoints.has(cid)) clusterPoints.set(cid, []);
      clusterPoints.get(cid)!.push(points[i]);
    }
  }
  for (const [i, cid] of labels.entries()) {
    if (cid !== 'noise') continue;
    let bestCluster = 'noise';
    let bestDist = 1.0;
    for (const [clId, cPoints] of clusterPoints.entries()) {
      const center = clusterCenter(cPoints);
      const d = haversineKm(points[i].lat, points[i].lng, center.lat, center.lng);
      if (d < bestDist) { bestDist = d; bestCluster = clId; }
    }
    labels.set(i, bestCluster);
  }

  return labels;
}

// ─── Voronoi territory clustering ────────────────────────────────────────────

function voronoiCluster(
  points: Stop[],
  agentPositions: { agentIdx: number; lat: number; lng: number }[],
  epsKm: number,
  minPts: number,
): { labels: Map<number, string>; agentPreassignment: Map<string, number> } {
  if (agentPositions.length === 0 || points.length === 0) {
    return { labels: new Map(), agentPreassignment: new Map() };
  }

  const territoryMap = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    let bestAgent = 0;
    let bestDist = Infinity;
    for (let a = 0; a < agentPositions.length; a++) {
      const d = haversineKm(points[i].lat, points[i].lng, agentPositions[a].lat, agentPositions[a].lng);
      if (d < bestDist) { bestDist = d; bestAgent = a; }
    }
    if (!territoryMap.has(bestAgent)) territoryMap.set(bestAgent, []);
    territoryMap.get(bestAgent)!.push(i);
  }

  const globalLabels = new Map<number, string>();
  const agentPreassignment = new Map<string, number>();
  let clusterCounter = 0;

  for (const [agentIdx, indices] of territoryMap.entries()) {
    const subPoints = indices.map(i => points[i]);
    const subLabels = dbscan(subPoints, epsKm, minPts);

    const subIdToGlobal = new Map<string, string>();
    for (const [j, subCid] of subLabels.entries()) {
      let globalCid: string;
      if (subCid === 'noise') {
        globalCid = 'noise';
      } else {
        if (!subIdToGlobal.has(subCid)) {
          globalCid = `C${clusterCounter++}`;
          subIdToGlobal.set(subCid, globalCid);
          agentPreassignment.set(globalCid, agentIdx);
        }
        globalCid = subIdToGlobal.get(subCid)!;
      }
      globalLabels.set(indices[j], globalCid);
    }
  }

  return { labels: globalLabels, agentPreassignment };
}

// ─── 2-opt walk-path improvement ─────────────────────────────────────────────

function twoOpt(stops: Stop[]): Stop[] {
  if (stops.length <= 3) return stops;
  let best = [...stops];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const d1 = haversineKm(best[i].lat, best[i].lng, best[i + 1].lat, best[i + 1].lng) +
          (j + 1 < best.length
            ? haversineKm(best[j].lat, best[j].lng, best[j + 1].lat, best[j + 1].lng)
            : 0);
        const d2 = haversineKm(best[i].lat, best[i].lng, best[j].lat, best[j].lng) +
          (j + 1 < best.length
            ? haversineKm(best[i + 1].lat, best[i + 1].lng, best[j + 1].lat, best[j + 1].lng)
            : 0);
        if (d2 < d1 - 1e-9) {
          const seg = best.slice(i + 1, j + 1).reverse();
          best = [...best.slice(0, i + 1), ...seg, ...best.slice(j + 1)];
          improved = true;
        }
      }
    }
  }
  return best;
}

// ─── Nearest-neighbour TSP ────────────────────────────────────────────────────

function nearestNeighbourTSP(
  points: { lat: number; lng: number }[],
  startLat: number,
  startLng: number,
): number[] {
  const visited = new Set<number>();
  const order: number[] = [];
  let curLat = startLat;
  let curLng = startLng;

  while (visited.size < points.length) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      if (visited.has(i)) continue;
      const d = haversineKm(curLat, curLng, points[i].lat, points[i].lng);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    visited.add(best);
    order.push(best);
    curLat = points[best].lat;
    curLng = points[best].lng;
  }
  return order;
}

// ─── Walk distance within cluster ────────────────────────────────────────────

function walkMilesInCluster(stops: Stop[]): number {
  if (stops.length <= 1) return 0;
  const order = nearestNeighbourTSP(
    stops.map(s => ({ lat: s.lat, lng: s.lng })),
    stops[0].lat,
    stops[0].lng,
  );
  let dist = 0;
  for (let i = 1; i < order.length; i++) {
    dist += haversineKm(
      stops[order[i - 1]].lat, stops[order[i - 1]].lng,
      stops[order[i]].lat, stops[order[i]].lng,
    );
  }
  return dist * 0.621371;
}

// ─── Google Maps URL builder ──────────────────────────────────────────────────

function buildGoogleMapsUrls(stops: Stop[]): string[] {
  const CHUNK = 23;
  const urls: string[] = [];
  for (let i = 0; i < stops.length; i += CHUNK) {
    const chunk = stops.slice(i, i + CHUNK + 1);
    const encoded = chunk.map(s => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`);
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

// ─── Random token ─────────────────────────────────────────────────────────────

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function randomUUID(): string {
  return crypto.randomUUID();
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const {
      addresses,
      agents,
      constraints: rawConstraints,
      plan_id,
    } = await req.json();

    if (!addresses || !agents || !plan_id) {
      return new Response(
        JSON.stringify({ error: 'addresses, agents, and plan_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (addresses.length > 10000) {
      return new Response(
        JSON.stringify({ error: 'Maximum 10,000 addresses per run' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // DrawRouteTab always sends plan_id='draw-route-preview' — use permissive constraints
    // so all addresses can be clustered and assigned regardless of what the frontend sends.
    const isPreview = plan_id === 'draw-route-preview';

    const constraints: Constraints = {
      max_stops: isPreview
        ? Math.max(rawConstraints?.max_stops ?? 100, addresses.length)
        : (rawConstraints?.max_stops ?? 100),
      max_miles: isPreview ? 99999 : (rawConstraints?.max_miles ?? 25),
      excluded_zips: rawConstraints?.excluded_zips ?? [],
      priority_order: rawConstraints?.priority_order ?? [
        'homeowner', 'new_construction', 'renter', 'multi_family', 'commercial', 'vacant',
      ],
      cluster_radius_m: rawConstraints?.cluster_radius_m ?? 400,
      min_cluster_size: isPreview ? 1 : (rawConstraints?.min_cluster_size ?? 5),
      clustering_algorithm: rawConstraints?.clustering_algorithm ?? 'dbscan',
    };

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Phase 1: Geocoding + filtering ──────────────────────────────────────

    const geocodeMap = await geocodeBatch(addresses as InputAddress[], supabase);

    const excluded: Stop[] = [];
    const unassigned: Stop[] = [];
    const valid: Stop[] = [];

    for (const addr of addresses as InputAddress[]) {
      const geo = geocodeMap.get(addr.unique_id);

      if (constraints.excluded_zips.includes(addr.zip)) {
        excluded.push({
          ...addr,
          lat: geo?.lat ?? 0,
          lng: geo?.lng ?? 0,
          priority_score: 0,
        });
        continue;
      }

      if (!geo) {
        unassigned.push({
          ...addr,
          lat: 0,
          lng: 0,
          priority_score: 0,
        });
        continue;
      }

      const priorityIdx = constraints.priority_order.indexOf(addr.address_type);
      const priority_score = priorityIdx >= 0
        ? (constraints.priority_order.length - priorityIdx) * 10
        : 5;

      valid.push({ ...addr, lat: geo.lat, lng: geo.lng, priority_score });
    }

    // ── Phase 2: Clustering (algorithm dispatch) ─────────────────────────────

    const epsKm = constraints.cluster_radius_m / 1000;
    const algo = constraints.clustering_algorithm;

    // Parse agent start lat/lng as Number() — PostgreSQL numeric columns come back as strings
    const agentStops: { agentIdx: number; lat: number; lng: number }[] = [];
    for (let i = 0; i < agents.length; i++) {
      const ag: Agent = agents[i];
      const startLat = Number(ag.start_lat);
      const startLng = Number(ag.start_lng);
      if (
        ag.start_lat != null && ag.start_lng != null &&
        isFinite(startLat) && isFinite(startLng)
      ) {
        agentStops.push({ agentIdx: i, lat: startLat, lng: startLng });
      } else {
        const centroid = clusterCenter(valid.length > 0 ? valid : [{ lat: 41.88, lng: -87.63, address: '', city: '', state: '', zip: '', address_type: '', unique_id: '', priority_score: 0 }]);
        agentStops.push({ agentIdx: i, lat: centroid.lat, lng: centroid.lng });
      }
    }

    let clusters: Cluster[];
    let voronoiPreassign: Map<string, number> | null = null;

    if (algo === 'hdbscan') {
      const labelMap = hdbscan(valid, constraints.min_cluster_size);
      clusters = buildClustersFromLabels(valid, labelMap, unassigned);
    } else if (algo === 'voronoi') {
      const { labels, agentPreassignment } = voronoiCluster(valid, agentStops, epsKm, constraints.min_cluster_size);
      clusters = buildClustersFromLabels(valid, labels, unassigned);
      voronoiPreassign = agentPreassignment;
    } else {
      const labelMap = dbscan(valid, epsKm, constraints.min_cluster_size);
      clusters = buildClustersFromLabels(valid, labelMap, unassigned);
    }

    // ── Phase 3: Agent assignment ────────────────────────────────────────────

    const agentRunning = agents.map((ag: Agent, i: number) => ({
      agent: ag,
      start: agentStops[i],
      stops: 0,
      miles: 0,
      assignedClusters: [] as Cluster[],
      curLat: agentStops[i].lat,
      curLng: agentStops[i].lng,
    }));

    for (const cluster of clusters) {
      const walkMi = walkMilesInCluster(cluster.stops);

      if (voronoiPreassign !== null) {
        const preferredIdx = voronoiPreassign.get(cluster.id) ?? -1;
        if (preferredIdx >= 0) {
          const ag = agentRunning[preferredIdx];
          const driveKm = haversineKm(ag.curLat, ag.curLng, cluster.center.lat, cluster.center.lng);
          const newStops = ag.stops + cluster.stops.length;
          const newMiles = ag.miles + driveKm * 0.621371 + walkMi;
          if (newStops <= constraints.max_stops && newMiles <= constraints.max_miles) {
            ag.miles += driveKm * 0.621371 + walkMi;
            ag.stops += cluster.stops.length;
            ag.assignedClusters.push(cluster);
            ag.curLat = cluster.center.lat;
            ag.curLng = cluster.center.lng;
            continue;
          }
        }
      }

      let bestAgent = -1;
      let bestScore = Infinity;

      for (let a = 0; a < agentRunning.length; a++) {
        const ag = agentRunning[a];
        const driveKm = haversineKm(ag.curLat, ag.curLng, cluster.center.lat, cluster.center.lng);
        const driveMi = driveKm * 0.621371;
        const newStops = ag.stops + cluster.stops.length;
        const newMiles = ag.miles + driveMi + walkMi;

        if (newStops <= constraints.max_stops && newMiles <= constraints.max_miles) {
          if (ag.stops < bestScore) {
            bestScore = ag.stops;
            bestAgent = a;
          }
        }
      }

      if (bestAgent === -1) {
        unassigned.push(...cluster.stops);
        continue;
      }

      const ag = agentRunning[bestAgent];
      const driveKm = haversineKm(ag.curLat, ag.curLng, cluster.center.lat, cluster.center.lng);
      ag.miles += driveKm * 0.621371 + walkMi;
      ag.stops += cluster.stops.length;
      ag.assignedClusters.push(cluster);
      ag.curLat = cluster.center.lat;
      ag.curLng = cluster.center.lng;
    }

    // ── Phase 4: TSP sequencing + result building ────────────────────────────

    const routes: RouteResult[] = [];

    for (const ag of agentRunning) {
      if (ag.assignedClusters.length === 0) continue;

      const clusterOrder = nearestNeighbourTSP(
        ag.assignedClusters.map(c => c.center),
        ag.start.lat,
        ag.start.lng,
      );

      const orderedClusters = clusterOrder.map(i => ag.assignedClusters[i]);
      const stopSequence: Stop[] = [];
      let stopOrder = 1;

      const resultClusters: Cluster[] = orderedClusters.map(cluster => {
        const sortedByPriority = [...cluster.stops].sort((a, b) => b.priority_score - a.priority_score);
        const walkOrder = nearestNeighbourTSP(
          sortedByPriority.map(s => ({ lat: s.lat, lng: s.lng })),
          sortedByPriority[0].lat,
          sortedByPriority[0].lng,
        );
        let orderedStops = walkOrder.map(i => sortedByPriority[i]);
        if (algo === 'dbscan_2opt') orderedStops = twoOpt(orderedStops);
        const numberedStops = orderedStops.map(s => ({
          ...s,
          cluster_id: cluster.id,
          stop_order: stopOrder++,
        }));
        stopSequence.push(...numberedStops);
        return { ...cluster, stops: numberedStops };
      });

      const assignmentId = randomUUID();
      const viewToken = randomToken();
      const totalDriveKm = orderedClusters.reduce((acc, c, i) => {
        if (i === 0) return acc + haversineKm(ag.start.lat, ag.start.lng, c.center.lat, c.center.lng);
        return acc + haversineKm(orderedClusters[i - 1].center.lat, orderedClusters[i - 1].center.lng, c.center.lat, c.center.lng);
      }, 0);
      const totalWalkMi = orderedClusters.reduce((acc, c) => acc + walkMilesInCluster(c.stops), 0);
      const totalMiles = totalDriveKm * 0.621371 + totalWalkMi;
      const estHours = parseFloat((totalMiles / 3 + stopSequence.length * 0.05).toFixed(1));

      routes.push({
        agent_id: ag.agent.id,
        agent_name: ag.agent.name,
        assignment_id: assignmentId,
        clusters: resultClusters,
        stop_sequence: stopSequence,
        total_stops: stopSequence.length,
        total_miles: parseFloat(totalMiles.toFixed(2)),
        est_hours: estHours,
        google_maps_urls: buildGoogleMapsUrls(stopSequence),
        view_token: viewToken,
      });

      try {
        await supabase.from('route_assignments').insert({
          id: assignmentId,
          plan_id,
          agent_id: ag.agent.id,
          agent_name: ag.agent.name,
          cluster_sequence: resultClusters.map(c => c.id),
          stop_sequence: stopSequence,
          total_stops: stopSequence.length,
          total_miles: totalMiles,
          est_hours: estHours,
          google_maps_urls: buildGoogleMapsUrls(stopSequence),
          view_token: viewToken,
        });
      } catch {
        // non-fatal
      }
    }

    const stats = {
      total_input: addresses.length,
      assigned: routes.reduce((s, r) => s + r.total_stops, 0),
      excluded: excluded.length,
      unassigned: unassigned.length,
    };

    return new Response(JSON.stringify({ routes, unassigned, excluded, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
