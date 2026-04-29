import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPortalSession } from '../../lib/portalAuth';
import { createPortalClient } from '../../lib/supabase';

// Enriches the session with a org/branch-scoped Supabase client for RLS.
export default function PortalAuthGuard({ portal, children }) {
  const navigate = useNavigate();
  const session = getPortalSession(portal);

  useEffect(() => {
    if (!session) {
      navigate(`/rp-${portal}/login`, { replace: true });
    }
  }, [session, portal, navigate]);

  const portalClient = useMemo(
    () => (session ? createPortalClient(session.token) : null),
    [session?.token],
  );

  if (!session) return null;
  // Merge portalClient into session so all tab children receive it transparently
  return children({ ...session, portalClient });
}
