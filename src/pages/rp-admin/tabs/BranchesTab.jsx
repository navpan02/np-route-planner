import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabase';
import StatusBadge from '../../../components/rp/StatusBadge';

const DEFAULT_BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const TIMEZONES = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Phoenix'];
const EMPTY = { name: '', timezone: 'America/Chicago', zip_codes: [] };

export default function BranchesTab({ session }) {
  const [branches, setBranches] = useState([]);
  const [form, setForm]         = useState(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [zipInput, setZipInput] = useState('');
  const zipRef = useRef(null);

  useEffect(() => {
    supabase.from('branches').select('*').order('name')
      .then(({ data }) => setBranches(data ?? []))
      .catch(err => console.error('Failed to load branches:', err));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    const { id, ...fields } = form;
    const op = id
      ? supabase.from('branches').update(fields).eq('id', id).select().single()
      : supabase.from('branches').insert(fields).select().single();
    const { data, error: err } = await op;
    setSaving(false);
    if (err) { setError(err.message); return; }
    setBranches(prev => id ? prev.map(b => b.id === id ? data : b) : [...prev, data]);
    setForm(null);
  };

  const toggle = async (branch) => {
    const { error } = await supabase
      .from('branches').update({ active: !branch.active }).eq('id', branch.id);
    if (error) { console.error('Toggle failed:', error.message); return; }
    setBranches(prev => prev.map(b => b.id === branch.id ? { ...b, active: !b.active } : b));
  };

  const addZip = () => {
    const raw = zipInput.trim();
    // Accept 5-digit or zip+4; normalise to 5-digit
    const zip = raw.split('-')[0].replace(/\D/g, '').slice(0, 5);
    if (zip.length !== 5) return;
    if (form.zip_codes.includes(zip)) { setZipInput(''); return; }
    setForm(f => ({ ...f, zip_codes: [...f.zip_codes, zip].sort() }));
    setZipInput('');
    zipRef.current?.focus();
  };

  const removeZip = (zip) => {
    setForm(f => ({ ...f, zip_codes: f.zip_codes.filter(z => z !== zip) }));
  };

  const handleZipKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addZip(); }
    if (e.key === 'Backspace' && zipInput === '' && form.zip_codes.length > 0) {
      removeZip(form.zip_codes[form.zip_codes.length - 1]);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-900">Branches</h2>
        <button
          onClick={() => { setForm({ ...EMPTY }); setZipInput(''); }}
          className="bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-800 transition-colors"
        >
          + Add Branch
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Branch Name</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden sm:table-cell">Timezone</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">ZIP Codes</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {branches.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No branches found.</td></tr>
            )}
            {branches.map(branch => (
              <tr key={branch.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{branch.name}</td>
                <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{branch.timezone}</td>
                <td className="px-4 py-3 hidden md:table-cell">
                  {(branch.zip_codes ?? []).length === 0
                    ? <span className="text-gray-400 text-xs italic">All ZIPs</span>
                    : (
                      <div className="flex flex-wrap gap-1">
                        {(branch.zip_codes ?? []).slice(0, 6).map(z => (
                          <span key={z} className="bg-blue-50 text-blue-700 text-xs font-mono px-1.5 py-0.5 rounded">{z}</span>
                        ))}
                        {(branch.zip_codes ?? []).length > 6 && (
                          <span className="text-gray-400 text-xs">+{(branch.zip_codes ?? []).length - 6} more</span>
                        )}
                      </div>
                    )
                  }
                </td>
                <td className="px-4 py-3"><StatusBadge active={branch.active} /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => { setForm({ ...branch, zip_codes: branch.zip_codes ?? [] }); setZipInput(''); }}
                    className="text-xs text-blue-600 hover:underline mr-3"
                  >Edit</button>
                  {branch.id !== DEFAULT_BRANCH_ID && (
                    <button onClick={() => toggle(branch)} className="text-xs text-gray-500 hover:underline">
                      {branch.active ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && createPortal(
        <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
              <div className="p-6 border-b border-gray-200">
                <h3 className="font-bold text-gray-900">{form.id ? 'Edit Branch' : 'Add Branch'}</h3>
              </div>
              <form onSubmit={save} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Branch Name *</label>
                  <input
                    type="text" required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Timezone</label>
                  <select
                    value={form.timezone}
                    onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Service ZIP Codes
                    <span className="font-normal text-gray-400 ml-1">— leave empty to allow all ZIPs</span>
                  </label>
                  <div
                    className="min-h-[42px] w-full border border-gray-300 rounded-lg px-2 py-1.5 flex flex-wrap gap-1 cursor-text focus-within:ring-2 focus-within:ring-green-500"
                    onClick={() => zipRef.current?.focus()}
                  >
                    {form.zip_codes.map(zip => (
                      <span
                        key={zip}
                        className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-mono px-2 py-0.5 rounded-full"
                      >
                        {zip}
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); removeZip(zip); }}
                          className="text-green-600 hover:text-green-900 leading-none"
                        >×</button>
                      </span>
                    ))}
                    <input
                      ref={zipRef}
                      type="text"
                      value={zipInput}
                      onChange={e => setZipInput(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      onKeyDown={handleZipKey}
                      onBlur={addZip}
                      placeholder={form.zip_codes.length === 0 ? 'Type a ZIP and press Enter…' : ''}
                      className="outline-none text-sm flex-1 min-w-[120px] bg-transparent py-0.5"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Enter 5-digit ZIP codes. Press Enter or Tab to add each one.
                  </p>
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
