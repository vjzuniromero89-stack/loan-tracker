// Conexion a Supabase (Postgres) compartida entre rutas.
// Usa la service_role key: esa llave se salta las reglas de RLS, asi que el
// Worker (backend) puede leer y escribir libremente, mientras que nadie mas
// (sin esa llave secreta) puede tocar las tablas.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

// Las tablas de esta app viven en el mismo proyecto de Supabase que otro
// negocio (centro-casos-credito), por eso llevan el prefijo loan_tracker_
// y no chocan con las tablas del otro proyecto.
export const CLIENTS_TABLE = "loan_tracker_clients";
export const LOANS_TABLE = "loan_tracker_loans";
export const PAYMENTS_TABLE = "loan_tracker_payments";

let cached: SupabaseClient | null = null;

export function getSupabase(env: SupabaseEnv): SupabaseClient {
  if (cached) return cached;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "El servidor no tiene configurado Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."
    );
  }
  cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return cached;
}
