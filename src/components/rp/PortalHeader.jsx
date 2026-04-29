import { portalLogout } from '../../lib/portalAuth';

export default function PortalHeader({ title, session, portal, onLogout }) {
  const handleLogout = () => {
    portalLogout(portal);
    onLogout?.();
    window.location.href = `/NP02/rp-${portal}/login`;
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
            <path d="M12 22V12M12 12C12 7 7 3 2 4c0 5 4 9 10 8zM12 12c0-5 5-9 10-8-1 5-5 9-10 8z"/>
          </svg>
        </div>
        <div>
          <span className="text-sm font-bold text-gray-900 leading-none block">NPLawn</span>
          <span className="text-xs text-gray-500 leading-none">{title}</span>
        </div>
      </div>

      {session && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 hidden sm:block">{session.displayName}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-red-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50 border border-gray-200 hover:border-red-200"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
