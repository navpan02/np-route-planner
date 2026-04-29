export default function StatusBadge({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
      active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}
