import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseUrl, getSupabaseAnonKey, ACCESS_COOKIE } from "../auth/session";
import { createSupabaseAdminClient } from "./admin";

/**
 * Cliente Supabase para LEITURA no caminho do usuário autenticado.
 *
 * Usa a anon key + o JWT do usuário (cookie httpOnly) no header Authorization, de
 * modo que as queries rodam sob RLS como `authenticated`, e não com a service-role
 * key. Isso tira a service-role do caminho de leitura de dados de negócio; ela fica
 * reservada para escrita, /usuarios (auth.admin) e /status (tokens sensíveis).
 *
 * Em desenvolvimento, `getCurrentUser` usa um admin mock e não há cookie de sessão;
 * nesse caso caímos no admin client para preservar o DX local (o middleware também
 * faz bypass em dev). Em produção, sem token válido não há leitura.
 *
 * Requer as policies/grants da migration `..._rls_authenticated_read.sql`. As tabelas
 * de leitura têm policy `select ... to authenticated using (true)`; as views/RPCs de
 * leitura são `security definer` com grant para `authenticated`.
 */
export async function createSupabaseUserClient() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;

  if (!accessToken) {
    if (process.env.NODE_ENV !== "production") {
      // DX local: sem sessão, usa o admin client (mesmo comportamento de hoje).
      return createSupabaseAdminClient();
    }
    // Em produção o middleware/requireCurrentUser já barram antes de chegar aqui.
    // Ainda assim, sem token não emitimos a service-role: usamos anon puro (RLS nega).
    return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
