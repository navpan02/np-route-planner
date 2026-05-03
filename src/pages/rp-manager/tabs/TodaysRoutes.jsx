import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { supabase } from '../../../lib/supabase';
import { exportAgentCSV, exportAllCSV, buildGoogleMapsUrls } from '../../../utils/routeExport';
import FilterBar from '../../../components/FilterBar';
import SwapRoutesModal from '../../../components/SwapRoutesModal';
import UnassignedPanel from '../../../components/UnassignedPanel';

function buildClusters(stops) {
  const map = new Map();
  for (const stop of stops) {
    const cid = stop.cluster_id ?? 'C0';
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(stop);
  }
  return Array.from(map.entries()).map(([id, clStops]) => {
    const lat = clStops.reduce((s, p) => s + (p.lat ?? 0), 0) / clStops.length;
    const lng = clStops.reduce((s, p) => s + (p.lng ?? 0), 0) / clStops.length;
    return { id, center: { lat, lng }, size: clStops.length, stops: clStops };
  });
}

const RouteMap      = lazy(() => import('../../../components/RouteMap'));
const RouteListView = lazy(() => import('../../../components/RouteListView'));

export default function TodaysRoutes({ session }) {
  const client = session?.portalClient ?? supabase;
  const localToday = new Date().toLocaleDateString('en-CA');

  // ── Data state ────────────────────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState('');
  const [plan, setPlan]       = useState(null);
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Pending-save tracking ─────────────────────────────────────────────────────
  const [pendingChanges, setPendingChanges] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  // Maps kept in refs so setResult callbacks can mutate without stale closures
  const modifiedRoutesRef = useRef(new Map()); // assignment_id → latest route obj
  const assignedStopsRef  = useRef(new Map()); // stop.id → assignment_id

  // ── View / filter state ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab]           = useState('map');
  const [colourMode, setColourMode]         = useState('agent');
  const [filterAgentIds, setFilterAgentIds] = useState(null);
  const [filterTypes, setFilterTypes]       = useState(null);

  // ── Unassigned / swap state ───────────────────────────────────────────────────
  const [showUnassignedPanel, setShowUnassignedPanel] = useState(false);
  const [selectedUnassigned, setSelectedUnassigned]   = useState(null);
  const [showSwapModal, setShowSwapModal] = useState(false);

  useEffect(() => { loadPlan(selectedDate); }, [selectedDate]);

  const loadPlan = async (date) => {
    setLoading(true);
    setLoadError('');
    setResult(null);
    setPlan(null);
    setFilterAgentIds(null);
    setFilterTypes(null);
    setShowUnassignedPanel(false);
    setShowSwapModal(false);
    // Reset pending state on reload
    setPendingChanges(0);
    setSaveMsg('');
    modifiedRoutesRef.current.clear();
    assignedStopsRef.current.clear();

    let query = client
      .from('route_plans')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    // Accept org-wide plans (branch_id IS NULL, created by admin) as well as branch-specific ones
    if (session?.branchId) query = query.or(`branch_id.eq.${session.branchId},branch_id.is.null`);
    if (date) query = query.eq('plan_date', date);

    const { data: plans, error: planErr } = await query;
    if (planErr) { setLoadError(`Plan query failed: ${planErr.message}`); setLoading(false); return; }
    if (!plans?.length) { setLoading(false); return; }
    const p = plans[0];
    setPlan(p);

    const [{ data: assignments, error: aErr }, { data: unassignedAddrs, error: uErr }] = await Promise.all([
      client.from('route_assignments').select('*').eq('plan_id', p.id),
      client.from('route_addresses')
        .select('id,address,city,state,zip,address_type,lat,lng')
        .eq('plan_id', p.id).eq('status', 'unassigned').neq('address_type', 'do_not_knock'),
    ]);
    if (aErr) { setLoadError(`Assignments query failed: ${aErr.message}`); setLoading(false); return; }
    if (uErr) { setLoadError(`Addresses query failed: ${uErr.message}`); setLoading(false); return; }

    const unassigned = (unassignedAddrs ?? []).map(a => ({ ...a, unique_id: a.id }));
    const routes = (assignments ?? []).map(a => {
      const stopSeq = a.stop_sequence ?? [];
      return {
        agent_id: a.agent_id, agent_name: a.agent_name, assignment_id: a.id,
        stop_sequence: stopSeq, clusters: buildClusters(stopSeq),
        total_stops: a.total_stops, total_miles: a.total_miles, est_hours: a.est_hours,
        google_maps_urls: a.google_maps_urls ?? [], view_token: a.view_token,
      };
    });

    if (routes.length) {
      const res = {
        routes, unassigned,
        stats: { total_input: p.total_stops + (p.unassigned_ct ?? 0), assigned: p.total_stops, excluded: 0, unassigned: p.unassigned_ct ?? 0 },
      };
      setResult(res);
      setFilterAgentIds(new Set(routes.map(r => r.agent_id)));
      const types = new Set();
      routes.forEach(r => r.stop_sequence?.forEach(s => s.address_type && types.add(s.address_type)));
      unassigned.forEach(s => s.address_type && types.add(s.address_type));
      setFilterTypes(types);
    }
    setLoading(false);
  };

  // ── Derived: all address types ────────────────────────────────────────────────
  const allResultTypes = useMemo(() => {
    const types = new Set();
    if (!result) return types;
    result.routes.forEach(r => r.stop_sequence?.forEach(s => s.address_type && types.add(s.address_type)));
    result.unassigned?.forEach(s => s.address_type && types.add(s.address_type));
    return types;
  }, [result]);

  // ── Derived: filtered result ──────────────────────────────────────────────────
  const filteredResult = useMemo(() => {
    if (!result || !filterAgentIds || !filterTypes) return result;
    return {
      ...result,
      routes: result.routes
        .filter(r => filterAgentIds.has(r.agent_id))
        .map(r => ({
          ...r,
          clusters: r.clusters.map(c => ({ ...c, stops: c.stops.filter(s => filterTypes.has(s.address_type)) })).filter(c => c.stops.length > 0),
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

  // ── Swap routes (local state only — no DB change needed for swaps) ────────────
  const handleSwap = useCallback((agentA, agentB) => {
    setResult(prev => {
      if (!prev) return prev;
      const routes = prev.routes.map(r => {
        if (r.agent_id === agentA.id) return { ...r, agent_id: agentB.id, agent_name: agentB.name };
        if (r.agent_id === agentB.id) return { ...r, agent_id: agentA.id, agent_name: agentA.name };
        return r;
      });
      return { ...prev, routes };
    });
    setShowSwapModal(false);
  }, []);

  // ── Assign unassigned stop → agent, track for save ───────────────────────────
  const handleAssignStop = useCallback((stop, agentId) => {
    setResult(prev => {
      if (!prev) return prev;
      const newUnassigned = prev.unassigned.filter(s => s.unique_id !== stop.unique_id);
      const routes = prev.routes.map(r => {
        if (r.agent_id !== agentId) return r;
        const newStop = { ...stop, stop_order: (r.total_stops ?? 0) + 1 };
        const updatedRoute = {
          ...r,
          stop_sequence: [...(r.stop_sequence ?? []), newStop],
          clusters: r.clusters?.length
            ? [...r.clusters.slice(0, -1), {
                ...r.clusters[r.clusters.length - 1],
                stops: [...r.clusters[r.clusters.length - 1].stops, newStop],
              }]
            : [{ id: 'manual', center: { lat: stop.lat ?? 0, lng: stop.lng ?? 0 }, size: 1, stops: [newStop] }],
          total_stops: (r.total_stops ?? 0) + 1,
        };
        // Track this route as modified and the stop as newly assigned
        if (r.assignment_id) {
          modifiedRoutesRef.current.set(r.assignment_id, updatedRoute);
          assignedStopsRef.current.set(stop.id ?? stop.unique_id, r.assignment_id);
        }
        return updatedRoute;
      });
      return { ...prev, routes, unassigned: newUnassigned };
    });
    setPendingChanges(n => n + 1);
    setSaveMsg('');
    setSelectedUnassigned(null);
  }, []);

  // ── Persist pending assignments to DB ────────────────────────────────────────
  const handleSavePlan = useCallback(async () => {
    if (pendingChanges === 0 || !plan || isSaving) return;
    setIsSaving(true);
    setSaveMsg('');

    try {
      // 1. Update each route_assignment with current stop_sequence from React state
      const routeUpdates = (result?.routes ?? []).filter(r => r.assignment_id);
      if (!routeUpdates.length) {
        setSaveMsg('⚠️ No routes found to save');
        return;
      }
      const urlMap = new Map();
      await Promise.all(routeUpdates.map(async route => {
        const newUrls = buildGoogleMapsUrls(route.stop_sequence ?? []);
        urlMap.set(route.assignment_id, newUrls);
        const { data: upRows, error } = await client
          .from('route_assignments')
          .update({
            stop_sequence: route.stop_sequence,
            total_stops: route.total_stops,
            google_maps_urls: newUrls,
          })
          .eq('id', route.assignment_id)
          .select('id');
        if (error) throw new Error(`Failed to save ${route.agent_name}: ${error.message}`);
        if (!upRows?.length) throw new Error(`Save blocked for ${route.agent_name} — RLS policy rejected the update. Re-login and try again.`);
      }));
      // Update google_maps_urls in local state
      setResult(prev => prev ? {
        ...prev,
        routes: prev.routes.map(r =>
          urlMap.has(r.assignment_id) ? { ...r, google_maps_urls: urlMap.get(r.assignment_id) } : r
        ),
      } : prev);

      // 2. Mark each newly assigned address as 'assigned' in route_addresses
      const stopEntries = Array.from(assignedStopsRef.current.entries());
      if (stopEntries.length > 0) {
        await Promise.all(stopEntries.map(([stopId, assignmentId]) =>
          client
            .from('route_addresses')
            .update({ status: 'assigned', assignment_id: assignmentId })
            .eq('id', stopId)
            .eq('plan_id', plan.id)
        ));
      }

      // 3. Sync plan totals
      const totalStops = routeUpdates.reduce((s, r) => s + (r.total_stops ?? 0), 0);
      await client
        .from('route_plans')
        .update({ total_stops: totalStops, unassigned_ct: result?.unassigned?.length ?? 0 })
        .eq('id', plan.id);

      modifiedRoutesRef.current.clear();
      assignedStopsRef.current.clear();
      setPendingChanges(0);
      setSaveMsg('✓ Saved to today\'s plan');
      setTimeout(() => setSaveMsg(''), 4000);
    } catch (e) {
      setSaveMsg(`⚠️ ${e.message ?? 'Save failed'}`);
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, plan, isSaving, result, client]);

  const planDate = plan?.plan_date ?? localToday;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* Date picker toolbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
        <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Plan date</label>
        <input
          type="date"
          value={selectedDate || localToday}
          max={localToday}
          onChange={e => setSelectedDate(e.target.value === localToday ? '' : e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        {selectedDate && (
          <button onClick={() => setSelectedDate('')} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Show latest
          </button>
        )}
        {plan && <span className="text-xs text-gray-400">Showing plan from {plan.plan_date}</span>}
      </div>

      {loading && <div className="p-8 text-center text-gray-400">Loading routes…</div>}

      {!loading && loadError && (
        <div className="p-8 text-center text-red-500">
          <p className="font-medium mb-1">Error loading routes</p>
          <p className="text-sm font-mono">{loadError}</p>
          <button onClick={() => loadPlan(selectedDate)} className="mt-3 text-sm underline">Retry</button>
        </div>
      )}

      {!loading && !loadError && !result && (
        <div className="p-8 text-center text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium text-gray-600 mb-1">No routes found{selectedDate ? ` for ${selectedDate}` : ''}</p>
          <p className="text-sm">Ask admin to generate today's plan, or use <strong>Add/Edit Route</strong> to build one manually.</p>
        </div>
      )}

      {!loading && !loadError && result && filteredResult && (
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Summary bar */}
          <div className="bg-green-700 text-white px-6 py-2.5 flex flex-wrap items-center gap-4 flex-shrink-0">
            <div className="text-sm"><span className="font-bold text-lg">{result.routes.length}</span> <span className="opacity-75">agents</span></div>
            <div className="text-sm"><span className="font-bold text-lg">{result.routes.reduce((s,r) => s+(r.total_stops??0), 0)}</span> <span className="opacity-75">stops assigned</span></div>
            {(result.unassigned?.length ?? 0) > 0 && (
              <button
                onClick={() => { setShowUnassignedPanel(v => !v); setShowSwapModal(false); }}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${showUnassignedPanel ? 'bg-red-600 border-red-600 text-white' : 'border-red-300 text-red-100 hover:bg-red-600'}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${showUnassignedPanel ? 'bg-red-200' : 'bg-red-300 animate-pulse'}`} />
                {result.unassigned.length} Unassigned
              </button>
            )}

            <div className="ml-auto flex items-center gap-2 flex-wrap">

              {/* ── Save to Today's Plan ── */}
              {pendingChanges > 0 && (
                <button
                  onClick={handleSavePlan}
                  disabled={isSaving}
                  className={`inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg transition-all ${
                    isSaving
                      ? 'bg-white/30 text-white/60 cursor-not-allowed'
                      : 'bg-white text-green-700 hover:bg-green-50 shadow cursor-pointer'
                  }`}
                >
                  {isSaving ? (
                    <>
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Saving…
                    </>
                  ) : (
                    <>💾 Save to Today's Plan ({pendingChanges})</>
                  )}
                </button>
              )}

              {/* Save feedback */}
              {saveMsg && (
                <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
                  saveMsg.startsWith('⚠️')
                    ? 'bg-red-600/80 text-white'
                    : 'bg-white/20 text-white'
                }`}>
                  {saveMsg}
                </span>
              )}

              <button
                onClick={() => { setShowSwapModal(true); setShowUnassignedPanel(false); }}
                className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                ⇅ Swap Routes
              </button>
              <button
                onClick={() => exportAllCSV(result.routes, result.unassigned ?? [], planDate)}
                className="bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                Export All CSV
              </button>
              <div className="flex rounded-lg overflow-hidden border border-white/30">
                <button onClick={() => setActiveTab('map')} className={`text-xs font-semibold px-3 py-1.5 transition-colors ${activeTab === 'map' ? 'bg-white text-green-700' : 'text-white hover:bg-white/20'}`}>Map View</button>
                <button onClick={() => setActiveTab('list')} className={`text-xs font-semibold px-3 py-1.5 transition-colors ${activeTab === 'list' ? 'bg-white text-green-700' : 'text-white hover:bg-white/20'}`}>List View</button>
              </div>
            </div>
          </div>

          {/* Filter bar */}
          {filterAgentIds && filterTypes && (
            <div className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
              <FilterBar
                result={result}
                allTypes={allResultTypes}
                filterAgentIds={filterAgentIds}
                filterTypes={filterTypes}
                onAgentChange={setFilterAgentIds}
                onTypeChange={setFilterTypes}
                onClear={handleClearFilters}
              />
              {activeTab === 'map' && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-gray-500 font-medium">Colour by:</span>
                  <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                    {[{ key: 'agent', label: 'Agent' }, { key: 'type', label: 'Address Type' }].map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setColourMode(opt.key)}
                        className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${colourMode === opt.key ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Main content area */}
          <div className="flex flex-1 overflow-hidden relative">
            <div className="flex-1 overflow-auto">
              <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading…</div>}>
                {activeTab === 'map'
                  ? (
                    <RouteMap
                      result={filteredResult}
                      allRoutes={result.routes}
                      colourMode={colourMode}
                      selectedUnassignedId={selectedUnassigned?.unique_id ?? null}
                      onUnassignedClick={(stop) => { setSelectedUnassigned(stop); setShowUnassignedPanel(true); setShowSwapModal(false); }}
                      onUnassignedDrop={handleAssignStop}
                    />
                  )
                  : <RouteListView result={filteredResult} planDate={planDate} onExportAgent={exportAgentCSV} />
                }
              </Suspense>
            </div>

            {showSwapModal && (
              <SwapRoutesModal
                routes={result.routes}
                onConfirm={handleSwap}
                onClose={() => setShowSwapModal(false)}
              />
            )}

            {showUnassignedPanel && (
              <UnassignedPanel
                stops={result.unassigned ?? []}
                routes={result.routes}
                agentlessAgents={[]}
                selectedId={selectedUnassigned?.unique_id ?? null}
                onSelect={setSelectedUnassigned}
                onAssign={handleAssignStop}
                onClose={() => { setShowUnassignedPanel(false); setSelectedUnassigned(null); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
