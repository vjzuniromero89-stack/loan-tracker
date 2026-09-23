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

const PREFIX = '__LOAN_TRACKER_EXTENSION_V1__';
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function encodeLoanNotes(notes: string | null, extension: LoanExtension): string {
  return PREFIX + JSON.stringify({ notes, extension });
}

export function decodeLoan<T extends LoanRecord>(row: T): T & { extension?: LoanExtension } {
  if (typeof row.notes !== 'string' || !row.notes.startsWith(PREFIX)) return row;
  try {
    const payload = JSON.parse(row.notes.slice(PREFIX.length));
    const e = payload.extension as LoanExtension;
    if (!e || !Number.isInteger(e.original_months) || e.original_months < 1 ||
        !Number.isInteger(e.additional_months) || e.additional_months < 1 ||
        !Number.isFinite(e.original_rate) || !Number.isFinite(e.additional_rate) ||
        !Number.isFinite(e.additional_interest) || e.additional_interest < 0 ||
        !Number.isFinite(e.base_amount) || e.base_amount < 0 ||
        !['original', 'remaining'].includes(e.calculation_base) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(e.agreement_date) ||
        !(typeof payload.notes === 'string' || payload.notes === null)) return row;
    return {
      ...row,
      notes: payload.notes,
      extension: e,
      term_months: e.original_months + e.additional_months,
      interest_rate: round2(e.original_rate + e.additional_interest / Number(row.principal) * 100),
    };
  } catch {
    return row;
  }
}
