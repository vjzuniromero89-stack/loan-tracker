// Logica de calculo de prestamos: interes fijo sobre el TOTAL del prestamo
// (no se multiplica por los meses de plazo).
// Ejemplo: prestas 5000 al 40% a 5 meses ->
//   interes total = 5000 * 0.40 = 2000
//   total a pagar = 7000
//   cuota mensual = 7000 / 5 = 1400 (capital + interes en partes iguales cada mes)

import type { LoanExtension } from "./loanExtension";

export interface LoanRecord {
  extension?: LoanExtension;
  id: string;
  client_id: string;
  principal: number;
  interest_rate: number; // porcentaje total del prestamo, ej. 40 significa 40%
  term_months: number;
  start_date: string; // YYYY-MM-DD
  notes: string | null;
  created_at?: string;
}

export interface PaymentRecord {
  installment_number?: number | null;
  id: string;
  loan_id: string;
  amount: number;
  payment_date: string; // YYYY-MM-DD
  notes: string | null;
  created_at?: string;
}

export type LoanStatus = "activo" | "pagado" | "atrasado";

export interface LoanComputed {
  totalInterest: number;
  totalToPay: number;
  monthlyPayment: number;
  totalPaid: number;
  pendingBalance: number;
  percentPaid: number;
  status: LoanStatus;
  monthsElapsed: number;
  expectedPaidToDate: number;
  overdueAmount: number;
  nextDueDate: string | null;
  paymentsCount: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function monthDiff(start: Date, end: Date): number {
  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return months;
}

import { installments } from "./installments";

const OVERDUE_TOLERANCE = 0.5; // tolerancia en la moneda local para evitar falsos atrasos por redondeo

export function computeLoan(
  loan: LoanRecord,
  payments: PaymentRecord[],
  asOf: Date = new Date()
): LoanComputed {
  const totalInterest = loan.extension
    ? round2(loan.principal * (loan.extension.original_rate / 100) + loan.extension.additional_interest)
    : round2(loan.principal * (loan.interest_rate / 100));
  const totalToPay = round2(loan.principal + totalInterest);
  const monthlyPayment = loan.extension
    ? round2((loan.principal * (1 + loan.extension.original_rate / 100)) / loan.extension.original_months)
    : loan.term_months > 0 ? round2(totalToPay / loan.term_months) : 0;
  const allocation = installments(loan, payments);
  const totalPaid = round2(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  const pendingBalance = round2(Math.max(totalToPay - totalPaid, 0));
  const percentPaid =
    totalToPay > 0 ? round2(Math.min((totalPaid / totalToPay) * 100, 100)) : 0;

  const start = new Date(loan.start_date + "T00:00:00");
  let monthsElapsed = monthDiff(start, asOf);
  if (monthsElapsed < 0) monthsElapsed = 0;
  if (monthsElapsed > loan.term_months) monthsElapsed = loan.term_months;

  const today = asOf.toISOString().slice(0, 10);
  const expectedPaidToDate = round2(allocation.schedule.filter(r => r.due_date < today).reduce((sum, r) => sum + r.amount, 0));
  const overdueAmount = round2(allocation.schedule.filter(r => r.due_date < today).reduce((sum, r) => sum + r.remaining, 0));

  let status: LoanStatus;
  if (pendingBalance <= 0) {
    status = "pagado";
  } else if (overdueAmount > OVERDUE_TOLERANCE) {
    status = "atrasado";
  } else {
    status = "activo";
  }

  let nextDueDate: string | null = null;
  if (status !== "pagado" && monthlyPayment > 0) {
    nextDueDate = allocation.schedule.find(r => r.remaining > 0)?.due_date || null;
  }

  return {
    totalInterest,
    totalToPay,
    monthlyPayment,
    totalPaid,
    pendingBalance,
    percentPaid,
    status,
    monthsElapsed,
    expectedPaidToDate,
    overdueAmount,
    nextDueDate,
    paymentsCount: payments.length,
  };
}
