import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { supabase } from '../lib/supabase';
import ConstraintPanel, { DEFAULT_CONSTRAINTS } from '../components/ConstraintPanel';
import RouteListView from '../components/RouteListView';
import FilterBar from '../components/FilterBar';
import SwapRoutesModal from '../components/SwapRoutesModal';
import UnassignedPanel from '../components/UnassignedPanel';
import { exportAllCSV, buildGoogleMapsUrls } from '../utils/routeExport';

// Lazy-load map to avoid SSR/bundle issues with Leaflet
const RouteMap = lazy(() => import('../components/RouteMap'));

// ── CSV column normalisation ──────────────────────────────────────────────────

const REQUIRED_COLS = ['address', 'city', 'state', 'zip', 'address_type'];

/** Accept multiple header spellings, return canonical key or null */
function normaliseHeader(h) {
  const s = h.trim().toLowerCase().replace(/[\s_-]+/g, '_');
  if (['address'].includes(s)) return 'address';
  if (['city'].includes(s)) return 'city';
  if (['state'].includes(s)) return 'state';
  if (['zip', 'zipcode', 'zip_code', 'postal_code', 'postal'].includes(s)) return 'zip';
  if (['address_type', 'addresstype', 'type', 'lead_type', 'leadtype'].includes(s)) return 'address_type';
  if (['lat', 'latitude'].includes(s)) return 'lat';
  if (['lng', 'lon', 'long', 'longitude'].includes(s)) return 'lng';
  if (['unique_id', 'id', 'address_id', 'addressid', 'uid'].includes(s)) return 'unique_id';
  return null;
}

function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => normaliseHeader(h) ?? h.trim().toLowerCase(),
      complete: result => resolve(result),
      error: reject,
    });
  });
}

function validateRows(rawRows) {
  const errors = [];
  const rows = rawRows.map((row, i) => {
    const rowNum = i + 2; // 1-based + header row
    const r = { ...row };

    // Unique ID — generate if absent
    if (!r.unique_id || r.unique_id.trim() === '') {
      r.unique_id = crypto.randomUUID();
    }

    // Required fields
    for (const col of REQUIRED_COLS) {
      if (!r[col] || r[col].trim() === '') {
        errors.push(`Row ${rowNum}: missing required field "${col}"`);
      }
    }

    // ZIP validation
    if (r.zip && !/^\d{5}$/.test(r.zip.trim())) {
      errors.push(`Row ${rowNum}: invalid ZIP "${r.zip}" — must be 5 digits`);
    }

    // Lat/lng validation — if present, must be valid numerics
    const hasLat = r.lat !== undefined && r.lat !== '';
    const hasLng = r.lng !== undefined && r.lng !== '';
    if (hasLat || hasLng) {
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lng);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        errors.push(`Row ${rowNum}: invalid lat "${r.lat}"`);
        r.lat = undefined;
        r.lng = undefined;
      } else if (isNaN(lng) || lng < -180 || lng > 180) {
        errors.push(`Row ${rowNum}: invalid lng "${r.lng}"`);
        r.lat = undefined;
        r.lng = undefined;
      } else {
        r.lat = lat;
        r.lng = lng;
      }
    } else {
      r.lat = undefined;
      r.lng = undefined;
    }

    return r;
  });
  return { rows, errors };
}

// ── Small stat card used in results summary ───────────────────────────────────

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-white/10 rounded-xl px-5 py-3 text-center">
      <div className={`text-2xl font-extrabold ${accent ? 'text-np-accent' : 'text-white'}`}>{value}</div>
      <div className="text-white/60 text-xs mt-0.5">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RoutePlanner({ portalSession, portalClient } = {}) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const client = portalClient ?? supabase;

  const [planDate, setPlanDate] = useState(today);
  const [csvData, setCsvData] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [agents, setAgents] = useState([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState(new Set());
  const [constraints, setConstraints] = useState(DEFAULT_CONSTRAINTS);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [addrPoolMsg, setAddrPoolMsg] = useState(''); // persists in results view
  const [activeTab, setActiveTab] = useState('map'); // map | list
  const [colourMode, setColourMode] = useState('agent'); // agent | type (WI #31)

  // ── Filter state (initialised when result arrives) ───────────────────────────
  const [filterAgentIds, setFilterAgentIds] = useState(null);
  const [filterTypes, setFilterTypes] = useState(null);

  // ── Swap / undo / republish state ────────────────────────────────────────────
  const [pendingChanges, setPendingChanges] = useState(0);
  const [undoStack, setUndoStack] = useState([]); // up to 10 previous result states
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [isRepublishing, setIsRepublishing] = useState(false);

  // ── Unassigned panel state ────────────────────────────────────────────────────
  const [showUnassignedPanel, setShowUnassignedPanel] = useState(false);
  const [selectedUnassigned, setSelectedUnassigned] = useState(null); // stop object or null

  const fileRef = useRef();

  // Load agents from DB on mount
  useEffect(() => {
    client
      .from('agents')
      .select('id, name, email, start_address, start_lat, start_lng')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        if (data) {
          setAgents(data);
          setSelectedAgentIds(new Set(data.map(a => a.id)));
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Selected agents that received no route from the optimizer ────────────────
  const agentlessAgents = useMemo(() => {
    if (!result) return [];
    const routeAgentIds = new Set(result.routes.map(r => r.agent_id));
    return agents.filter(a => selectedAgentIds.has(a.id) && !routeAgentIds.has(a.id));
  }, [result, agents, selectedAgentIds]);

  // ── All unique address types in the current result ────────────────────────────
  const allResultTypes = useMemo(() => {
    const types = new Set();
    if (!result) return types;
    result.routes.forEach(r =>
      r.stop_sequence?.forEach(s => { if (s.address_type) types.add(s.address_type); })
    );
    result.unassigned?.forEach(s => { if (s.address_type) types.add(s.address_type); });
    return types;
  }, [result]);

  // Initialise (or reset) filters whenever a new result arrives
  useEffect(() => {
    if (!result) { setFilterAgentIds(null); setFilterTypes(null); return; }
    setFilterAgentIds(new Set(result.routes.map(r => r.agent_id)));
    const types = new Set();
    result.routes.forEach(r =>
      r.stop_sequence?.forEach(s => { if (s.address_type) types.add(s.address_type); })
    );
    result.unassigned?.forEach(s => { if (s.address_type) types.add(s.address_type); });
    setFilterTypes(types);
  }, [result]);

  // Derived filtered result — passed to map + list views
  const filteredResult = useMemo(() => {
    if (!result || !filterAgentIds || !filterTypes) return result;
    return {
      ...result,
      routes: result.routes
        .filter(r => filterAgentIds.has(r.agent_id))
        .map(r => ({
          ...r,
          clusters: (r.clusters ?? [])
            .map(c => ({ ...c, stops: (c.stops ?? []).filter(s => filterTypes.has(s.address_type)) }))
            .filter(c => c.stops.length > 0),
          stop_sequence: r.stop_sequence?.filter(s => filterTypes.has(s.address_type)) ?? [],
        })),
      unassigned: result.unassigned?.filter(s => filterTypes.has(s.address_type)) ?? [],
    };
  }, [result, filterAgentIds, filterTypes]);

  const handleClearFilters = useCallback(() => {
    if (!result) return;
    setFilterAgentIds(new Set(result.routes.map(r => r.agent_id)));
    setFilterTypes(new Set(allResultTypes));
  }, [result, allResultTypes]);

  // ── CSV upload ──────────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setCsvFileName(file.name);
    setCsvData([]);
    setCsvErrors([]);
    try {
      const parsed = await parseCSV(file);
      const headers = parsed.meta.fields ?? [];
      const missing = REQUIRED_COLS.filter(c => !headers.includes(c));
      if (missing.length > 0) {
        setCsvErrors([`Missing required columns: ${missing.join(', ')}`]);
        return;
      }
      const { rows, errors } = validateRows(parsed.data);
      setCsvData(rows);
      setCsvErrors(errors);
    } catch (e) {
      setCsvErrors([`Failed to parse CSV: ${e.message}`]);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Agent toggle ────────────────────────────────────────────────────────────

  const toggleAgent = (id) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Generate routes ─────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (csvData.length === 0) return;
    const activeAgents = agents.filter(a => selectedAgentIds.has(a.id));
    if (activeAgents.length === 0) { setErrorMsg('Select at least one agent.'); return; }

    setStatus('loading');
    setErrorMsg('');
    setResult(null);

    const geocodeNeeded = csvData.filter(r => r.lat == null).length;
    if (geocodeNeeded > 0) {
      setProgress(
        `Geocoding ${geocodeNeeded.toLocaleString()} new address${geocodeNeeded > 1 ? 'es' : ''} via Nominatim — this may take a few minutes the first time…`,
      );
    }

    try {
      // Create plan record in DB
      const { data: plan, error: planErr } = await client
        .from('route_plans')
        .insert({
          plan_date: planDate,
          constraints,
          total_agents: activeAgents.length,
          status: 'draft',
          created_by: 'admin',
          branch_id: portalSession?.branchId ?? null,
        })
        .select('id')
        .single();

      if (planErr) throw new Error(`Could not create plan: ${planErr.message}`);

      const payload = {
        addresses: csvData,
        agents: activeAgents.map(a => ({
          id: a.id,
          name: a.name,
          start_address: a.start_address,
          start_lat: a.start_lat ? Number(a.start_lat) : undefined,
          start_lng: a.start_lng ? Number(a.start_lng) : undefined,
        })),
        constraints,
        plan_id: plan.id,
      };

      const { data, error: fnError } = await client.functions.invoke('route-optimize', {
        body: payload,
      });

      if (fnError) throw new Error(fnError.message ?? 'Edge function error');

      // Stay in 'loading' state while we write route_addresses so any errors remain visible
      if (data.addrSaveError) {
        setProgress(`⚠️ Edge fn addr save error: ${data.addrSaveError} — retrying from client…`);
      } else {
        setProgress('Saving address pool…');
      }

      // Update plan totals
      await client.from('route_plans').update({
        total_stops: data.stats.assigned,
        unassigned_ct: data.stats.unassigned,
        status: 'active',
      }).eq('id', plan.id);

      // Populate route_addresses so the manager portal can see the full address pool
      {
        const addressRows = [];
        for (const route of data.routes ?? []) {
          for (const stop of route.stop_sequence ?? []) {
            addressRows.push({ id: crypto.randomUUID(), plan_id: plan.id, address: stop.address, city: stop.city ?? '', state: stop.state ?? '', zip: stop.zip ?? '', address_type: stop.address_type ?? 'homeowner', lat: stop.lat, lng: stop.lng, status: 'assigned' });
          }
        }
        for (const stop of data.unassigned ?? []) {
          addressRows.push({ id: crypto.randomUUID(), plan_id: plan.id, address: stop.address, city: stop.city ?? '', state: stop.state ?? '', zip: stop.zip ?? '', address_type: stop.address_type ?? 'homeowner', lat: stop.lat ?? 0, lng: stop.lng ?? 0, status: 'unassigned' });
        }
        for (const stop of data.excluded ?? []) {
          addressRows.push({ id: crypto.randomUUID(), plan_id: plan.id, address: stop.address, city: stop.city ?? '', state: stop.state ?? '', zip: stop.zip ?? '', address_type: stop.address_type ?? 'homeowner', lat: stop.lat ?? 0, lng: stop.lng ?? 0, status: 'excluded' });
        }
        const { error: delErr } = await client.from('route_addresses').delete().eq('plan_id', plan.id);
        if (delErr) {
          setProgress(`⚠️ Address pool delete failed — ${delErr.message}`);
          setAddrPoolMsg(`⚠️ Address pool delete failed — ${delErr.message}`);
        } else {
          let insertErr = null;
          for (let i = 0; i < addressRows.length; i += 500) {
            const { error: e } = await client.from('route_addresses').insert(addressRows.slice(i, i + 500));
            if (e) { insertErr = e; break; }
          }
          if (insertErr) {
            setProgress(`⚠️ Address pool insert failed — ${insertErr.message}`);
            setAddrPoolMsg(`⚠️ Address pool insert failed — ${insertErr.message}`);
          } else {
            setAddrPoolMsg(`✓ ${addressRows.length} addresses saved to pool (${data.routes?.reduce((s,r)=>s+(r.total_stops??0),0)??0} assigned, ${data.unassigned?.length??0} unassigned)`);
          }
        }
      }

      setResult(data);
      setStatus('done');
      setProgress('');
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (e) {
      let msg = e.message ?? 'Unknown error';
      if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('fetch')) {
        msg =
          'Network error: could not reach the route-optimize edge function. ' +
          'Make sure the function is deployed in Supabase (Dashboard → Edge Functions → route-optimize) ' +
          'and that your browser is online.';
      }
      setStatus('idle');
      setErrorMsg(msg);
      setProgress('');
    }
  };

  // ── Swap routes ─────────────────────────────────────────────────────────────

  const handleSwap = useCallback((agentIdA, agentIdB) => {
    setResult(prev => {
      if (!prev) return prev;
      const routes = [...prev.routes];
      const idxA = routes.findIndex(r => r.agent_id === agentIdA);
      const idxB = routes.findIndex(r => r.agent_id === agentIdB);
      if (idxA === -1 || idxB === -1) return prev;
      const a = routes[idxA];
      const b = routes[idxB];
      routes[idxA] = {
        ...a,
        clusters: b.clusters,
        stop_sequence: b.stop_sequence,
        total_stops: b.total_stops,
        total_miles: b.total_miles,
        est_hours: b.est_hours,
        google_maps_urls: b.google_maps_urls,
      };
      routes[idxB] = {
        ...b,
        clusters: a.clusters,
        stop_sequence: a.stop_sequence,
        total_stops: a.total_stops,
        total_miles: a.total_miles,
        est_hours: a.est_hours,
        google_maps_urls: a.google_maps_urls,
      };
      // Push current state onto undo stack (max 10 entries)
      setUndoStack(stack => [...stack.slice(-9), prev]);
      setPendingChanges(n => n + 1);
      return { ...prev, routes };
    });
    setShowSwapModal(false);
  }, []);

  // ── Assign an unassigned stop to an agent ────────────────────────────────────

  const handleAssignStop = useCallback((stop, agentId) => {
    setResult(prev => {
      if (!prev) return prev;
      const newUnassigned = prev.unassigned.filter(s => s.unique_id !== stop.unique_id);

      let routes;
      if (prev.routes.some(r => r.agent_id === agentId)) {
        // Add stop to an existing agent route
        routes = prev.routes.map(r => {
          if (r.agent_id !== agentId) return r;

          let nearestIdx = 0, minD = Infinity;
          (r.clusters ?? []).forEach((c, i) => {
            const d = Math.abs(c.center.lat - (stop.lat ?? 0)) + Math.abs(c.center.lng - (stop.lng ?? 0));
            if (d < minD) { minD = d; nearestIdx = i; }
          });

          const newStop = { ...stop, stop_order: (r.total_stops ?? 0) + 1 };
          const newClusters = r.clusters?.length
            ? r.clusters.map((c, i) =>
                i === nearestIdx
                  ? { ...c, stops: [...c.stops, newStop], size: (c.size ?? c.stops.length) + 1 }
                  : c)
            : [{ id: 'manual', center: { lat: stop.lat ?? 0, lng: stop.lng ?? 0 }, size: 1, stops: [newStop] }];

          return {
            ...r,
            clusters: newClusters,
            stop_sequence: [...(r.stop_sequence ?? []), newStop],
            total_stops: (r.total_stops ?? 0) + 1,
          };
        });
      } else {
        // Agent has no route yet — create one from scratch
        const agentInfo = agents.find(a => a.id === agentId);
        const newStop = { ...stop, stop_order: 1 };
        const newRoute = {
          agent_id: agentId,
          agent_name: agentInfo?.name ?? agentId,
          assignment_id: null, // not persisted until Republish
          clusters: [{ id: 'manual-1', center: { lat: stop.lat ?? 0, lng: stop.lng ?? 0 }, size: 1, stops: [newStop] }],
          stop_sequence: [newStop],
          total_stops: 1,
          total_miles: 0,
          est_hours: 0,
          google_maps_urls: [],
          view_token: null,
        };
        routes = [...prev.routes, newRoute];
      }

      setUndoStack(stack => [...stack.slice(-9), prev]);
      setPendingChanges(n => n + 1);
      return { ...prev, routes, unassigned: newUnassigned };
    });
    setSelectedUnassigned(null);
  }, [agents]);

  // ── Undo ─────────────────────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    setUndoStack(stack => {
      if (stack.length === 0) return stack;
      setResult(stack[stack.length - 1]);
      setPendingChanges(n => Math.max(0, n - 1));
      return stack.slice(0, -1);
    });
  }, []);

  // Keyboard shortcut Ctrl+Z / Cmd+Z
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo]);

  // ── Republish ────────────────────────────────────────────────────────────────

  const handleRepublish = useCallback(async () => {
    if (!result || pendingChanges === 0 || isRepublishing) return;
    setIsRepublishing(true);
    try {
      const updatedRoutes = await Promise.all(
        result.routes.map(async (route) => {
          const newUrls = buildGoogleMapsUrls(route.stop_sequence ?? []);
          // Manually-created routes (agentless agents) have no DB record yet — skip
          if (!route.assignment_id) return { ...route, google_maps_urls: newUrls };
          const { data: upRows, error } = await client
            .from('route_assignments')
            .update({
              stop_sequence: route.stop_sequence,
              cluster_sequence: route.clusters?.map(c => c.id) ?? [],
              total_stops: route.total_stops,
              total_miles: route.total_miles,
              est_hours: route.est_hours,
              google_maps_urls: newUrls,
            })
            .eq('id', route.assignment_id)
            .select('id');
          if (error) throw new Error(`Failed to update ${route.agent_name}: ${error.message}`);
          if (!upRows?.length) throw new Error(`Update blocked for ${route.agent_name} — check RLS policy or session permissions`);
          return { ...route, google_maps_urls: newUrls };
        }),
      );
      setResult(prev => ({ ...prev, routes: updatedRoutes }));
      setPendingChanges(0);
      setUndoStack([]);
    } catch (e) {
      setErrorMsg(e.message ?? 'Republish failed');
    } finally {
      setIsRepublishing(false);
    }
  }, [result, pendingChanges, isRepublishing]);

  // ── Section wrapper ─────────────────────────────────────────────────────────

  const Section = ({ title, hint, children }) => (
    <div className="bg-white rounded-2xl border border-np-border shadow-np p-6">
      <div className="mb-4">
        <h2 className="text-base font-bold text-np-dark">{title}</h2>
        {hint && <p className="text-np-muted text-sm mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-np-surface">

      {/* ── Page header ── */}
      <div className="bg-np-dark text-white px-[5%] py-8">
        <div className="max-w-7xl mx-auto flex items-start justify-between flex-wrap gap-4">
          <div>
            {!portalSession && (
              <div className="text-xs tracking-[2px] uppercase text-np-lite/60 mb-1">Admin Tool</div>
            )}
            <h1 className="text-3xl font-extrabold">Route Planner</h1>
            <p className="text-white/60 mt-1.5 text-sm max-w-lg">
              Generate optimised field sales routes — upload addresses, select agents, and let the system cluster and sequence stops automatically.
            </p>
          </div>
          {!portalSession && (
            <Link
              to="/admin"
              className="text-np-lite text-sm font-semibold hover:text-white border border-np-lite/30 px-4 py-2 rounded-xl transition-colors self-start"
            >
              ← Back to Dashboard
            </Link>
          )}
        </div>
      </div>

      {/* ── Step 1: Upload & Configure ── */}
      {status !== 'done' && (
        <div className="px-[5%] max-w-7xl mx-auto py-8 space-y-6">

          {/* Date + CSV row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Route date */}
            <Section title="Route date">
              <input
                type="date"
                value={planDate}
                onChange={e => setPlanDate(e.target.value)}
                className="w-full border border-np-border rounded-xl px-4 py-2.5 text-np-text text-sm focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent transition-all"
              />
            </Section>

            {/* CSV upload */}
            <div className="lg:col-span-2">
              <Section
                title="Address list (CSV)"
                hint="Required columns: address, city, state, zip, address_type"
              >
                <div
                  className={`rounded-xl border-2 border-dashed transition-all cursor-pointer px-6 py-8 text-center
                    ${csvFileName
                      ? 'border-np-accent bg-np-accent/5'
                      : 'border-np-border hover:border-np-accent/60 hover:bg-np-surface/60'}`}
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    style={{ display: 'none' }}
                    onChange={e => handleFile(e.target.files[0])}
                  />
                  {csvFileName ? (
                    <>
                      <div className="w-10 h-10 bg-np-accent/15 rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-5 h-5 text-np-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <p className="font-semibold text-np-dark">{csvFileName}</p>
                      {csvData.length > 0 && (
                        <p className="text-np-muted text-sm mt-1">
                          {csvData.length.toLocaleString()} addresses parsed
                          {csvErrors.length > 0 && ` · ${csvErrors.length} warning${csvErrors.length > 1 ? 's' : ''}`}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="w-10 h-10 bg-np-surface rounded-full flex items-center justify-center mx-auto mb-3 border border-np-border">
                        <svg className="w-5 h-5 text-np-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                      </div>
                      <p className="font-semibold text-np-text">Drop CSV here or click to upload</p>
                      <p className="text-np-muted text-xs mt-1">Optional columns: lat, lng, unique_id</p>
                    </>
                  )}
                </div>

                {/* Parse errors */}
                {csvErrors.length > 0 && (
                  <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <p className="text-red-700 font-semibold text-sm mb-2">
                      {csvErrors.length} parse warning{csvErrors.length > 1 ? 's' : ''}
                    </p>
                    <ul className="space-y-1">
                      {csvErrors.slice(0, 8).map((e, i) => (
                        <li key={i} className="text-red-600 text-xs font-mono">{e}</li>
                      ))}
                      {csvErrors.length > 8 && (
                        <li className="text-red-400 text-xs">…and {csvErrors.length - 8} more</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Preview table */}
                {csvData.length > 0 && (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-np-border">
                    <table className="w-full text-xs">
                      <thead className="bg-np-surface text-np-muted uppercase tracking-wide">
                        <tr>
                          {['unique_id', 'address', 'city', 'state', 'zip', 'address_type', 'lat', 'lng'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-np-border/50">
                        {csvData.slice(0, 8).map((row, i) => (
                          <tr key={i} className="hover:bg-np-surface/40">
                            {['unique_id', 'address', 'city', 'state', 'zip', 'address_type', 'lat', 'lng'].map(h => (
                              <td key={h} className="px-3 py-2 text-np-text truncate max-w-[160px]">
                                {row[h] != null ? String(row[h]) : <span className="text-np-border">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {csvData.length > 8 && (
                      <div className="px-4 py-2 bg-np-surface text-np-muted text-xs border-t border-np-border">
                        …and {(csvData.length - 8).toLocaleString()} more rows
                      </div>
                    )}
                  </div>
                )}
              </Section>
            </div>
          </div>

          {/* Agents */}
          <Section title="Agents working today" hint="Select all agents who will be in the field on this date">
            {agents.length === 0 ? (
              <div className="bg-np-surface rounded-xl border border-np-border px-6 py-8 text-center text-np-muted text-sm">
                No active agents found.{' '}
                <span className="font-mono text-xs">Add rows to the <code>agents</code> table in Supabase.</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {agents.map(agent => {
                  const selected = selectedAgentIds.has(agent.id);
                  return (
                    <label
                      key={agent.id}
                      className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all select-none
                        ${selected
                          ? 'border-np-accent bg-np-accent/8 shadow-np'
                          : 'border-np-border bg-white hover:border-np-accent/40'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAgent(agent.id)}
                        className="sr-only"
                      />
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base font-bold
                        ${selected ? 'bg-np-accent text-np-dark' : 'bg-np-surface text-np-muted'}`}>
                        {agent.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold text-np-text text-center leading-tight">{agent.name}</span>
                      {selected && (
                        <span className="absolute top-2 right-2 w-4 h-4 bg-np-accent rounded-full flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-np-dark" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Constraints */}
          <Section title="Route constraints" hint="Configure per-agent limits, ZIP exclusions, and address priority">
            <ConstraintPanel constraints={constraints} onChange={setConstraints} />
          </Section>

          {/* Error banner */}
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-4" role="alert">
              <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-red-800 text-sm">Generation failed</p>
                <p className="text-red-700 text-sm mt-1 leading-relaxed">{errorMsg}</p>
              </div>
              <button
                type="button"
                className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors text-lg leading-none"
                onClick={() => setErrorMsg('')}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          {/* Generate button */}
          <div className="flex flex-col items-start gap-4 pb-8">
            <button
              type="button"
              className={`px-8 py-3.5 rounded-2xl font-bold text-base transition-all
                ${status === 'loading' || csvData.length === 0
                  ? 'bg-np-muted/30 text-np-muted cursor-not-allowed'
                  : 'bg-np-accent text-np-dark hover:brightness-110 shadow-np-lg'}`}
              onClick={handleGenerate}
              disabled={status === 'loading' || csvData.length === 0}
            >
              {status === 'loading' ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating routes…
                </span>
              ) : (
                `Generate Routes →`
              )}
            </button>
            {status === 'loading' && progress && (
              <p className="text-np-muted text-sm max-w-lg">{progress}</p>
            )}
            {csvData.length === 0 && (
              <p className="text-np-muted text-sm">Upload a CSV file to enable route generation.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Results ── */}
      {status === 'done' && result && (
        <div>
          {/* Results summary strip */}
          <div className="bg-np-mid text-white px-[5%] py-6">
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-lg font-bold text-white">Routes Generated</h2>
                <span className="text-white/40">·</span>
                <span className="text-white/70 text-sm">{planDate}</span>
                <div className="ml-auto">
                  <button
                    type="button"
                    className="text-np-lite text-sm font-semibold hover:text-white border border-np-lite/30 px-4 py-1.5 rounded-xl transition-colors"
                    onClick={() => { setStatus('idle'); setResult(null); setPendingChanges(0); setUndoStack([]); setShowUnassignedPanel(false); setSelectedUnassigned(null); setAddrPoolMsg(''); }}
                  >
                    ← Start Over
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Agents" value={result.routes.length} />
                <StatCard label="Stops Assigned" value={result.routes.reduce((s, r) => s + (r.total_stops ?? 0), 0).toLocaleString()} accent />
                <StatCard label="Unassigned" value={(result.unassigned?.length ?? result.stats.unassigned).toLocaleString()} />
                {result.stats.excluded > 0
                  ? <StatCard label="Excluded (ZIP)" value={result.stats.excluded.toLocaleString()} />
                  : <StatCard label="Total Input" value={result.stats.total_input?.toLocaleString() ?? '—'} />
                }
              </div>
            </div>
          </div>

          {/* Tab bar + content */}
          <div className="px-[5%] max-w-7xl mx-auto py-6">

            {/* Address pool status — persistent after loading */}
            {addrPoolMsg && (
              <div className={`mb-4 px-4 py-2 rounded-xl text-sm font-medium ${addrPoolMsg.startsWith('⚠️') ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
                {addrPoolMsg}
              </div>
            )}

            {/* Filter bar */}
            {filterAgentIds && filterTypes && (
              <FilterBar
                result={result}
                allTypes={allResultTypes}
                filterAgentIds={filterAgentIds}
                filterTypes={filterTypes}
                onAgentChange={setFilterAgentIds}
                onTypeChange={setFilterTypes}
                onClear={handleClearFilters}
              />
            )}

            <div className="flex items-center gap-4 mb-6">
              <div className="flex gap-1 bg-white rounded-xl border border-np-border p-1">
                {[
                  { key: 'map', label: 'Map View' },
                  { key: 'list', label: 'List View' },
                ].map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setActiveTab(t.key)}
                    className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                      activeTab === t.key
                        ? 'bg-np-dark text-white'
                        : 'text-np-muted hover:text-np-dark'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Colour-by toggle — only shown in Map View (WI #31) */}
              {activeTab === 'map' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-np-muted font-medium whitespace-nowrap">Colour by:</span>
                  <div className="flex gap-0.5 bg-white rounded-lg border border-np-border p-0.5">
                    {[
                      { key: 'agent', label: 'Agent' },
                      { key: 'type',  label: 'Address Type' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setColourMode(opt.key)}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                          colourMode === opt.key
                            ? 'bg-np-dark text-white shadow-sm'
                            : 'text-np-muted hover:text-np-dark'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="ml-auto flex items-center gap-3 flex-wrap">
                {/* Pending changes badge */}
                {pendingChanges > 0 && (
                  <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    Pending changes ({pendingChanges})
                  </span>
                )}

                {/* Republish */}
                {pendingChanges > 0 && (
                  <button
                    type="button"
                    disabled={isRepublishing}
                    className={`inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${
                      isRepublishing
                        ? 'bg-np-muted/20 text-np-muted cursor-not-allowed'
                        : 'bg-np-dark text-white hover:bg-np-mid shadow-np'
                    }`}
                    onClick={handleRepublish}
                  >
                    {isRepublishing ? (
                      <>
                        <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Republishing…
                      </>
                    ) : (
                      'Republish'
                    )}
                  </button>
                )}

                {/* Unassigned panel toggle — only in Map View when there are unassigned stops */}
                {activeTab === 'map' && result.unassigned?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowUnassignedPanel(v => !v);
                      setShowSwapModal(false);
                    }}
                    className={`inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-all border ${
                      showUnassignedPanel
                        ? 'bg-red-600 text-white border-red-600'
                        : 'border-red-200 text-red-700 bg-red-50 hover:bg-red-100'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${showUnassignedPanel ? 'bg-red-200' : 'bg-red-400 animate-pulse'}`} />
                    {result.unassigned.length} Unassigned
                  </button>
                )}

                {/* Swap Routes */}
                {result.routes.length >= 2 && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 border border-np-border text-np-text text-sm font-semibold px-4 py-2 rounded-xl hover:border-np-dark hover:text-np-dark transition-colors bg-white"
                    onClick={() => { setShowSwapModal(true); setShowUnassignedPanel(false); }}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                    Swap Routes
                  </button>
                )}

                {/* Export All CSV */}
                <button
                  type="button"
                  className="inline-flex items-center gap-2 border border-np-border text-np-text text-sm font-semibold px-4 py-2 rounded-xl hover:border-np-dark hover:text-np-dark transition-colors bg-white"
                  onClick={() => exportAllCSV(result.routes, result.unassigned, planDate)}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export All CSV
                </button>
              </div>
            </div>

            {activeTab === 'map' && (
              <div className="flex gap-4 items-start">
                <Suspense fallback={
                  <div className="flex-1 bg-white rounded-2xl border border-np-border flex items-center justify-center h-[500px] text-np-muted">
                    Loading map…
                  </div>
                }>
                  <div className="flex-1 min-w-0 rounded-2xl overflow-hidden border border-np-border shadow-np">
                    <RouteMap
                      routes={filteredResult.routes}
                      unassigned={filteredResult.unassigned}
                      colourMode={colourMode}
                      selectedUnassignedId={selectedUnassigned?.unique_id ?? null}
                      onUnassignedClick={(stop) => {
                        setSelectedUnassigned(stop);
                        setShowUnassignedPanel(true);
                        setShowSwapModal(false);
                      }}
                      onUnassignedDrop={handleAssignStop}
                    />
                  </div>
                </Suspense>

                {/* Swap panel — inline, avoids Leaflet z-index conflicts */}
                {showSwapModal && result && (
                  <SwapRoutesModal
                    routes={result.routes}
                    onConfirm={handleSwap}
                    onClose={() => setShowSwapModal(false)}
                  />
                )}

                {/* Unassigned panel — inline side panel */}
                {showUnassignedPanel && result && (
                  <UnassignedPanel
                    stops={result.unassigned ?? []}
                    routes={result.routes}
                    agentlessAgents={agentlessAgents}
                    maxStops={constraints.max_stops}
                    selectedId={selectedUnassigned?.unique_id ?? null}
                    onSelect={setSelectedUnassigned}
                    onAssign={handleAssignStop}
                    onClose={() => { setShowUnassignedPanel(false); setSelectedUnassigned(null); }}
                  />
                )}
              </div>
            )}

            {activeTab === 'list' && (
              <RouteListView result={filteredResult} planDate={planDate} />
            )}
          </div>
        </div>
      )}

    </div>
  );
}
