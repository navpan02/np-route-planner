import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const TYPE_ICONS = {
  homeowner: '🏠',
  new_construction: '🏗',
  renter: '🏘',
  multi_family: '🏢',
  commercial: '🏪',
  vacant: '📭',
};

function typeIcon(t) {
  return TYPE_ICONS[t] ?? '📍';
}

export default function RouteView() {
  const { token } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    supabase
      .from('route_assignments')
      .select('*, route_plans(plan_date)')
      .eq('view_token', token)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError('Route not found or the link has expired.');
        } else {
          setAssignment(data);
        }
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="rv-loading">
        <div className="rv-spinner" />
        <p>Loading your route…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rv-error">
        <p>{error}</p>
      </div>
    );
  }

  const stops = assignment.stop_sequence ?? [];
  const planDate = assignment.route_plans?.plan_date ?? '';
  const firstUrl = assignment.google_maps_urls?.[0];

  // Group stops by cluster_id
  const clusters = stops.reduce((acc, stop) => {
    const cid = stop.cluster_id ?? 'unknown';
    if (!acc[cid]) acc[cid] = [];
    acc[cid].push(stop);
    return acc;
  }, {});

  return (
    <div className="rv-page">
      {/* Header */}
      <div className="rv-header">
        <h1 className="rv-agent-name">{assignment.agent_name}</h1>
        <p className="rv-date">{planDate}</p>
        <div className="rv-meta">
          <span>{assignment.total_stops} stops</span>
          <span>·</span>
          <span>{Number(assignment.total_miles).toFixed(1)} miles</span>
          <span>·</span>
          <span>~{assignment.est_hours}h</span>
        </div>
        {firstUrl && (
          <a
            href={firstUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rv-open-maps-btn"
          >
            Open Full Route in Google Maps
          </a>
        )}
      </div>

      {/* Stop list grouped by cluster */}
      <div className="rv-stop-list">
        {Object.entries(clusters).map(([clusterId, clusterStops]) => (
          <div key={clusterId} className="rv-cluster">
            <div className="rv-cluster-label">Neighbourhood cluster {clusterId}</div>
            {clusterStops.map(stop => (
              <div key={stop.unique_id} className="rv-stop">
                <div className="rv-stop-left">
                  <span className="rv-stop-num">{stop.stop_order}</span>
                  <span className="rv-stop-icon">{typeIcon(stop.address_type)}</span>
                </div>
                <div className="rv-stop-body">
                  <p className="rv-stop-address">{stop.address}</p>
                  <p className="rv-stop-city">{stop.city}, {stop.state} {stop.zip}</p>
                  <p className="rv-stop-type">{stop.address_type?.replace(/_/g, ' ')}</p>
                </div>
                <a
                  href={`https://maps.google.com/maps?q=${stop.lat},${stop.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rv-navigate-btn"
                  aria-label="Navigate to this stop"
                >
                  Navigate
                </a>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
