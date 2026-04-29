import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.min.js';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

// Fix Leaflet's default icon paths broken by bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Agent colours (up to 10 agents)
const AGENT_COLOURS = [
  '#16a34a', // green
  '#2563eb', // blue
  '#ea580c', // orange
  '#7c3aed', // purple
  '#dc2626', // red
  '#0891b2', // teal
  '#d97706', // amber
  '#db2777', // pink
  '#65a30d', // lime
  '#9333ea', // violet
];

// Address type marker colours (WI #31)
const TYPE_COLOURS = {
  homeowner:        '#16a34a', // green
  new_construction: '#2563eb', // blue
  renter:           '#f59e0b', // yellow
  multi_family:     '#8b5cf6', // purple
  commercial:       '#ea580c', // orange
  vacant:           '#94a3b8', // grey
};
const UNKNOWN_TYPE_COLOUR = '#475569'; // dark grey for unmapped types

function typeColour(type) {
  return TYPE_COLOURS[type] ?? UNKNOWN_TYPE_COLOUR;
}

function createPinIcon(colour, label) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${colour};
      color:#fff;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      width:28px;height:28px;
      display:flex;align-items:center;justify-content:center;
      border:2px solid rgba(0,0,0,0.25);
      font-size:10px;font-weight:700;
    "><span style="transform:rotate(45deg)">${label}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

/** Larger, highlighted icon for the currently-selected unassigned stop */
function createHighlightedPinIcon(colour) {
  return L.divIcon({
    className: '',
    html: `<div style="position:relative;width:36px;height:36px">
      <div style="
        position:absolute;
        width:54px;height:54px;
        border-radius:50%;
        border:2.5px solid ${colour};
        opacity:0.35;
        top:-9px;left:-9px;
        pointer-events:none;
      "></div>
      <div style="
        background:${colour};
        color:#fff;
        border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        width:36px;height:36px;
        display:flex;align-items:center;justify-content:center;
        border:3px solid rgba(255,255,255,0.9);
        font-size:13px;font-weight:700;
        box-shadow:0 4px 16px rgba(239,68,68,0.55);
      "><span style="transform:rotate(45deg)">!</span></div>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -40],
  });
}

/** Compute convex hull (Graham scan) for cluster polygon */
function convexHull(points) {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

/** Auto-fit map bounds to all stops (only on first mount) */
function FitBounds({ routes }) {
  const map = useMap();
  useEffect(() => {
    if (!routes || routes.length === 0) return;
    const allStops = routes.flatMap(r => r.stop_sequence);
    if (allStops.length === 0) return;
    const bounds = L.latLngBounds(allStops.map(s => [s.lat, s.lng]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — only fit on first mount, not on colourMode change
  return null;
}

/** Reset-zoom button — fits all visible points into view */
function ResetZoomControl({ routes, allAddresses, drawMode }) {
  const map = useMap();
  const handleReset = () => {
    const points = drawMode
      ? allAddresses.filter(a => a.lat != null && a.lng != null).map(a => [a.lat, a.lng])
      : routes.flatMap(r => r.stop_sequence).filter(s => s.lat && s.lng).map(s => [s.lat, s.lng]);
    if (!points.length) return;
    const bounds = L.latLngBounds(points);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
  };
  return (
    <div className="leaflet-top leaflet-right" style={{ marginTop: 10, marginRight: 10 }}>
      <div className="leaflet-control">
        <button
          onClick={handleReset}
          title="Reset zoom to fit all stops"
          style={{
            background: '#fff', border: '2px solid rgba(0,0,0,0.2)', borderRadius: 4,
            padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            color: '#333', boxShadow: '0 1px 5px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
          }}
        >
          ⤢ Fit All
        </button>
      </div>
    </div>
  );
}

const LEGEND_STYLE = `
  background:rgba(255,255,255,0.95);
  padding:8px 12px;
  border-radius:10px;
  box-shadow:0 2px 8px rgba(0,0,0,0.18);
  font-size:11px;
  line-height:1.7;
  min-width:140px;
`;

const DOT_STYLE = 'width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0;';
const ROW_STYLE = 'display:flex;align-items:center;gap:6px;';

/** Leaflet legend control — bottom-left, updates when colourMode changes */
function MapLegend({ colourMode, routes }) {
  const map = useMap();

  useEffect(() => {
    const control = L.control({ position: 'bottomleft' });

    control.onAdd = () => {
      const div = L.DomUtil.create('div');
      div.setAttribute('style', LEGEND_STYLE);
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);

      if (colourMode === 'type') {
        const entries = [
          ...Object.entries(TYPE_COLOURS),
          ['unknown', UNKNOWN_TYPE_COLOUR],
        ];
        div.innerHTML =
          `<strong style="display:block;margin-bottom:4px;font-size:12px;">Address Type</strong>` +
          entries.map(([type, colour]) =>
            `<div style="${ROW_STYLE}">
              <span style="${DOT_STYLE}background:${colour};"></span>
              <span>${type.replace(/_/g, '\u00A0').replace(/\b\w/g, c => c.toUpperCase())}</span>
            </div>`
          ).join('');
      } else {
        // Agent mode
        div.innerHTML =
          `<strong style="display:block;margin-bottom:4px;font-size:12px;">Agent</strong>` +
          routes.map((r, i) =>
            `<div style="${ROW_STYLE}">
              <span style="${DOT_STYLE}background:${AGENT_COLOURS[i % AGENT_COLOURS.length]};"></span>
              <span>${r.agent_name}</span>
            </div>`
          ).join('');
      }

      return div;
    };

    control.addTo(map);
    return () => control.remove();
  }, [colourMode, routes, map]);

  return null;
}

/**
 * Renders the currently-selected unassigned pin with a highlighted icon.
 * Flies the map to the stop and auto-opens its popup.
 */
function SelectedUnassignedMarker({ stop, routes, onUnassignedClick, onUnassignedDrop }) {
  const markerRef = useRef(null);
  const map = useMap();

  useEffect(() => {
    // Fly to the stop (preserve zoom if already zoomed in)
    map.flyTo([stop.lat, stop.lng], Math.max(map.getZoom(), 15), { animate: true, duration: 0.7 });
    // Open popup after the fly animation settles
    const t = setTimeout(() => { markerRef.current?.openPopup(); }, 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.unique_id]);

  return (
    <Marker
      ref={markerRef}
      position={[stop.lat, stop.lng]}
      icon={createHighlightedPinIcon('#ef4444')}
      draggable={!!onUnassignedDrop}
      eventHandlers={{
        click: () => onUnassignedClick?.(stop),
        dragend: (e) => {
          const latlng = e.target.getLatLng();
          const agentId = nearestAgentForDrop(latlng, routes);
          if (agentId) onUnassignedDrop?.(stop, agentId);
        },
      }}
    >
      <Popup>
        <div className="route-map-popup">
          <strong style={{ color: '#ef4444' }}>UNASSIGNED — SELECTED</strong>
          <br />
          {stop.address}, {stop.city}, {stop.state} {stop.zip}
          <br />
          <small style={{ color: typeColour(stop.address_type) }}>
            {(stop.address_type ?? 'unknown').replace(/_/g, '\u00A0')}
          </small>
          <br />
          <small style={{ color: '#94a3b8' }}>Drag onto a route, or use the panel to assign</small>
        </div>
      </Popup>
    </Marker>
  );
}

/** Find the agent whose nearest cluster centroid is closest to a given latlng */
function nearestAgentForDrop(latlng, routes) {
  let minDist = Infinity;
  let best = routes[0]?.agent_id ?? null;
  for (const route of routes) {
    for (const cluster of (route.clusters ?? [])) {
      const d = (latlng.lat - cluster.center.lat) ** 2 + (latlng.lng - cluster.center.lng) ** 2;
      if (d < minDist) { minDist = d; best = route.agent_id; }
    }
  }
  return best;
}

// ── Draw-mode controller ──────────────────────────────────────────────────────
function DrawController({ onShapeComplete }) {
  const map = useMap();

  useEffect(() => {
    if (!map.pm) return;

    map.pm.addControls({
      position: 'topleft',
      drawCircle: true, drawPolygon: true,
      drawMarker: false, drawPolyline: false, drawRectangle: false,
      drawText: false, editMode: true, dragMode: false,
      cutPolygon: false, removalMode: false,
    });

    let currentLayer = null;

    const handleCreate = (e) => {
      if (currentLayer) map.removeLayer(currentLayer);
      currentLayer = e.layer;
      const type = e.shape?.toLowerCase();
      if (type === 'circle') {
        const c = e.layer.getLatLng();
        onShapeComplete({ type: 'circle', center: { lat: c.lat, lng: c.lng }, radiusM: e.layer.getRadius() });
      } else {
        const ring = e.layer.getLatLngs()[0].map(ll => ({ lat: ll.lat, lng: ll.lng }));
        onShapeComplete({ type: 'polygon', ring });
      }
    };

    const handleEdit = (e) => {
      const layer = e.layer;
      if (layer.getRadius) {
        const c = layer.getLatLng();
        onShapeComplete({ type: 'circle', center: { lat: c.lat, lng: c.lng }, radiusM: layer.getRadius() });
      } else {
        const ring = layer.getLatLngs()[0].map(ll => ({ lat: ll.lat, lng: ll.lng }));
        onShapeComplete({ type: 'polygon', ring });
      }
    };

    map.on('pm:create', handleCreate);
    map.on('pm:edit', handleEdit);

    return () => {
      map.pm.removeControls();
      map.off('pm:create', handleCreate);
      map.off('pm:edit', handleEdit);
      if (currentLayer) map.removeLayer(currentLayer);
    };
  }, [map, onShapeComplete]);

  return null;
}

export default function RouteMap({
  result,
  // legacy prop aliases kept for backward compat
  routes: routesProp,
  unassigned = [],
  colourMode = 'agent',
  selectedUnassignedId,
  onUnassignedClick,
  onUnassignedDrop,
  // draw-mode props
  drawMode = false,
  allAddresses = [],
  shapeAddresses = [],
  onShapeComplete,
  onAddressClick,
}) {
  // Accept either result.routes or direct routes prop
  const routes = result?.routes ?? routesProp ?? [];

  if (!drawMode && (!routes || routes.length === 0)) {
    return (
      <div className="route-map-empty">
        <p>No routes to display.</p>
      </div>
    );
  }

  const mapCenter = drawMode && allAddresses.length
    ? [allAddresses[0].lat ?? 41.88, allAddresses[0].lng ?? -87.63]
    : [41.88, -87.63];

  return (
    <MapContainer
      center={mapCenter}
      zoom={11}
      style={{ height: drawMode ? '100%' : '600px', minHeight: '400px', width: '100%', borderRadius: drawMode ? '0' : '8px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {!drawMode && <FitBounds routes={routes} />}
      {drawMode && onShapeComplete && <DrawController onShapeComplete={onShapeComplete} />}
      <ResetZoomControl routes={routes} allAddresses={allAddresses} drawMode={drawMode} />

      {/* In draw mode: render all addresses as background pins, shape-selected highlighted */}
      {drawMode && allAddresses.map(addr => {
        if (!addr.lat || !addr.lng) return null;
        const inShape  = shapeAddresses.some(s => s.id === addr.id);
        const isDnk    = addr.address_type === 'do_not_knock';
        const isAssigned = addr.status === 'assigned';
        let colour, opacity, label;
        if (isDnk)        { colour = '#94a3b8'; opacity = 0.4;  label = '✕'; }
        else if (inShape) { colour = '#16a34a'; opacity = 1;    label = ''; }
        else if (isAssigned) { colour = '#0891b2'; opacity = 0.7; label = '✓'; }
        else              { colour = '#f97316'; opacity = 0.75; label = ''; }
        return (
          <Marker
            key={addr.id}
            position={[addr.lat, addr.lng]}
            icon={createPinIcon(colour, label)}
            opacity={opacity}
            eventHandlers={{ click: () => !isDnk && onAddressClick?.(addr) }}
          >
            <Popup>
              <div style={{ fontSize: 12 }}>
                <strong>{addr.address}</strong><br />
                <span style={{ color: '#6b7280' }}>{addr.address_type?.replace(/_/g,' ')}</span>
                {isDnk      && <div style={{ color: '#94a3b8', marginTop: 4 }}>⛔ Do Not Knock</div>}
                {isAssigned && !isDnk && <div style={{ color: '#0891b2', marginTop: 4 }}>✓ Already assigned</div>}
                {!isDnk && !isAssigned && <div style={{ color: '#6b7280', marginTop: 4 }}>{inShape ? 'Click to remove' : 'Click to add'}</div>}
              </div>
            </Popup>
          </Marker>
        );
      })}
      {!drawMode && <>
        <FitBounds routes={routes} />
        <MapLegend colourMode={colourMode} routes={routes} />
      </>}

      {!drawMode && routes.map((route, agentIdx) => {
        const agentColour = AGENT_COLOURS[agentIdx % AGENT_COLOURS.length];

        return (
          <span key={route.agent_id ?? agentIdx}>
            {/* Drive route — dashed polyline between cluster centroids (always agent-coloured) */}
            {(route.clusters ?? []).length > 1 && (
              <Polyline
                positions={(route.clusters ?? []).map(c => [c.center?.lat, c.center?.lng]).filter(p => p[0] != null)}
                pathOptions={{ color: agentColour, weight: 2, dashArray: '6 4', opacity: 0.7 }}
              />
            )}

            {(route.clusters ?? []).map(cluster => {
              const stops = cluster.stops ?? [];
              const hullPts = convexHull(stops.map(s => [s.lat, s.lng]));
              const walkPath = stops.map(s => [s.lat, s.lng]);

              return (
                <span key={cluster.id}>
                  {/* Cluster convex hull polygon — always agent-coloured per AC */}
                  {hullPts.length >= 3 && (
                    <Polygon
                      positions={hullPts}
                      pathOptions={{
                        color: agentColour,
                        fillColor: agentColour,
                        fillOpacity: 0.08,
                        weight: 1,
                      }}
                    />
                  )}

                  {/* Walk route — solid polyline within cluster (always agent-coloured) */}
                  {walkPath.length > 1 && (
                    <Polyline
                      positions={walkPath}
                      pathOptions={{ color: agentColour, weight: 1.5, opacity: 0.5 }}
                    />
                  )}

                  {/* Stop pins — colour depends on colourMode */}
                  {stops.map(stop => {
                    const pinColour = colourMode === 'type'
                      ? typeColour(stop.address_type)
                      : agentColour;
                    return (
                      <Marker
                        key={stop.unique_id}
                        position={[stop.lat, stop.lng]}
                        icon={createPinIcon(pinColour, stop.stop_order ?? '?')}
                      >
                        <Popup>
                          <div className="route-map-popup">
                            <strong>#{stop.stop_order}</strong>
                            {' '}—{' '}
                            <span style={{ color: typeColour(stop.address_type), fontWeight: 600 }}>
                              {(stop.address_type ?? 'unknown').replace(/_/g, '\u00A0')}
                            </span>
                            <br />
                            {stop.address}, {stop.city}, {stop.state} {stop.zip}
                            <br />
                            <small>Cluster: {stop.cluster_id} · Agent: {route.agent_name}</small>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </span>
              );
            })}
          </span>
        );
      })}

      {/* Unassigned stops — red, draggable, click/drop to assign (non-draw mode) */}
      {!drawMode && unassigned.map(stop => {
        if (!stop.lat || !stop.lng) return null;

        // Selected stop gets the highlighted icon + fly-to + auto-popup
        if (stop.unique_id === selectedUnassignedId) {
          return (
            <SelectedUnassignedMarker
              key={stop.unique_id}
              stop={stop}
              routes={routes}
              onUnassignedClick={onUnassignedClick}
              onUnassignedDrop={onUnassignedDrop}
            />
          );
        }

        return (
          <Marker
            key={stop.unique_id}
            position={[stop.lat, stop.lng]}
            icon={createPinIcon('#ef4444', '!')}
            draggable={!!onUnassignedDrop}
            eventHandlers={{
              click: () => onUnassignedClick?.(stop),
              dragend: (e) => {
                const latlng = e.target.getLatLng();
                const agentId = nearestAgentForDrop(latlng, routes);
                if (agentId) onUnassignedDrop?.(stop, agentId);
              },
            }}
          >
            <Popup>
              <div className="route-map-popup">
                <strong style={{ color: '#ef4444' }}>UNASSIGNED</strong>
                <br />
                {stop.address}, {stop.city}, {stop.state} {stop.zip}
                <br />
                <small style={{ color: typeColour(stop.address_type) }}>
                  {(stop.address_type ?? 'unknown').replace(/_/g, '\u00A0')}
                </small>
                <br />
                <small style={{ color: '#94a3b8' }}>Click pin or drag onto a route to assign</small>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
