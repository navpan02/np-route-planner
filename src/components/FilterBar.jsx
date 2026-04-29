import { useMemo } from 'react';

const AGENT_DOT_COLORS = [
  'bg-emerald-500', 'bg-blue-500', 'bg-orange-500', 'bg-purple-500',
  'bg-rose-500', 'bg-teal-500', 'bg-yellow-500', 'bg-indigo-500',
  'bg-pink-500', 'bg-cyan-500',
];

const TYPE_ICONS = {
  homeowner: '🏠',
  new_construction: '🏗',
  renter: '🏘',
  multi_family: '🏢',
  commercial: '🏪',
  vacant: '📭',
};

/**
 * Filter bar shown above Map/List tabs in the results view.
 * Props:
 *   result         — full edge function response (unfiltered)
 *   allTypes       — Set<string> of all unique address types in result
 *   filterAgentIds — Set<string> of currently shown agent IDs
 *   filterTypes    — Set<string> of currently shown address types
 *   onAgentChange(newSet)
 *   onTypeChange(newSet)
 *   onClear()
 */
export default function FilterBar({
  result,
  allTypes,
  filterAgentIds,
  filterTypes,
  onAgentChange,
  onTypeChange,
  onClear,
}) {
  // Live stop counter — count stops that pass both agent + type filters
  const { showing, total } = useMemo(() => {
    let showing = 0;
    let total = 0;
    result.routes.forEach(r => {
      const stops = r.stop_sequence ?? [];
      total += stops.length;
      if (filterAgentIds.has(r.agent_id)) {
        showing += stops.filter(s => filterTypes.has(s.address_type)).length;
      }
    });
    return { showing, total };
  }, [result, filterAgentIds, filterTypes]);

  const allTypesArr = useMemo(() => Array.from(allTypes).sort(), [allTypes]);

  const isFiltered =
    filterAgentIds.size < result.routes.length ||
    filterTypes.size < allTypes.size;

  const toggleAgent = (agentId) => {
    const next = new Set(filterAgentIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    onAgentChange(next);
  };

  const toggleAllAgents = () => {
    if (filterAgentIds.size === result.routes.length) {
      // deselect all — keep none shown (valid)
      onAgentChange(new Set());
    } else {
      onAgentChange(new Set(result.routes.map(r => r.agent_id)));
    }
  };

  const toggleType = (type) => {
    const next = new Set(filterTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onTypeChange(next);
  };

  return (
    <div className="bg-white rounded-2xl border border-np-border shadow-np p-4 mb-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-np-dark">Filters</h3>
          <span className="text-xs bg-np-surface text-np-muted px-2.5 py-1 rounded-full font-medium">
            Showing {showing.toLocaleString()} / {total.toLocaleString()} stops
          </span>
        </div>
        {isFiltered && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-semibold text-np-accent hover:text-np-dark transition-colors whitespace-nowrap ml-4"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Agent filters */}
      <div className="mb-3">
        <p className="text-[10px] font-bold text-np-muted uppercase tracking-widest mb-2">Agents</p>
        <div className="flex flex-wrap gap-2">
          {/* All toggle */}
          <button
            type="button"
            onClick={toggleAllAgents}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              filterAgentIds.size === result.routes.length
                ? 'border-np-dark bg-np-dark text-white'
                : 'border-np-border bg-white text-np-muted hover:border-np-dark/40'
            }`}
          >
            All
          </button>
          {result.routes.map((route, i) => {
            const selected = filterAgentIds.has(route.agent_id);
            return (
              <button
                key={route.agent_id}
                type="button"
                onClick={() => toggleAgent(route.agent_id)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  selected
                    ? 'border-np-dark bg-np-dark text-white'
                    : 'border-np-border bg-white text-np-muted hover:border-np-dark/40'
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${AGENT_DOT_COLORS[i % AGENT_DOT_COLORS.length]}`} />
                {route.agent_name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Address type filters */}
      <div>
        <p className="text-[10px] font-bold text-np-muted uppercase tracking-widest mb-2">Address Type</p>
        <div className="flex flex-wrap gap-2">
          {allTypesArr.map(type => {
            const selected = filterTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  selected
                    ? 'border-np-accent bg-np-accent/10 text-np-dark'
                    : 'border-np-border bg-white text-np-muted hover:border-np-accent/40'
                }`}
              >
                <span className="leading-none">{TYPE_ICONS[type] ?? '📍'}</span>
                <span className="capitalize">{type.replace(/_/g, ' ')}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
