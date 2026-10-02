import 'server-only';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { assertBiaReadRequest } from '@oraculo/domain/bia.js';
import { ACCESS_COOKIE, getSupabaseAnonKey, getSupabaseUrl } from '../auth/session';
import { operationFetch } from '../supabase/operation-fetch';

// Deliberately no admin client, including in development. All requests are
// restricted to the audited STABLE commercial RPC before reaching Supabase.
export async function createBiaReadClient(signal: AbortSignal) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new Error('BIA_SESSION_REQUIRED');
  const base = getSupabaseUrl();
  const scopedFetch = operationFetch();
  const readOnlyFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    assertBiaReadRequest(url, init?.method ?? (input instanceof Request ? input.method : 'GET'), new URL(base).origin);
    const timeout = AbortSignal.timeout(10_000);
    return scopedFetch(input, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal, timeout, ...(init?.signal ? [init.signal] : [])]) });
  };
  return createClient(base, getSupabaseAnonKey(), {
    global: { fetch: readOnlyFetch, headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
