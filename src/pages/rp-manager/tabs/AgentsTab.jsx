import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import ConstraintPanel, { DEFAULT_CONSTRAINTS } from '../../../components/ConstraintPanel';
import StatusBadge from '../../../components/rp/StatusBadge';

const AGENT_FIELDS = [
  { key: 'name',          label: 'Name',          required: true },
  { key: 'email',         label: 'Email' },
  { key: 'phone',         label: 'Phone' },
  { key: 'start_address', label: 'Start Address' },
];

function agentConstraintKey(agentId) {
  return `agent_constraints_${agentId}`;
}

function loadAgentConstraints(agentId) {
  try {
    const raw = localStorage.getItem(agentConstraintKey(agentId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveAgentConstraints(agentId, constraints) {
  localStorage.setItem(agentConstraintKey(agentId), JSON.stringify(constraints));
}

export default function AgentsTab({ session }) {
  const [agents, setAgents]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [form, setForm]             = useState(null);
  const [conAgent, setConAgent]     = useState(null);
  const [constraints, setConstraints] = useState(DEFAULT_CONSTRAINTS);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [conSaved, setConSaved]     = useState(false);
  const [constraintVersion, setConstraintVersion] = useState(0);

  // Re-computed only when agents list or a save happens — avoids localStorage reads in render
  const agentsWithConstraints = useMemo(
    () => new Set(agents.filter(a => loadAgentConstraints(a.id)).map(a => a.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agents, constraintVersion],
  );

  useEffect(() => {
    loadAgents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAgents = async () => {
    setLoading(true);
    // Try branch-scoped first; fall back to all agents if branch_id column missing
    let { data, error: err } = await supabase
      .from('agents').select('*').eq('active', true).order('name');
    if (err) ({ data } = await supabase.from('agents').select('*').order('name'));
    setAgents(data ?? []);
    setLoading(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const { id, ...fields } = form;
    // Only include branch_id if we have one — avoids column-not-found errors
    const payload = session.branchId
      ? { ...fields, branch_id: session.branchId }
      : fields;
    const op = id
      ? supabase.from('agents').update(payload).eq('id', id).select().single()
      : supabase.from('agents').insert(payload).select().single();
    const { data, error: err } = await op;
    setSaving(false);
    if (err) { setError(err.message); return; }
    setAgents(prev => id ? prev.map(a => a.id === id ? data : a) : [...prev, data]);
    setForm(null);
  };

  const toggle = async (agent) => {
    const { data } = await supabase
      .from('agents').update({ active: !agent.active }).eq('id', agent.id).select().single();
    setAgents(prev => prev.map(a => a.id === agent.id ? (data ?? { ...a, active: !a.active }) : a));
  };

  const openConstraints = (agent) => {
    const saved = loadAgentConstraints(agent.id);
    setConstraints(saved ? { ...DEFAULT_CONSTRAINTS, ...saved } : DEFAULT_CONSTRAINTS);
    setConAgent(agent);
    setConSaved(false);
  };

  const saveConstraints = () => {
    if (!conAgent) return;
    saveAgentConstraints(conAgent.id, constraints);
    setConstraintVersion(v => v + 1);
    setConSaved(true);
    setTimeout(() => { setConSaved(false); setConAgent(null); }, 1200);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-900">My Agents</h2>
        <button
          onClick={() => setForm({ name: '', email: '', phone: '', start_address: '' })}
          className="bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-800 transition-colors"
        >
          + Add Agent
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Loading agents…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No agents yet. Add one above.</td></tr>
              )}
              {agents.map(agent => (
                <tr key={agent.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{agent.name}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{agent.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge active={agent.active} />
                    {agentsWithConstraints.has(agent.id) && (
                      <span className="ml-2 text-[10px] text-blue-600 font-semibold bg-blue-50 px-1.5 py-0.5 rounded">custom limits</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openConstraints(agent)} className="text-xs text-blue-600 hover:underline mr-3">Limits</button>
                    <button onClick={() => setForm({ ...agent })} className="text-xs text-gray-600 hover:underline mr-3">Edit</button>
                    <button onClick={() => toggle(agent)} className="text-xs text-gray-400 hover:underline">
                      {agent.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit agent modal */}
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200">
              <h3 className="font-bold text-gray-900">{form.id ? 'Edit Agent' : 'Add Agent'}</h3>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              {AGENT_FIELDS.map(({ key, label, required }) => (
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

      {/* Per-agent constraints modal */}
      {conAgent && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-bold text-gray-900">Route Limits — {conAgent.name}</h3>
                <p className="text-xs text-gray-500 mt-0.5">These override branch defaults for this agent only.</p>
              </div>
              <button
                onClick={() => { saveAgentConstraints(conAgent.id, DEFAULT_CONSTRAINTS); setConstraints(DEFAULT_CONSTRAINTS); setConSaved(true); setTimeout(() => { setConSaved(false); setConAgent(null); }, 1200); }}
                className="text-xs text-gray-400 hover:text-red-500 underline ml-4"
              >
                Reset to defaults
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              <ConstraintPanel constraints={constraints} onChange={setConstraints} />
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 flex-shrink-0">
              <button onClick={() => setConAgent(null)} className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={saveConstraints}
                className="flex-1 bg-green-700 text-white text-sm font-semibold py-2 rounded-lg hover:bg-green-800 transition-colors"
              >
                {conSaved ? '✓ Saved' : 'Save Limits'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
