import { useState, lazy, Suspense, Component } from 'react';
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

class TabErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidUpdate(prev) {
    if (prev.tabId !== this.props.tabId) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-8 max-w-2xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
            <p className="font-bold text-red-800 mb-2">This tab failed to load</p>
            <pre className="text-red-700 text-xs whitespace-pre-wrap overflow-auto max-h-48">
              {this.state.error?.message}
            </pre>
            <button
              className="mt-4 px-4 py-2 bg-red-600 text-white text-sm rounded-lg"
              onClick={() => this.setState({ error: null })}
            >Retry</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
            <TabErrorBoundary tabId={activeTab}>
              <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading…</div>}>
                {activeTab === 'planner'  && <RoutePlannerTab session={session} />}
                {activeTab === 'agents'   && <AgentRosterTab  session={session} />}
                {activeTab === 'branches' && <BranchesTab     session={session} />}
                {activeTab === 'managers' && <ManagerAccounts session={session} />}
              </Suspense>
            </TabErrorBoundary>
          </div>
        </div>
      )}
    </PortalAuthGuard>
  );
}
