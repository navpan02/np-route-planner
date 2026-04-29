import PortalLogin from '../../components/rp/PortalLogin';

export default function ManagerPortalLogin() {
  return (
    <PortalLogin
      portal="manager"
      title="Manager Sign In"
      subtitle="Route Planner — Branch Manager"
      usernamePlaceholder="e.g. manager_chicago"
      helpText="Contact your admin if you need access."
    />
  );
}
