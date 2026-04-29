import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { exportAgentCSV, exportAllCSV } from '../../../utils/routeExport';

const AGENT_COLORS = [
  'border-l-emerald-500', 'border-l-blue-500', 'border-l-orange-500',
  'border-l-purple-500', 'border-l-rose-500', 'border-l-teal-500',
];

function dateLabel(dateStr) {
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function AgentRow({ route, idx }) {
  const [open, setOpen] = useState(false);
  const color = AGENT_COLORS[idx % AGENT_COLORS.length];
  return (
    <div className={`border border-gray-200 rounded-xl border-l-4 ${color} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 text-sm">{route.agent_name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {route.total_stops ?? 0} stops
            {route.total_miles != null && <> · {Number(route.total_miles).toFixed(1)} mi</>}
            {route.est_hours != null && <> · ~{route.est_hours}h</>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {route.google_maps_urls?.[0] && (
            <a
              href={route.google_maps_urls[0]}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              Maps ↗
            </a>
          )}
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {(route.stop_sequence ?? []).length === 0 ? (
            <p className="px-4 py-3 text-xs text-gray-400 italic">No stops recorded</p>
          ) : (
            (route.stop_sequence ?? []).map((stop, si) => (
              <div key={si} className="flex items-start gap-3 px-4 py-2">
                <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0 mt-0.5">{si + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-800 truncate">{stop.address}</div>
                  <div className="text-[11px] text-gray-400">{stop.city}, {stop.state} {stop.zip}</div>
                </div>
                <span className="text-[10px] text-gray-500 flex-shrink-0 mt-0.5 capitalize">
                  {(stop.address_type ?? '').replace(/_/g, ' ')}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, session }) {
  const client = session?.portalClient ?? supabase;
  const [open, setOpen] = useState(false);
  const [routes, setRoutes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    if (routes !== null) { setOpen(o => !o); return; }
    setLoading(true);
    setOpen(true);
    const { data, error } = await client
      .from('route_assignments')
      .select('id,agent_id,agent_name,stop_sequence,total_stops,total_miles,est_hours,google_maps_urls')
      .eq('plan_id', plan.id)
      .order('agent_name');
    if (error) { setErr(error.message); setLoading(false); return; }
    setRoutes(data ?? []);
    setLoading(false);
  };

  const planRoutes = routes ?? [];
  const totalStops = planRoutes.reduce((s, r) => s + (r.total_stops ?? 0), 0);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Plan header */}
      <button
        type="button"
        onClick={load}
        className="w-full flex items-center gap-4 px-6 py-4 hover:bg-gray-50 text-left transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base font-bold text-gray-900">{dateLabel(plan.plan_date)}</span>
            <span className="text-sm text-gray-400">{plan.plan_date}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span><strong className="text-gray-700">{plan.total_stops ?? '—'}</strong> stops assigned</span>
            {(plan.unassigned_ct ?? 0) > 0 && (
              <span className="text-amber-600"><strong>{plan.unassigned_ct}</strong> unassigned</span>
            )}
            {plan.total_agents != null && (
              <span><strong className="text-gray-700">{plan.total_agents}</strong> agents</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {open && routes !== null && routes.length > 0 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); exportAllCSV(routes, [], plan.plan_date); }}
              className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-2.5 py-1 rounded-lg transition-colors"
            >
              Export CSV
            </button>
          )}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded routes */}
      {open && (
        <div className="border-t border-gray-100 px-6 py-4 space-y-3">
          {loading && <p className="text-sm text-gray-400">Loading routes…</p>}
          {err && <p className="text-sm text-red-500">Error: {err}</p>}
          {!loading && !err && routes !== null && routes.length === 0 && (
            <p className="text-sm text-gray-400 italic">No route assignments found for this plan.</p>
          )}
          {!loading && !err && routes !== null && routes.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{routes.length} agent route{routes.length !== 1 ? 's' : ''} · {totalStops} stops total</span>
              </div>
              {routes.map((r, i) => (
                <AgentRow key={r.id} route={r} idx={i} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function RouteHistoryTab({ session }) {
  const client = session?.portalClient ?? supabase;
  const [plans, setPlans] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const today = new Date().toLocaleDateString('en-CA');
      const threeDaysAgo = new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-CA');

      let q = client
        .from('route_plans')
        .select('id,plan_date,total_stops,unassigned_ct,total_agents,status,created_at')
        .gte('plan_date', threeDaysAgo)
        .lte('plan_date', today)
        .order('plan_date', { ascending: false });

      if (session?.branchId) q = q.eq('branch_id', session.branchId);

      const { data, error } = await q;
      if (error) { setErr(error.message); setLoading(false); return; }
      setPlans(data ?? []);
      setLoading(false);
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-6">
      {/* Read-only banner */}
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl px-4 py-2.5 mb-6 text-sm font-medium">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        Read-only view — last 3 days of route plans. To make changes use <strong className="ml-1">Today's Routes</strong> or <strong className="ml-1">Add / Edit Route</strong>.
      </div>

      <h2 className="text-lg font-bold text-gray-900 mb-4">Route History</h2>

      {loading && (
        <div className="text-center py-12 text-gray-400">Loading route history…</div>
      )}

      {!loading && err && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
          <strong>Error loading history:</strong> {err}
        </div>
      )}

      {!loading && !err && plans !== null && plans.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium text-gray-600 mb-1">No route plans in the last 3 days</p>
          <p className="text-sm">Plans appear here once an admin or manager generates routes.</p>
        </div>
      )}

      {!loading && !err && plans !== null && plans.length > 0 && (
        <div className="space-y-4">
          {plans.map(plan => (
            <PlanCard key={plan.id} plan={plan} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
