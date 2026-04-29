import { useState } from 'react';
import { buildGoogleMapsUrls, exportAgentCSV } from '../utils/routeExport';

const TYPE_ICONS = {
  homeowner: '🏠',
  new_construction: '🏗',
  renter: '🏘',
  multi_family: '🏢',
  commercial: '🏪',
  vacant: '📭',
};

const AGENT_COLORS = [
  'border-l-emerald-500 bg-emerald-50/40',
  'border-l-blue-500 bg-blue-50/40',
  'border-l-orange-500 bg-orange-50/40',
  'border-l-purple-500 bg-purple-50/40',
  'border-l-rose-500 bg-rose-50/40',
  'border-l-teal-500 bg-teal-50/40',
  'border-l-yellow-500 bg-yellow-50/40',
  'border-l-indigo-500 bg-indigo-50/40',
  'border-l-pink-500 bg-pink-50/40',
  'border-l-cyan-500 bg-cyan-50/40',
];

const CLUSTER_DOT_COLORS = [
  'bg-emerald-400', 'bg-blue-400', 'bg-orange-400', 'bg-purple-400',
  'bg-rose-400', 'bg-teal-400', 'bg-yellow-400', 'bg-indigo-400',
];

function typeIcon(type) {
  return TYPE_ICONS[type] ?? '📍';
}

function AgentCard({ route, planDate, defaultOpen, colorIdx }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const firstUrl = route.google_maps_urls?.[0];
  const accentClass = AGENT_COLORS[colorIdx % AGENT_COLORS.length];

  return (
    <div className={`bg-white rounded-2xl border border-np-border shadow-np border-l-4 overflow-hidden ${accentClass}`}>
      {/* Agent header */}
      <button
        type="button"
        className="w-full flex items-center gap-4 px-6 py-4 hover:bg-np-surface/50 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">
          <div className="font-bold text-np-dark text-base">{route.agent_name}</div>
          <div className="text-np-muted text-sm mt-0.5">
            {route.total_stops} stops
            {route.total_miles != null && <> · {route.total_miles.toFixed(1)} mi</>}
            {route.est_hours != null && <> · ~{route.est_hours}h</>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="bg-np-accent/10 text-np-accent text-xs font-semibold px-2.5 py-1 rounded-full">
            {route.clusters?.length ?? 0} clusters
          </span>
          <svg
            className={`w-4 h-4 text-np-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-np-border/50">
          {/* Quick actions */}
          <div className="px-6 py-4 flex flex-wrap gap-3 bg-np-surface/30">
            {firstUrl && (
              <a
                href={firstUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold bg-np-dark text-white px-4 py-2 rounded-xl hover:bg-np-mid transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                Open in Google Maps
              </a>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm font-semibold border border-np-border text-np-text px-4 py-2 rounded-xl hover:border-np-dark hover:text-np-dark transition-colors bg-white"
              onClick={() => exportAgentCSV(route, planDate)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
            {route.google_maps_urls?.length > 1 && (
              <span className="text-xs text-np-muted self-center">
                {route.google_maps_urls.length} map legs
              </span>
            )}
          </div>

          {/* Clusters */}
          <div className="px-6 py-4 space-y-4">
            {route.clusters.map((cluster, ci) => (
              <div key={cluster.id} className="rounded-xl border border-np-border overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2.5 bg-np-surface/60 border-b border-np-border">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${CLUSTER_DOT_COLORS[ci % CLUSTER_DOT_COLORS.length]}`} />
                  <span className="text-xs font-bold text-np-dark uppercase tracking-wide">
                    Cluster {cluster.id}
                  </span>
                  <span className="text-xs text-np-muted ml-auto">{cluster.size} stops</span>
                </div>
                <ol className="divide-y divide-np-border/50">
                  {cluster.stops.map(stop => (
                    <li key={stop.unique_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-np-surface/40 transition-colors">
                      <span className="w-6 h-6 rounded-full bg-np-dark text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {stop.stop_order}
                      </span>
                      <span className="text-base leading-none flex-shrink-0">{typeIcon(stop.address_type)}</span>
                      <span className="flex-1 text-sm text-np-text truncate min-w-0">
                        {stop.address}, {stop.city} {stop.zip}
                      </span>
                      <a
                        href={`https://maps.google.com/maps?q=${stop.lat},${stop.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 w-7 h-7 rounded-lg bg-np-surface border border-np-border flex items-center justify-center text-np-muted hover:text-np-dark hover:border-np-dark transition-colors text-sm"
                        aria-label="Navigate"
                        title="Navigate"
                      >
                        ↗
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UnassignedSection({ stops }) {
  const [open, setOpen] = useState(false);
  if (!stops || stops.length === 0) return null;
  return (
    <div className="bg-amber-50 rounded-2xl border border-amber-200 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-4 px-6 py-4 hover:bg-amber-100/60 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">
          <div className="font-bold text-amber-900 text-base">Unassigned Addresses</div>
          <div className="text-amber-700 text-sm mt-0.5">
            {stops.length} {stops.length === 1 ? 'address' : 'addresses'} could not be assigned — agent capacity reached or constraints not met
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-amber-500 transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="border-t border-amber-200">
          <ol className="divide-y divide-amber-200/60">
            {stops.map((stop, i) => (
              <li key={stop.unique_id ?? i} className="flex items-center gap-3 px-6 py-2.5 hover:bg-amber-100/40 transition-colors">
                <span className="text-base leading-none flex-shrink-0">{typeIcon(stop.address_type)}</span>
                <span className="flex-1 text-sm text-amber-900 truncate min-w-0">
                  {stop.address}, {stop.city}, {stop.state} {stop.zip}
                </span>
                <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full flex-shrink-0 capitalize">
                  {stop.address_type?.replace(/_/g, ' ')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * Per-agent accordion list view.
 * Props: result (edge function response), planDate (YYYY-MM-DD)
 */
export default function RouteListView({ result, planDate }) {
  if (!result || !result.routes || result.routes.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-np-border p-12 text-center text-np-muted">
        No routes generated yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result.routes.map((route, i) => (
        <AgentCard
          key={route.agent_id ?? i}
          route={route}
          planDate={planDate}
          defaultOpen={i === 0}
          colorIdx={i}
        />
      ))}
      <UnassignedSection stops={result.unassigned} />
    </div>
  );
}
