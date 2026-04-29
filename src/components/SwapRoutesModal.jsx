import { useState } from 'react';

/**
 * Inline side-panel for swapping entire routes between two agents.
 * Rendered next to the map (no fixed overlay — avoids Leaflet z-index conflicts).
 *
 * Props:
 *   routes    — current result.routes array
 *   onConfirm(agentIdA, agentIdB) — called when user confirms swap
 *   onClose() — called on cancel
 */
export default function SwapRoutesModal({ routes, onConfirm, onClose }) {
  const [agentA, setAgentA] = useState(routes[0]?.agent_id ?? '');
  const [agentB, setAgentB] = useState(routes[1]?.agent_id ?? routes[0]?.agent_id ?? '');

  const routeA = routes.find(r => r.agent_id === agentA);
  const routeB = routes.find(r => r.agent_id === agentB);
  const same = agentA && agentB && agentA === agentB;
  const canConfirm = agentA && agentB && !same;

  return (
    <div className="w-80 shrink-0 bg-white rounded-2xl shadow-np-lg border border-np-border flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-1">
        <div>
          <h2 className="text-base font-extrabold text-np-dark">Swap Routes</h2>
          <p className="text-np-muted text-xs mt-0.5">
            Exchange all stops between two agents.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-np-muted hover:text-np-dark transition-colors text-xl leading-none mt-0.5 ml-2"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-4 flex-1 mt-4">
        {/* Agent A */}
        <div>
          <label className="text-[10px] font-bold text-np-muted uppercase tracking-widest block mb-1.5">
            Agent A
          </label>
          <select
            value={agentA}
            onChange={e => setAgentA(e.target.value)}
            className="w-full border border-np-border rounded-xl px-3 py-2 text-sm text-np-text bg-white focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent transition-all"
          >
            {routes.map(r => (
              <option key={r.agent_id} value={r.agent_id}>
                {r.agent_name} — {r.total_stops} stops
              </option>
            ))}
          </select>
        </div>

        {/* Swap divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-np-border" />
          <div className="w-7 h-7 rounded-full bg-np-surface border border-np-border flex items-center justify-center text-np-muted text-sm select-none">
            ⇅
          </div>
          <div className="flex-1 h-px bg-np-border" />
        </div>

        {/* Agent B */}
        <div>
          <label className="text-[10px] font-bold text-np-muted uppercase tracking-widest block mb-1.5">
            Agent B
          </label>
          <select
            value={agentB}
            onChange={e => setAgentB(e.target.value)}
            className="w-full border border-np-border rounded-xl px-3 py-2 text-sm text-np-text bg-white focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent transition-all"
          >
            {routes.map(r => (
              <option key={r.agent_id} value={r.agent_id}>
                {r.agent_name} — {r.total_stops} stops
              </option>
            ))}
          </select>
        </div>

        {/* Preview / validation */}
        {same ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700 font-medium">
            Agent A and Agent B must be different.
          </div>
        ) : canConfirm && routeA && routeB ? (
          <div className="bg-np-surface rounded-xl border border-np-border px-3 py-3">
            <p className="text-[10px] font-bold text-np-muted uppercase tracking-widest mb-2">Preview</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-np-dark truncate">{routeA.agent_name}</span>
                <span className="shrink-0">
                  <span className="font-bold text-np-accent">{routeB.total_stops}</span>
                  <span className="text-np-muted text-xs"> stops </span>
                  <span className="text-np-muted text-xs">(was {routeA.total_stops})</span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-np-dark truncate">{routeB.agent_name}</span>
                <span className="shrink-0">
                  <span className="font-bold text-np-accent">{routeA.total_stops}</span>
                  <span className="text-np-muted text-xs"> stops </span>
                  <span className="text-np-muted text-xs">(was {routeB.total_stops})</span>
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Spacer pushes buttons to bottom */}
        <div className="flex-1" />

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-np-border text-np-text font-semibold px-3 py-2 rounded-xl hover:border-np-dark hover:text-np-dark transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm(agentA, agentB)}
            className={`flex-1 font-semibold px-3 py-2 rounded-xl transition-all text-sm ${
              canConfirm
                ? 'bg-np-accent text-np-dark hover:brightness-110 shadow-np'
                : 'bg-np-muted/20 text-np-muted cursor-not-allowed'
            }`}
          >
            Swap Routes
          </button>
        </div>
      </div>
    </div>
  );
}
