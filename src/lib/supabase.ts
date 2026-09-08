import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Motivo = "materiales" | "mano_de_obra" | "pago" | "recoleccion";
export type RateStatus = "pending" | "ok" | "error";

export type Expense = {
  id: string;
  date: string;
  description: string;
  motivo: Motivo;
  amountArs: number;
  usdRate?: number;
  rateStatus: RateStatus;
};

export type DbExpense = {
  id: string;
  date: string;
  description: string;
  motivo: Motivo;
  amount_ars: number | string;
  usd_rate: number | string | null;
  rate_status: RateStatus;
  created_at?: string;
};

export function isMotivo(value: unknown): value is Motivo {
  return (
    value === "materiales" ||
    value === "mano_de_obra" ||
    value === "pago" ||
    value === "recoleccion"
  );
}

export function fromDb(row: DbExpense): Expense {
  const usdRate = row.usd_rate == null ? undefined : Number(row.usd_rate);
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    motivo: isMotivo(row.motivo) ? row.motivo : "materiales",
    amountArs: Number(row.amount_ars),
    usdRate: usdRate && !Number.isNaN(usdRate) ? usdRate : undefined,
    rateStatus: row.rate_status,
  };
}

export function toDb(expense: Expense) {
  return {
    id: expense.id,
    date: expense.date,
    description: expense.description,
    motivo: expense.motivo,
    amount_ars: expense.amountArs,
    usd_rate: expense.usdRate ?? null,
    rate_status: expense.rateStatus,
  };
}
