import { useState } from 'react';
import { useDebug } from '../context/DebugContext';

export default function DebugPanel() {
  const { entries, setEntries, enabled } = useDebug();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  if (!enabled) return null;

  const serializeError = (detail) => {
    try {
      return JSON.stringify(detail, Object.getOwnPropertyNames(detail ?? {}), 2);
    } catch {
      return String(detail);
    }
  };

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 99999,
      background: '#1a1a2e', color: '#e0e0e0', fontFamily: 'monospace', fontSize: '12px',
      borderTop: '2px solid #ff6b35', boxShadow: '0 -2px 10px rgba(0,0,0,0.5)',
    }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 12px', background: '#0f0f1e',
          borderBottom: collapsed ? 'none' : '1px solid #333', cursor: 'pointer',
        }}
      >
        <span style={{ color: '#ff6b35', fontWeight: 'bold' }}>
          {'🐛 DEBUG'}
          {entries.length > 0 && (
            <span style={{ color: '#ffa500', marginLeft: 6 }}>({entries.length} error{entries.length !== 1 ? 's' : ''})</span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
          {!collapsed && entries.length > 0 && (
            <button
              onClick={() => { setEntries([]); setExpandedId(null); }}
              style={{
                background: '#333', border: 'none', color: '#ccc',
                cursor: 'pointer', padding: '2px 8px', borderRadius: 3, fontSize: 11,
              }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            style={{ background: 'none', border: 'none', color: '#ff6b35', cursor: 'pointer', fontSize: 14 }}
          >
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
          {entries.length === 0 ? (
            <div style={{ padding: '8px 12px', color: '#888' }}>No errors captured. Errors logged via window.__nplawnDebug.log(source, error) will appear here.</div>
          ) : (
            entries.map(e => (
              <div key={e.id} style={{ borderBottom: '1px solid #2a2a3e', padding: '4px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#888', flexShrink: 0 }}>{e.ts}</span>
                  <span style={{ color: '#ff6b35', flexShrink: 0 }}>[{e.source}]</span>
                  <span style={{ color: '#f0f0f0', flex: 1, wordBreak: 'break-word' }}>{e.message}</span>
                  <button
                    onClick={() => setExpandedId(prev => prev === e.id ? null : e.id)}
                    style={{
                      background: 'none', border: '1px solid #444', color: '#aaa',
                      cursor: 'pointer', padding: '1px 6px', borderRadius: 3, fontSize: 10, flexShrink: 0,
                    }}
                  >
                    {expandedId === e.id ? 'hide' : 'detail'}
                  </button>
                </div>
                {expandedId === e.id && (
                  <pre style={{
                    marginTop: 4, padding: 8, background: '#0a0a1a', borderRadius: 4,
                    color: '#a0c4ff', fontSize: 11, overflowX: 'auto',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {serializeError(e.detail)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
