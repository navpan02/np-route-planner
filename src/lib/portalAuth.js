import { supabase } from './supabase';

const ADMIN_KEY   = 'rp_admin_session';
const MANAGER_KEY = 'rp_manager_session';

function storageKey(portal) {
  return portal === 'admin' ? ADMIN_KEY : MANAGER_KEY;
}

export async function portalLogin(username, password, portal) {
  const { data, error } = await supabase.functions.invoke('portal-login', {
    body: { username, password },
  });

  if (error) throw new Error(error.message ?? 'Login failed');
  if (data.error) throw new Error(data.error);

  // org_admin for admin portal; branch_manager for manager portal
  const expectedRole = portal === 'admin' ? 'org_admin' : 'branch_manager';
  if (data.user.role !== expectedRole) {
    throw new Error('Invalid username or password');
  }

  const session = { ...data.user, token: data.token, expiresAt: data.expiresAt };
  localStorage.setItem(storageKey(portal), JSON.stringify(session));
  return session;
}

export function portalLogout(portal) {
  localStorage.removeItem(storageKey(portal));
}

export function getPortalSession(portal) {
  try {
    const raw = localStorage.getItem(storageKey(portal));
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.token) return null;
    if (new Date(session.expiresAt) <= new Date()) {
      localStorage.removeItem(storageKey(portal));
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
