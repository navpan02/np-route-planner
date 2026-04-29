import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import PortalHeader from '../../components/rp/PortalHeader';
import PortalAuthGuard from '../../components/rp/PortalAuthGuard';
import TabBar from '../../components/rp/TabBar';

const TodaysRoutes    = lazy(() => import('./tabs/TodaysRoutes'));
const ConstraintsTab  = lazy(() => import('./tabs/ConstraintsTab'));
const AgentsTab       = lazy(() => import('./tabs/AgentsTab'));
const DrawRouteTab    = lazy(() => import('./tabs/DrawRouteTab'));
const RouteHistoryTab = lazy(() => import('./tabs/RouteHistoryTab'));

const TABS = [
  { id: 'routes',      label: "Today's Routes", icon: '🗺' },
  { id: 'draw',        label: 'Add/Edit Route',  icon: '✏️' },
  { id: 'history',     label: 'Route History',   icon: '📋' },
  { id: 'agents',      label: 'Agents',          icon: '👤' },
  { id: 'constraints', label: 'Constraints',     icon: '⚙️' },
];

export default function ManagerDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('routes');
  // Incrementing this key forces TodaysRoutes to remount and refetch after a save in DrawRouteTab
  const [routesKey, setRoutesKey] = useState(0);

  return (
    <PortalAuthGuard portal="manager">
      {(session) => (
        <div className="min-h-screen bg-gray-50 flex flex-col">
          <PortalHeader
            title={`Route Planner — ${session.branchName ?? 'Branch Manager'}`}
            session={session}
            portal="manager"
            onLogout={() => navigate('/rp-manager/login')}
          />

          <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

          {/* Tab content */}
          <div className="flex-1 overflow-auto">
            <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading…</div>}>
              {activeTab === 'routes'      && <TodaysRoutes    key={routesKey} session={session} />}
              {activeTab === 'draw'        && <DrawRouteTab    session={session} onRouteSaved={() => setRoutesKey(k => k + 1)} />}
              {activeTab === 'history'     && <RouteHistoryTab session={session} />}
              {activeTab === 'agents'      && <AgentsTab       session={session} />}
              {activeTab === 'constraints' && <ConstraintsTab  session={session} />}
            </Suspense>
          </div>
        </div>
      )}
    </PortalAuthGuard>
  );
}
