import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { portalLogin } from '../../lib/portalAuth';

const Logo = () => (
  <div className="w-10 h-10 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0">
    <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
      <path d="M12 22V12M12 12C12 7 7 3 2 4c0 5 4 9 10 8zM12 12c0-5 5-9 10-8-1 5-5 9-10 8z"/>
    </svg>
  </div>
);

export default function PortalLogin({ portal, title, subtitle, usernamePlaceholder, helpText }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await portalLogin(username.trim(), password, portal);
      navigate(`/rp-${portal}/dashboard`, { replace: true });
    } catch (err) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Logo />
          <div>
            <div className="text-base font-bold text-gray-900 leading-none">NPLawn</div>
            <div className="text-xs text-gray-500">{subtitle}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-6 text-center">{title}</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text" autoComplete="username" required
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder={usernamePlaceholder}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password" autoComplete="current-password" required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit" disabled={loading}
              className="w-full bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {helpText && (
          <p className="text-center text-xs text-gray-400 mt-6">{helpText}</p>
        )}
      </div>
    </div>
  );
}
