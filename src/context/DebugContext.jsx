import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const DebugContext = createContext(null);

export function DebugProvider({ children }) {
  const [enabled] = useState(
    () => new URLSearchParams(window.location.search).get('debug') === 'true'
  );
  const [entries, setEntries] = useState([]);

  const log = useCallback((source, error) => {
    if (!enabled) return;
    setEntries(prev => [{
      id: Date.now() + Math.random(),
      ts: new Date().toLocaleTimeString(),
      source: source ?? 'unknown',
      message: error?.message ?? String(error),
      detail: error,
    }, ...prev].slice(0, 50));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    window.__nplawnDebug = { log };

    const onUnhandledRejection = (e) => log('unhandledRejection', e.reason);
    const onError = (e) => log('window.error', e.error ?? e.message);

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
      delete window.__nplawnDebug;
    };
  }, [enabled, log]);

  return (
    <DebugContext.Provider value={{ entries, setEntries, log, enabled }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug() {
  return useContext(DebugContext) ?? { entries: [], log: () => {}, enabled: false };
}
