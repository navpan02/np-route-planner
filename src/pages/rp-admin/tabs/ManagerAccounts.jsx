import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import StatusBadge from '../../../components/rp/StatusBadge';

const EMPTY = { username: '', display_name: '', branch_id: '00000000-0000-0000-0000-000000000001' };

export default function ManagerAccounts({ session }) {
  const [managers, setManagers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm]         = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    supabase.from('portal_users').select('*').eq('role', 'branch_manager').order('display_name')
      .then(({ data }) => setManagers(data ?? []))
      .catch(err => console.error('Failed to load managers:', err));
    supabase.from('branches').select('id,name').eq('active', true)
      .then(({ data }) => setBranches(data ?? []))
      .catch(err => console.error('Failed to load branches:', err));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const { id, ...fields } = form;
    const payload = { ...fields, role: 'branch_manager', username: fields.username.trim().toLowerCase() };
    const op = id
      ? supabase.from('portal_users').update(payload).eq('id', id).select().single()
      : supabase.from('portal_users').insert(payload).select().single();
    const { data, error: err } = await op;
    setSaving(false);
    if (err) { setError(err.message); return; }
    setManagers(prev => id ? prev.map(m => m.id === id ? data : m) : [...prev, data]);
    setForm(null);
  };

  const toggle = async (mgr) => {
    const { error } = await supabase
      .from('portal_users').update({ active: !mgr.active }).eq('id', mgr.id);
    if (error) { console.error('Toggle failed:', error.message); return; }
    setManagers(prev => prev.map(m => m.id === mgr.id ? { ...m, active: !m.active } : m));
  };

  const branchName = (id) => branches.find(b => b.id === id)?.name ?? '—';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Manager Accounts</h2>
          <p className="text-xs text-gray-500 mt-0.5">Managers log in at <code className="font-mono">/rp-manager/login</code> using their username and the shared portal password.</p>
        </div>
        <button
          onClick={() => setForm({ ...EMPTY })}
          className="bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-800 transition-colors"
        >
          + Add Manager
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Username</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Display Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Branch</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {managers.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No manager accounts yet.</td></tr>
            )}
            {managers.map(mgr => (
              <tr key={mgr.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-700">{mgr.username}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{mgr.display_name}</td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{branchName(mgr.branch_id)}</td>
                <td className="px-4 py-3">
                  <StatusBadge active={mgr.active} inactiveLabel="Disabled" />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setForm({ ...mgr })} className="text-xs text-blue-600 hover:underline mr-3">Edit</button>
                  <button onClick={() => toggle(mgr)} className="text-xs text-gray-500 hover:underline">
                    {mgr.active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200">
              <h3 className="font-bold text-gray-900">{form.id ? 'Edit Manager' : 'Add Manager'}</h3>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Username *</label>
                <input
                  type="text" required
                  value={form.username ?? ''}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="e.g. manager_chicago"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">Lowercase, no spaces. This is what they type on the login page.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Display Name *</label>
                <input
                  type="text" required
                  value={form.display_name ?? ''}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
                  placeholder="e.g. Chicago Branch Manager"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Branch *</label>
                <select
                  value={form.branch_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setForm(null)} className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-green-700 text-white text-sm font-semibold py-2 rounded-lg hover:bg-green-800 disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
