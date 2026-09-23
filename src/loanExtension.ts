import type { LoanRecord } from './loanCalc';

export interface LoanExtension {
  original_months: number;
  original_rate: number;
  additional_months: number;
  additional_rate: number;
  calculation_base: 'original' | 'remaining';
  base_amount: number;
  additional_interest: number;
  agreement_date: string;
}
export interface LoanPaymentPlan { interest_months: number }

const PREFIX = '__LOAN_TRACKER_EXTENSION_V1__';

export function encodeLoanNotes(notes: string | null, extension?: LoanExtension, paymentPlan?: LoanPaymentPlan): string {
  return PREFIX + JSON.stringify({ notes, extension: extension || null, payment_plan: paymentPlan || null });
}

export function decodeLoan<T extends LoanRecord>(row: T): T & { extension?: LoanExtension; payment_plan?: LoanPaymentPlan } {
  if (typeof row.notes !== 'string' || !row.notes.startsWith(PREFIX)) return row;
  try {
    const payload = JSON.parse(row.notes.slice(PREFIX.length));
    if (!(typeof payload.notes === 'string' || payload.notes === null)) return row;
    const e = payload.extension as LoanExtension | null;
    const p = payload.payment_plan as LoanPaymentPlan | null;
    if (e && (!Number.isInteger(e.original_months) || e.original_months < 1 ||
        !Number.isInteger(e.additional_months) || e.additional_months < 1 ||
        !Number.isFinite(e.original_rate) || !Number.isFinite(e.additional_rate) ||
        !Number.isFinite(e.additional_interest) || e.additional_interest < 0 ||
        !Number.isFinite(e.base_amount) || e.base_amount < 0 ||
        !['original', 'remaining'].includes(e.calculation_base) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(e.agreement_date))) return row;
    const n = e ? e.original_months + e.additional_months : Number(row.term_months);
    if (p && (!Number.isInteger(p.interest_months) || p.interest_months < 1 || p.interest_months >= n)) return row;
    if (!e && !p) return row;
    return {
      ...row, notes: payload.notes,
      ...(e ? { extension: e, term_months: n, interest_rate: e.original_rate } : {}),
      ...(p ? { payment_plan: p } : {}),
    };
  } catch { return row; }
}
