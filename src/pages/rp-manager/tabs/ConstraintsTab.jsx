import { useState, useEffect } from 'react';
import ConstraintPanel, { DEFAULT_CONSTRAINTS } from '../../../components/ConstraintPanel';

function constraintKey(branchId) {
  return `branch_constraints_${branchId}`;
}

export default function ConstraintsTab({ session }) {
  const [constraints, setConstraints] = useState(DEFAULT_CONSTRAINTS);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(constraintKey(session.branchId));
      if (raw) {
        const parsed = JSON.parse(raw);
        setConstraints({ ...DEFAULT_CONSTRAINTS, ...parsed });
      }
    } catch { /* ignore */ }
  }, [session.branchId]);

  const handleSave = () => {
    setSaving(true); setSaved(false);
    localStorage.setItem(constraintKey(session.branchId), JSON.stringify(constraints));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleReset = () => {
    localStorage.removeItem(constraintKey(session.branchId));
    setConstraints(DEFAULT_CONSTRAINTS);
    setSaved(false);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Branch Constraints</h2>
          <p className="text-xs text-gray-500 mt-0.5">These defaults apply to all new route runs for your branch.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-red-500 underline"
          >
            Reset to defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-800 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <ConstraintPanel constraints={constraints} onChange={setConstraints} />
      </div>
    </div>
  );
}
