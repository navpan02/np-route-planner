import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import PortalHeader from '../../components/rp/PortalHeader';
import PortalAuthGuard from '../../components/rp/PortalAuthGuard';
import TabBar from '../../components/rp/TabBar';

const RoutePlannerTab  = lazy(() => import('./tabs/RoutePlannerTab'));
const ManagerAccounts  = lazy(() => import('./tabs/ManagerAccounts'));
const BranchesTab      = lazy(() => import('./tabs/BranchesTab'));
const AgentRosterTab   = lazy(() => import('./tabs/AgentRosterTab'));

const TABS = [
  { id: 'planner',  label: 'Route Planner', icon: '🗺' },
  { id: 'agents',   label: 'Agents',        icon: '👤' },
  { id: 'branches', label: 'Branches',      icon: '🏢' },
  { id: 'managers', label: 'Manager Accounts', icon: '🔑' },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('planner');

  return (
    <PortalAuthGuard portal="admin">
      {(session) => (
        <div className="min-h-screen bg-gray-50 flex flex-col">
          <PortalHeader
            title="Route Planner — Admin"
            session={session}
            portal="admin"
            onLogout={() => navigate('/rp-admin/login')}
          />

          <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

          {/* Tab content */}
          <div className="flex-1 overflow-auto">
            <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading…</div>}>
              {activeTab === 'planner'  && <RoutePlannerTab session={session} />}
              {activeTab === 'agents'   && <AgentRosterTab  session={session} />}
              {activeTab === 'branches' && <BranchesTab     session={session} />}
              {activeTab === 'managers' && <ManagerAccounts session={session} />}
            </Suspense>
          </div>
        </div>
      )}
    </PortalAuthGuard>
  );
}
