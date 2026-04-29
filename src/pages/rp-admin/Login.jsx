import PortalLogin from '../../components/rp/PortalLogin';

export default function AdminPortalLogin() {
  return (
    <PortalLogin
      portal="admin"
      title="Admin Sign In"
      subtitle="Route Planner — Admin"
      usernamePlaceholder="admin2"
    />
  );
}
