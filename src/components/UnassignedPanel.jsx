import { useState, useEffect } from 'react';

/**
 * Side panel listing all unassigned stops with inline assignment UI.
 * Rendered next to the map (same inline pattern as SwapRoutesModal).
 *
 * Props:
 *   stops         — array of unassigned stop objects
 *   routes        — current result.routes (for agent dropdown)
 *   maxStops      — constraint max_stops (for over-capacity warning)
 *   selectedId    — unique_id of currently selected stop (or null)
 *   onSelect(stop|null) — called when user clicks a stop row to select/deselect
 *   onAssign(stop, agentId) — called when user confirms assignment
 *   onClose()     — called to dismiss the panel
 */

const TYPE_COLOURS = {
  homeowner:        '#16a34a',
  new_construction: '#2563eb',
  renter:           '#f59e0b',
  multi_family:     '#8b5cf6',
  commercial:       '#ea580c',
  vacant:           '#94a3b8',
};

function typeColour(t) {
  return TYPE_COLOURS[t] ?? '#475569';
}

export default function UnassignedPanel({ stops, routes, agentlessAgents = [], maxStops, selectedId, onSelect, onAssign, onClose }) {
  const [targetAgentId, setTargetAgentId] = useState(routes[0]?.agent_id ?? agentlessAgents[0]?.id ?? '');

  // Reset agent selection whenever the selected stop changes
  useEffect(() => {
    setTargetAgentId(routes[0]?.agent_id ?? agentlessAgents[0]?.id ?? '');
  }, [selectedId, routes, agentlessAgents]);

  const targetRoute   = routes.find(r => r.agent_id === targetAgentId);
  const isNewRoute    = !targetRoute && agentlessAgents.some(a => a.id === targetAgentId);
  const overCapacity  = !!(targetRoute && maxStops && targetRoute.total_stops >= maxStops);

  return (
    <div
      className="w-80 shrink-0 bg-white rounded-2xl shadow-np-lg border border-np-border flex flex-col"
      style={{ maxHeight: 600 }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-np-border shrink-0">
        <div>
          <h2 className="text-base font-extrabold text-np-dark">Unassigned Stops</h2>
          <p className="text-np-muted text-xs mt-0.5">
            {stops.length} address{stops.length !== 1 ? 'es' : ''} &middot; click a pin or row to assign
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-np-muted hover:text-np-dark transition-colors text-xl leading-none mt-0.5 ml-2"
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      {/* ── Agents without a route ────────────────────────── */}
      {agentlessAgents.length > 0 && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 shrink-0">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-2">
            Agents without a route
          </p>
          <div className="flex flex-wrap gap-1.5">
            {agentlessAgents.map(a => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 bg-white border border-blue-200 text-blue-700 text-xs font-semibold px-2 py-1 rounded-lg"
              >
                <span className="w-4 h-4 bg-blue-100 rounded-full flex items-center justify-center text-[9px] font-bold">
                  {a.name.charAt(0).toUpperCase()}
                </span>
                {a.name}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-blue-500 mt-1.5">
            Assign stops to any of these agents to start a new route.
          </p>
        </div>
      )}

      {/* ── Stop list ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto divide-y divide-np-border/50 min-h-0">
        {stops.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-np-dark font-semibold text-sm">All stops assigned!</p>
          </div>
        ) : (
          stops.map(stop => {
            const isSel = stop.unique_id === selectedId;
            const colour = typeColour(stop.address_type);
            return (
              <div key={stop.unique_id}>
                {/* ── Row ── */}
                <button
                  type="button"
                  onClick={() => onSelect(isSel ? null : stop)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                    isSel ? 'bg-red-50' : 'hover:bg-np-surface/60'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
                    style={{ backgroundColor: colour }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-np-dark block truncate">{stop.address}</span>
                    <span className="text-[10px] text-np-muted">{stop.city}, {stop.state} {stop.zip}</span>
                  </span>
                  <span
                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5"
                    style={{ background: colour + '22', color: colour }}
                  >
                    {(stop.address_type ?? 'unknown').replace(/_/g, '\u00a0')}
                  </span>
                </button>

                {/* ── Inline assign drawer (visible only for selected row) ── */}
                {isSel && (
                  <div className="px-4 pb-4 pt-2 bg-red-50 border-t border-red-100">
                    <p className="text-[10px] font-bold text-np-muted uppercase tracking-widest mb-2">
                      Assign to agent
                    </p>

                    <select
                      value={targetAgentId}
                      onChange={e => setTargetAgentId(e.target.value)}
                      className="w-full border border-np-border rounded-xl px-3 py-2 text-sm text-np-text bg-white focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent transition-all"
                    >
                      {routes.length > 0 && (
                        <optgroup label="Existing routes">
                          {routes.map(r => (
                            <option key={r.agent_id} value={r.agent_id}>
                              {r.agent_name} — {r.total_stops} stops
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {agentlessAgents.length > 0 && (
                        <optgroup label="Create new route">
                          {agentlessAgents.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name} — no route yet
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    {overCapacity && (
                      <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700 font-medium">
                        {targetRoute.agent_name} is at capacity ({targetRoute.total_stops}/{maxStops} stops).
                        Admin override is allowed.
                      </div>
                    )}
                    {isNewRoute && (
                      <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700 font-medium">
                        This will create a new route for this agent.
                      </div>
                    )}

                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => onSelect(null)}
                        className="flex-1 border border-np-border text-np-text font-semibold px-3 py-2 rounded-xl hover:border-np-dark hover:text-np-dark transition-colors text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={!targetAgentId}
                        onClick={() => targetAgentId && onAssign(stop, targetAgentId)}
                        className={`flex-1 font-semibold px-3 py-2 rounded-xl text-xs transition-all ${
                          targetAgentId
                            ? 'bg-np-accent text-np-dark hover:brightness-110 shadow-np'
                            : 'bg-np-muted/20 text-np-muted cursor-not-allowed'
                        }`}
                      >
                        Assign
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
