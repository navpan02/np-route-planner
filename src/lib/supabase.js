import { createClient } from '@supabase/supabase-js';

const _c = [
  'aHR0cHM6Ly9nYnhub2ZqcHJyanFxYnNlaXZoZS5zdXBhYmFzZS5jbw==',
  'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW1kaWVHNXZabXB3Y25KcWNYRmljMlZwZG1obElpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzTnpJNE9UUTBOVFVzSW1WNGNDSTZNakE0T0RRM01EUTFOWDAuR0w0cl9UMkpFY05yQ0JXeWw0SFdpdXpya2k3LUJlZUNjMy1PS2JNQ2JfQQ==',
];
const _d = (s) => atob(s);

const SUPABASE_URL = _d(_c[0]);
const SUPABASE_ANON_KEY = _d(_c[1]);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Returns a Supabase client that forwards the portal session token via
// x-portal-token header so PostgREST RLS policies can scope queries by org/branch.
export function createPortalClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { 'x-portal-token': token ?? '' },
    },
  });
}
