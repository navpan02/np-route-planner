import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabase';
import StatusBadge from '../../../components/rp/StatusBadge';

const EMPTY = { name: '', email: '', phone: '', start_address: '', branch_id: '00000000-0000-0000-0000-000000000001' };

export default function AgentRosterTab({ session }) {
  const [agents, setAgents]     = useState([]);
  const [branches, setBranches] = useState([]);
  const [form, setForm]         = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState('');

  const client = session?.portalClient ?? supabase;

  useEffect(() => {
    setLoading(true);
    Promise.all([
      client.from('agents').select('*').order('name'),
      client.from('branches').select('id,name').eq('active', true),
    ]).then(([agentsRes, branchesRes]) => {
      if (agentsRes.error) setLoadError(`Agents: ${agentsRes.error.message}`);
      else setAgents(agentsRes.data ?? []);
      if (branchesRes.error && !agentsRes.error) setLoadError(`Branches: ${branchesRes.error.message}`);
      else setBranches(branchesRes.data ?? []);
      setLoading(false);
    }).catch(err => {
      setLoadError(err?.message ?? 'Failed to load data');
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const { id, ...fields } = form;
    const op = id
      ? client.from('agents').update(fields).eq('id', id).select().single()
      : client.from('agents').insert(fields).select().single();
    const { data, error: err } = await op;
    setSaving(false);
    if (err) { setError(err.message); return; }
    setAgents(prev => id ? prev.map(a => a.id === id ? data : a) : [...prev, data]);
    setForm(null);
  };

  const toggle = async (agent) => {
    const { error } = await client
      .from('agents').update({ active: !agent.active }).eq('id', agent.id);
    if (error) { console.error('Toggle failed:', error.message); return; }
    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, active: !a.active } : a));
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-900">Agent Roster</h2>
        <button
          onClick={() => setForm({ ...EMPTY })}
          className="bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-800 transition-colors"
        >
          + Add Agent
        </button>
      </div>

      {loadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Loading agents…</div>
        ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">Start Address</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No agents yet. Add one above.</td></tr>
            )}
            {agents.map(agent => (
              <tr key={agent.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{agent.name}</td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{agent.email ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 hidden lg:table-cell truncate max-w-xs">{agent.start_address ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge active={agent.active} /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setForm({ ...agent })} className="text-xs text-blue-600 hover:underline mr-3">Edit</button>
                  <button onClick={() => toggle(agent)} className="text-xs text-gray-500 hover:underline">
                    {agent.active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {form && createPortal(
        <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200">
              <h3 className="font-bold text-gray-900">{form.id ? 'Edit Agent' : 'Add Agent'}</h3>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              {[
                { key: 'name', label: 'Name', required: true },
                { key: 'email', label: 'Email' },
                { key: 'phone', label: 'Phone' },
                { key: 'start_address', label: 'Start Address' },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">{label}{required && ' *'}</label>
                  <input
                    type="text" required={required}
                    value={form[key] ?? ''}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Branch</label>
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
        </div>,
        document.body
      )}
    </div>
  );
}
