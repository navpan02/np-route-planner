import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { supabase } from '../../../lib/supabase';
import { filterPointsInCircle, filterPointsInPolygon } from '../../../utils/geoFilter';
import ConstraintPanel, { DEFAULT_CONSTRAINTS } from '../../../components/ConstraintPanel';
import { exportAgentCSV, buildGoogleMapsUrls } from '../../../utils/routeExport';

const RouteMap = lazy(() => import('../../../components/RouteMap'));

const DNK_TYPE = 'do_not_knock';

function loadAgentConstraints(agentId) {
  try {
    const raw = localStorage.getItem(`agent_constraints_${agentId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Rejects if the promise doesn't settle within ms milliseconds
function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s — check your Supabase connection`)), ms)),
  ]);
}

export default function DrawRouteTab({ session, onRouteSaved }) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const client = session?.portalClient ?? supabase;

  const [addresses, setAddresses]   = useState([]);
  const [addrLoading, setAddrLoading] = useState(true);
  const [agents, setAgents]         = useState([]);
  const [selectedAgent, setAgent] = useState('');
  const [constraints, setConstraints] = useState(DEFAULT_CONSTRAINTS);
  const [showConstraints, setShowCon] = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [result, setResult]           = useState(null);
  const [saveStatus, setSaveStatus]   = useState('idle');
  const [conflict, setConflict]       = useState(null);
  const [error, setError]             = useState('');

  // ── Undo/redo history of selected-address sets ───────────────────────────
  const [history, setHistory]     = useState([[]]); // array of id[] snapshots
  const [historyIdx, setHistoryIdx] = useState(0);

  const selectedIds = new Set(history[historyIdx]);
  const filtered    = addresses.filter(a => selectedIds.has(a.id));

  const pushHistory = useCallback((newIds) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIdx + 1);
      return [...trimmed, newIds];
    });
    setHistoryIdx(i => i + 1);
    setResult(null);
    setSaveStatus('idle');
    setError('');
  }, [historyIdx]);

  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < history.length - 1;
  const undo = () => setHistoryIdx(i => Math.max(0, i - 1));
  const redo = () => setHistoryIdx(i => Math.min(history.length - 1, i + 1));

  // Keep a ref so the keyboard handler always sees fresh history without re-registering
  const historyRef = useRef({ history, historyIdx });
  historyRef.current = { history, historyIdx };

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        setHistoryIdx(i => Math.max(0, i - 1));
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        setHistoryIdx(i => Math.min(historyRef.current.history.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // register once — ref keeps values fresh

  // Load agent-specific constraints from localStorage when agent changes
  useEffect(() => {
    if (!selectedAgent) return;
    const saved = loadAgentConstraints(selectedAgent);
    setConstraints(saved ? { ...DEFAULT_CONSTRAINTS, ...saved } : DEFAULT_CONSTRAINTS);
  }, [selectedAgent]);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setAddrLoading(true);
    setAddresses([]);

    client.from('agents').select('*').eq('active', true).order('name')
      .then(({ data, error: err }) => {
        const list = (!err && data?.length) ? data : [];
        setAgents(list);
        if (list.length) setAgent(a => a || list[0].id);
      });

    client.from('route_plans')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(async ({ data: plans }) => {
        if (!plans?.length) { setAddrLoading(false); return; }
        const planId = plans[0].id;

        const { data: addrs, error: addrErr } = await client
          .from('route_addresses')
          .select('id,address,city,state,zip,address_type,lat,lng,status,assignment_id')
          .eq('plan_id', planId)
          .neq('address_type', DNK_TYPE);

        if (addrErr) { console.error('Failed to load route_addresses:', addrErr.message); }

        if (addrs?.length) {
          setAddresses(addrs);
          setAddrLoading(false);
          return;
        }

        // Fallback: derive from route_assignments stop_sequences
        const { data: assignments, error: asgErr } = await client
          .from('route_assignments')
          .select('id,stop_sequence')
          .eq('plan_id', planId);

        if (asgErr) { console.error('Failed to load route_assignments:', asgErr.message); }

        if (assignments?.length) {
          const derived = [];
          const seen = new Set();
          for (const asgn of assignments) {
            for (const stop of asgn.stop_sequence ?? []) {
              if (!stop.unique_id || seen.has(stop.unique_id)) continue;
              seen.add(stop.unique_id);
              derived.push({
                id: stop.unique_id, address: stop.address,
                city: stop.city ?? '', state: stop.state ?? '', zip: stop.zip ?? '',
                address_type: stop.address_type ?? 'homeowner',
                lat: stop.lat, lng: stop.lng, status: 'assigned', assignment_id: asgn.id,
              });
            }
          }
          setAddresses(derived);
        }
        setAddrLoading(false);
      }).catch(() => setAddrLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  // Shape drawing — bulk-select addresses inside polygon/circle
  const handleShapeComplete = useCallback((shapeData) => {
    const eligible = addresses.filter(a => a.lat != null && a.address_type !== DNK_TYPE);
    const inShape = shapeData.type === 'circle'
      ? filterPointsInCircle(eligible, shapeData.center, shapeData.radiusM)
      : filterPointsInPolygon(eligible, shapeData.ring);
    const newIds = inShape.map(a => a.id);
    pushHistory(newIds);
  }, [addresses, pushHistory]);

  // Individual pin click — toggle single address in/out of selection
  const handleAddressClick = useCallback((addr) => {
    if (addr.address_type === DNK_TYPE) return;
    const current = history[historyIdx];
    const newIds = current.includes(addr.id)
      ? current.filter(id => id !== addr.id)
      : [...current, addr.id];
    pushHistory(newIds);
  }, [history, historyIdx, pushHistory]);

  const clearSelection = () => {
    pushHistory([]);
  };

  const generate = async () => {
    if (!filtered.length) { setError('No addresses selected.'); return; }
    if (!selectedAgent)   { setError('Select an agent first.'); return; }
    setGenerating(true); setError(''); setSaveStatus('idle'); setConflict(null);

    const agent = agents.find(a => a.id === selectedAgent);
    const { data, error: fnErr } = await client.functions.invoke('route-optimize', {
      body: {
        addresses: filtered.map(a => ({
          unique_id: a.id, address: a.address, city: a.city ?? '',
          state: a.state ?? '', zip: a.zip ?? '', address_type: a.address_type,
          lat: a.lat != null ? Number(a.lat) : null,
          lng: a.lng != null ? Number(a.lng) : null,
        })),
        agents: [{ id: agent.id, name: agent.name, start_address: agent.start_address ?? '', start_lat: agent.start_lat != null ? Number(agent.start_lat) : null, start_lng: agent.start_lng != null ? Number(agent.start_lng) : null }],
        constraints: { ...constraints, min_cluster_size: 1, max_miles: 99999, max_stops: Math.max(constraints.max_stops, filtered.length) },
        plan_id: 'draw-route-preview',
      },
    });

    setGenerating(false);
    if (fnErr || data?.error) { setError(fnErr?.message ?? data?.error ?? 'Generation failed'); return; }
    setResult(data);
  };

  const saveRoute = async (mode) => {
    if (!result?.routes?.[0]) { setError('No route to save — generate a route first.'); return; }
    setSaveStatus('saving'); setConflict(null); setError('');

    // Capture filtered selection at click time (closure may go stale after async awaits)
    const selectedAddrs = filtered;

    try {
      const route = result.routes[0];

      // Get or create today's plan for this branch
      let planId;
      // Must match TodaysRoutes' query: status='active' so both tabs use the same plan row
      let planQuery = client.from('route_plans').select('id').eq('plan_date', today).eq('status', 'active');
      // Accept org-wide plans (branch_id IS NULL, created by admin) as well as branch-specific ones
      if (session.branchId) planQuery = planQuery.or(`branch_id.eq.${session.branchId},branch_id.is.null`);
      const { data: existingPlan, error: planErr } = await withTimeout(
        planQuery.order('created_at', { ascending: false }).limit(1)
      );
      if (planErr) throw new Error(`Could not load plan: ${planErr.message}`);

      if (existingPlan?.length) {
        planId = existingPlan[0].id;
      } else {
        const { data: newPlan, error: newPlanErr } = await withTimeout(
          client.from('route_plans')
            .insert({ plan_date: today, constraints, branch_id: session.branchId, org_id: session.orgId, created_by: session.username, status: 'active' })
            .select('id').single()
        );
        if (newPlanErr) throw new Error(`Could not create plan: ${newPlanErr.message}`);
        planId = newPlan.id;
      }

      // Check for existing assignment for this agent today
      const { data: existingAssign } = await withTimeout(
        client.from('route_assignments').select('id, stop_sequence, total_stops')
          .eq('plan_id', planId).eq('agent_id', selectedAgent).maybeSingle()
      );

      if (existingAssign && !conflict) {
        setConflict(existingAssign); setSaveStatus('idle'); return;
      }

      let stopSeq  = route.stop_sequence;
      let assignId = existingAssign?.id;

      if (existingAssign && conflict === 'merge') {
        const prev = existingAssign.stop_sequence ?? [];
        stopSeq = [...prev, ...route.stop_sequence.map((s, i) => ({ ...s, stop_order: prev.length + i + 1 }))];
      }

      const payload = {
        plan_id: planId, agent_id: selectedAgent,
        agent_name: agents.find(a => a.id === selectedAgent)?.name ?? '',
        stop_sequence: stopSeq, cluster_sequence: route.clusters?.map(c => c.id) ?? [],
        total_stops: stopSeq.length, total_miles: route.total_miles,
        est_hours: route.est_hours, google_maps_urls: buildGoogleMapsUrls(stopSeq),
        org_id: session.orgId,
      };

      if (existingAssign) {
        const { data: upRows, error: upErr } = await withTimeout(
          client.from('route_assignments').update(payload).eq('id', existingAssign.id).select('id')
        );
        if (upErr) throw new Error(`Could not update assignment: ${upErr.message}`);
        if (!upRows?.length) throw new Error('Update was blocked — check RLS policy or session permissions');
      } else {
        const { data: newAssign, error: insErr } = await withTimeout(
          client.from('route_assignments').insert(payload).select('id').single()
        );
        if (insErr) throw new Error(`Could not save assignment: ${insErr.message}`);
        assignId = newAssign.id;
      }

      if (selectedAddrs.length) {
        const { error: addrErr } = await withTimeout(
          client.from('route_addresses')
            .update({ status: 'assigned', assignment_id: assignId })
            .in('id', selectedAddrs.map(a => a.id))
        );
        if (addrErr) throw new Error(`Could not mark addresses as assigned: ${addrErr.message}`);

        // Reflect assignment in local state so unassigned count updates immediately
        setAddresses(prev => prev.map(a =>
          selectedAddrs.find(f => f.id === a.id)
            ? { ...a, status: 'assigned', assignment_id: assignId }
            : a
        ));
      }

      setSaveStatus('saved');
      onRouteSaved?.();
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 3000);
    } catch (e) {
      setError(e.message ?? 'Save failed');
      setSaveStatus('idle');
    } finally {
      // Guard against saveStatus getting stuck as 'saving' (e.g. network hang)
      setSaveStatus(s => s === 'saving' ? 'idle' : s);
    }
  };

  const agentName      = agents.find(a => a.id === selectedAgent)?.name ?? '';
  const byType              = filtered.reduce((acc, a) => { acc[a.address_type] = (acc[a.address_type] ?? 0) + 1; return acc; }, {});
  const assignedCount       = addresses.filter(a => a.status === 'assigned').length;
  const unassignedMappable  = addresses.filter(a => a.status !== 'assigned' && a.address_type !== DNK_TYPE && a.lat && a.lng);
  const unassignedNoCoords  = addresses.filter(a => a.status !== 'assigned' && a.address_type !== DNK_TYPE && (!a.lat || !a.lng));
  const unassignedCount     = unassignedMappable.length;

  const routeResult = result?.routes?.[0];

  return (
    <div className="flex h-full">
      {/* Map pane */}
      <div className="flex-1 relative">
        {addrLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-50/80 pointer-events-none">
            <div className="text-center text-gray-400">
              <p className="font-medium">Loading address pool…</p>
            </div>
          </div>
        )}
        {!addrLoading && addresses.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-50/80 pointer-events-none">
            <div className="text-center text-gray-500">
              <p className="font-medium">No address pool loaded</p>
              <p className="text-sm mt-1">Ask admin to run (or re-run) today's route plan first.</p>
            </div>
          </div>
        )}
        <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading map…</div>}>
          <RouteMap
            result={result}
            drawMode
            allAddresses={addresses}
            shapeAddresses={filtered}
            onShapeComplete={handleShapeComplete}
            onAddressClick={handleAddressClick}
          />
        </Suspense>
      </div>

      {/* Side panel */}
      <div className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
        {/* Header + undo/redo */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-gray-900 text-sm">
              Add / Edit Route
              {!addrLoading && <span className="font-normal text-xs text-gray-400 ml-1">({addresses.length})</span>}
            </h3>
            <div className="flex gap-1">
              <button
                onClick={() => { setHistory([[]]); setHistoryIdx(0); setResult(null); setReloadKey(k => k + 1); }}
                title="Reload address pool"
                className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-green-700 hover:bg-gray-100 text-sm"
              >↺</button>
              <button
                onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
                className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-xs font-bold"
              >↩</button>
              <button
                onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
                className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 text-xs font-bold"
              >↪</button>
            </div>
          </div>
          <p className="text-xs text-gray-500">Draw a shape to bulk-select, or click individual pins to add/remove stops.</p>
          {addresses.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {unassignedCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#f97316' }} />
                  {unassignedCount} unassigned
                </span>
              )}
              {assignedCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#0891b2' }} />
                  {assignedCount} assigned
                </span>
              )}
              {unassignedNoCoords.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-400" title="These addresses could not be geocoded and have no map coordinates">
                  ⚠ {unassignedNoCoords.length} no location
                </span>
              )}
            </div>
          )}
          {!addrLoading && addresses.length > 0 && unassignedCount === 0 && unassignedNoCoords.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600">All stops are assigned. You can still select any pin (cyan) to add it to a new route.</p>
          )}
          {!addrLoading && unassignedNoCoords.length > 0 && (
            <p className="mt-1.5 text-xs text-amber-600">
              {unassignedNoCoords.length} stop{unassignedNoCoords.length > 1 ? 's' : ''} couldn't be geocoded (no coordinates) — they can't be shown on the map. Use a CSV with lat/lng columns to include them.
            </p>
          )}
        </div>

        {/* Selection summary */}
        {filtered.length > 0 && (
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <div className="text-2xl font-bold text-green-700">{filtered.length}</div>
              <button onClick={clearSelection} className="text-xs text-gray-400 hover:text-red-500">Clear all</button>
            </div>
            <div className="text-xs text-gray-500 mb-2">addresses selected</div>
            {Object.entries(byType).map(([type, count]) => (
              <div key={type} className="flex justify-between text-xs text-gray-600 py-0.5">
                <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
            {/* Selected address list — click to remove */}
            <div className="mt-3 max-h-36 overflow-y-auto space-y-1">
              {filtered.map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs bg-green-50 rounded px-2 py-1">
                  <span className="truncate text-gray-700">{a.address}</span>
                  <button
                    onClick={() => handleAddressClick(a)}
                    className="ml-2 text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Remove"
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agent picker */}
        <div className="p-4 border-b border-gray-100">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Assign to Agent</label>
          <select
            value={selectedAgent}
            onChange={e => {
              setAgent(e.target.value);
              setSaveStatus('idle');
              setConflict(null);
              setResult(null);
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {/* Constraints (collapsible) */}
        <div className="border-b border-gray-100">
          <button
            onClick={() => setShowCon(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            <span className="flex items-center gap-1.5">
              Constraint overrides
              {selectedAgent && loadAgentConstraints(selectedAgent) && (
                <span className="text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.5 rounded">custom</span>
              )}
            </span>
            <span>{showConstraints ? '▲' : '▼'}</span>
          </button>
          {showConstraints && (
            <div className="px-4 pb-4">
              <ConstraintPanel constraints={constraints} onChange={setConstraints} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 space-y-2 mt-auto">
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <button
            type="button"
            onClick={generate}
            disabled={generating || filtered.length === 0}
            className="w-full bg-green-700 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating…' : 'Generate Route'}
          </button>

          {result && !routeResult && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="font-semibold mb-1">No route generated</p>
              {(result.stats?.unassigned ?? 0) > 0
                ? <p>All {result.stats.unassigned} addresses could not be routed — they may be missing map coordinates (no lat/lng). Try reloading the address pool or re-running today's route plan from admin.</p>
                : <p>No addresses could be assigned to a route.</p>
              }
            </div>
          )}

          {result && routeResult && (
            <>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
                <p>&#10003; {routeResult.total_stops} stops · {routeResult.total_miles?.toFixed(1)} mi · ~{routeResult.est_hours}h</p>
                {(result.stats?.unassigned ?? 0) > 0 && (
                  <p className="mt-1 text-amber-700">{result.stats.unassigned} address{result.stats.unassigned !== 1 ? 'es' : ''} could not be clustered and were skipped</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => exportAgentCSV(routeResult, today)}
                className="w-full border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Export CSV
              </button>

              {routeResult.google_maps_urls?.[0] && (
                <a href={routeResult.google_maps_urls[0]} target="_blank" rel="noreferrer"
                  className="block w-full border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 text-center transition-colors"
                >
                  Open in Google Maps &#8599;
                </a>
              )}

              {error && saveStatus === 'idle' && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">{error}</p>
              )}
              {saveStatus === 'saved'
                ? <div className="text-center text-sm text-green-700 font-semibold py-2 bg-green-50 border border-green-200 rounded-lg">&#10003; Route saved to today's plan</div>
                : (
                  <button
                    type="button"
                    onClick={() => saveRoute()}
                    disabled={saveStatus === 'saving'}
                    className="w-full bg-gray-900 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    {saveStatus === 'saving' ? 'Saving…' : "Save to Today's Plan"}
                  </button>
                )
              }
            </>
          )}
        </div>
      </div>

      {/* Replace / Merge conflict modal */}
      {conflict && typeof conflict === 'object' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-2">Agent already has a route today</h3>
            <p className="text-sm text-gray-600 mb-5">
              <strong>{agentName}</strong> already has {conflict.total_stops} stops assigned today.
              Replace their route or add these stops to it?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConflict(null)} className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => { setConflict('merge');   saveRoute('merge');   }} className="flex-1 bg-blue-600 text-white text-sm font-semibold py-2 rounded-lg hover:bg-blue-700">Merge</button>
              <button onClick={() => { setConflict('replace'); saveRoute('replace'); }} className="flex-1 bg-red-600 text-white text-sm font-semibold py-2 rounded-lg hover:bg-red-700">Replace</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
