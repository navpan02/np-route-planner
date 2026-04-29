import { useState, useRef } from 'react';

const DEFAULT_PRIORITY = [
  'homeowner',
  'new_construction',
  'renter',
  'multi_family',
  'commercial',
  'vacant',
];

export const DEFAULT_CONSTRAINTS = {
  max_stops: 100,
  max_miles: 25,
  excluded_zips: [],
  priority_order: DEFAULT_PRIORITY,
  cluster_radius_m: 400,
  min_cluster_size: 5,
  clustering_algorithm: 'dbscan',
};

const ALGORITHMS = [
  {
    key: 'dbscan',
    name: 'DBSCAN',
    tag: 'Default',
    tagColour: 'bg-np-accent/10 text-np-accent',
    description: 'Density-based clustering using a fixed neighbourhood radius.',
    pros: 'Fast, predictable, works well for uniform city grids',
    cons: 'Single radius — may miss dense hotspots or over-split sparse areas',
  },
  {
    key: 'dbscan_2opt',
    name: 'DBSCAN + 2-opt',
    tag: 'Better routes',
    tagColour: 'bg-green-100 text-green-700',
    description: 'Same density clustering as DBSCAN, but applies 2-opt post-processing to shorten walk paths within each cluster.',
    pros: '10–25% shorter walk paths within clusters',
    cons: 'Slightly slower than plain DBSCAN on large clusters',
  },
  {
    key: 'hdbscan',
    name: 'HDBSCAN',
    tag: 'Adaptive',
    tagColour: 'bg-purple-100 text-purple-700',
    description: 'Hierarchical density clustering — automatically adapts to varying stop density without a fixed radius.',
    pros: 'Fewer unassigned stops; no radius tuning required',
    cons: 'Cluster boundaries less predictable; slower on large datasets',
  },
  {
    key: 'voronoi',
    name: 'Voronoi Territory',
    tag: 'Agent-first',
    tagColour: 'bg-blue-100 text-blue-700',
    description: 'Assigns each stop to the nearest agent start location first, then clusters within each territory.',
    pros: 'Guaranteed balanced agent workloads; no cross-territory routing',
    cons: 'Requires accurate agent start addresses; may create uneven clusters',
  },
];

/**
 * Stateless constraint controls panel.
 * Props: constraints (object), onChange(updatedConstraints) callback.
 */
export default function ConstraintPanel({ constraints, onChange }) {
  const [zipInput, setZipInput] = useState('');
  const dragSrc = useRef(null);

  const update = (key, value) => onChange({ ...constraints, [key]: value });

  // ── ZIP chip handlers ──────────────────────────────────────────────────────

  const addZip = () => {
    const z = zipInput.trim();
    if (/^\d{5}$/.test(z) && !constraints.excluded_zips.includes(z)) {
      update('excluded_zips', [...constraints.excluded_zips, z]);
    }
    setZipInput('');
  };

  const removeZip = (zip) =>
    update('excluded_zips', constraints.excluded_zips.filter(z => z !== zip));

  const handleZipKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addZip(); }
  };

  // ── Priority drag-to-reorder ───────────────────────────────────────────────

  const handleDragStart = (e, idx) => {
    dragSrc.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragSrc.current === null || dragSrc.current === idx) return;
    const newOrder = [...constraints.priority_order];
    const [moved] = newOrder.splice(dragSrc.current, 1);
    newOrder.splice(idx, 0, moved);
    dragSrc.current = idx;
    update('priority_order', newOrder);
  };

  const handleDragEnd = () => { dragSrc.current = null; };

  return (
    <div className="space-y-6">
      {/* Clustering algorithm */}
      <div>
        <label className="text-sm font-semibold text-np-text block mb-1">Clustering algorithm</label>
        <p className="text-xs text-np-muted mb-3">Choose how stops are grouped into walkable neighbourhood clusters</p>
        <div className="grid grid-cols-1 gap-2">
          {ALGORITHMS.map(alg => {
            const isSelected = constraints.clustering_algorithm === alg.key;
            return (
              <button
                key={alg.key}
                type="button"
                onClick={() => update('clustering_algorithm', alg.key)}
                className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-np-accent bg-np-accent/5 shadow-np'
                    : 'border-np-border bg-white hover:border-np-accent/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-np-dark">{alg.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${alg.tagColour}`}>
                    {alg.tag}
                  </span>
                </div>
                <p className="text-xs text-np-muted leading-snug">{alg.description}</p>
                {isSelected && (
                  <div className="mt-2 grid grid-cols-2 gap-2 pt-2 border-t border-np-border/50">
                    <div className="text-[10px] text-green-700">
                      <span className="font-bold block mb-0.5">Pros</span>
                      {alg.pros}
                    </div>
                    <div className="text-[10px] text-amber-700">
                      <span className="font-bold block mb-0.5">Cons</span>
                      {alg.cons}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Max stops */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-np-text">Max stops / agent</label>
          <span className="text-np-accent font-bold text-sm bg-np-accent/10 px-3 py-0.5 rounded-full">
            {constraints.max_stops}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={constraints.max_stops}
            onChange={e => update('max_stops', Number(e.target.value))}
            className="flex-1 h-2 rounded-full accent-np-accent cursor-pointer"
          />
          <input
            type="number"
            min={10}
            max={200}
            value={constraints.max_stops}
            onChange={e => update('max_stops', Number(e.target.value))}
            className="w-20 text-sm border border-np-border rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent"
          />
        </div>
      </div>

      {/* Max miles */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-np-text">Max miles / agent</label>
          <span className="text-np-accent font-bold text-sm bg-np-accent/10 px-3 py-0.5 rounded-full">
            {constraints.max_miles} mi
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={constraints.max_miles}
            onChange={e => update('max_miles', Number(e.target.value))}
            className="flex-1 h-2 rounded-full accent-np-accent cursor-pointer"
          />
          <input
            type="number"
            min={5}
            max={100}
            value={constraints.max_miles}
            onChange={e => update('max_miles', Number(e.target.value))}
            className="w-20 text-sm border border-np-border rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent"
          />
        </div>
      </div>

      {/* Cluster radius */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-np-text">Cluster radius</label>
          <span className="text-np-accent font-bold text-sm bg-np-accent/10 px-3 py-0.5 rounded-full">
            {constraints.cluster_radius_m} m
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={100}
            max={1000}
            step={50}
            value={constraints.cluster_radius_m}
            onChange={e => update('cluster_radius_m', Number(e.target.value))}
            className="flex-1 h-2 rounded-full accent-np-accent cursor-pointer"
          />
          <input
            type="number"
            min={100}
            max={1000}
            value={constraints.cluster_radius_m}
            onChange={e => update('cluster_radius_m', Number(e.target.value))}
            className="w-20 text-sm border border-np-border rounded-lg px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-np-accent/30 focus:border-np-accent"
          />
        </div>
      </div>

      {/* Excluded ZIPs */}
      <div>
        <label className="text-sm font-semibold text-np-text block mb-2">Exclude ZIP codes</label>
        <div className="min-h-[44px] flex flex-wrap gap-2 p-3 bg-np-surface rounded-xl border border-np-border focus-within:border-np-accent focus-within:ring-2 focus-within:ring-np-accent/20 transition-all">
          {constraints.excluded_zips.map(z => (
            <span
              key={z}
              className="inline-flex items-center gap-1 bg-np-dark text-white text-xs font-semibold px-2.5 py-1 rounded-full"
            >
              {z}
              <button
                type="button"
                onClick={() => removeZip(z)}
                className="ml-0.5 hover:text-red-300 transition-colors leading-none"
                aria-label={`Remove ${z}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder={constraints.excluded_zips.length === 0 ? 'Type a 5-digit ZIP and press Enter…' : 'Add another ZIP…'}
            value={zipInput}
            onChange={e => setZipInput(e.target.value)}
            onKeyDown={handleZipKey}
            onBlur={addZip}
            maxLength={5}
            className="flex-1 min-w-[180px] bg-transparent text-sm text-np-text placeholder:text-np-muted focus:outline-none"
          />
        </div>
      </div>

      {/* Address type priority */}
      <div>
        <label className="text-sm font-semibold text-np-text block mb-1">Address type priority</label>
        <p className="text-xs text-np-muted mb-3">Drag to reorder — top row = highest priority</p>
        <ul className="space-y-2">
          {constraints.priority_order.map((type, idx) => (
            <li
              key={type}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="flex items-center gap-3 bg-white border border-np-border rounded-xl px-4 py-2.5 cursor-grab active:cursor-grabbing hover:border-np-accent/50 hover:shadow-np transition-all select-none"
            >
              <span className="text-np-muted/50 text-lg leading-none">⠿</span>
              <span className="w-5 h-5 rounded-full bg-np-accent/10 text-np-accent text-xs font-bold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <span className="text-sm font-medium text-np-text capitalize">{type.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
