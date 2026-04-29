import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DebugProvider } from './context/DebugContext';
import DebugPanel from './components/DebugPanel';
import AdminPortalLogin  from './pages/rp-admin/Login';
import AdminPortal       from './pages/rp-admin/Dashboard';
import ManagerPortalLogin from './pages/rp-manager/Login';
import ManagerPortal      from './pages/rp-manager/Dashboard';
import RouteView          from './pages/RouteView';

export default function App() {
  return (
    <BrowserRouter basename="/np-route-planner">
      <DebugProvider>
        <Routes>
          <Route path="/rp-admin/login"    element={<AdminPortalLogin />} />
          <Route path="/rp-admin/*"        element={<AdminPortal />} />
          <Route path="/rp-manager/login"  element={<ManagerPortalLogin />} />
          <Route path="/rp-manager/*"      element={<ManagerPortal />} />
          <Route path="/route-view/:token" element={<RouteView />} />
        </Routes>
        <DebugPanel />
      </DebugProvider>
    </BrowserRouter>
  );
}
