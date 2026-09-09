// Helpers de acceso a datos (Supabase/Postgres) compartidos entre rutas.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoanRecord, PaymentRecord } from "./loanCalc";
import { CLIENTS_TABLE, LOANS_TABLE, PAYMENTS_TABLE } from "./supabase";

export interface ClientRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface LoanJoined extends LoanRecord {
  client_name: string;
  client_phone: string | null;
}

export async function fetchAllLoansJoined(
  supabase: SupabaseClient
): Promise<LoanJoined[]> {
  const { data, error } = await supabase
    .from(LOANS_TABLE)
    .select(`*, client:${CLIENTS_TABLE}(name, phone)`)
    .order("start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => {
    const { client, ...loan } = row;
    return {
      ...loan,
      client_name: client?.name ?? "",
      client_phone: client?.phone ?? null,
    } as LoanJoined;
  });
}

export async function fetchAllPaymentsGrouped(
  supabase: SupabaseClient
): Promise<Map<string, PaymentRecord[]>> {
  const { data, error } = await supabase
    .from(PAYMENTS_TABLE)
    .select("*")
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const map = new Map<string, PaymentRecord[]>();
  for (const p of (data || []) as PaymentRecord[]) {
    const arr = map.get(p.loan_id) || [];
    arr.push(p);
    map.set(p.loan_id, arr);
  }
  return map;
}

export async function fetchPaymentsForLoan(
  supabase: SupabaseClient,
  loanId: string
): Promise<PaymentRecord[]> {
  const { data, error } = await supabase
    .from(PAYMENTS_TABLE)
    .select("*")
    .eq("loan_id", loanId)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as PaymentRecord[];
}
