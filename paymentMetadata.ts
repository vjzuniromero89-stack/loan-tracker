import type { PaymentRecord } from './loanCalc';

// Compatibilidad con bases de datos que todavía no tienen installment_number.
// El prefijo se reserva para los pagos nuevos y no aparece en las notas visibles.
const PREFIX = '__LOAN_TRACKER_INSTALLMENT_V1__';

export function encodePaymentNotes(installmentNumber: number, notes: string | null): string {
  return PREFIX + JSON.stringify({ installment_number: installmentNumber, notes });
}

export function decodePayment(row: PaymentRecord): PaymentRecord {
  if (typeof row.notes !== 'string' || !row.notes.startsWith(PREFIX)) return row;
  try {
    const payload = JSON.parse(row.notes.slice(PREFIX.length));
    if (!Number.isInteger(payload.installment_number) || payload.installment_number < 1 ||
        !(typeof payload.notes === 'string' || payload.notes === null)) return row;
    return {
      ...row,
      installment_number: row.installment_number ?? payload.installment_number,
      notes: payload.notes,
    };
  } catch {
    return row;
  }
}

export function missingInstallmentColumn(error: { code?: string; message?: string }): boolean {
  return (error.code === 'PGRST204' || error.code === '42703' || /schema cache/i.test(error.message || '')) &&
    /installment_number/i.test(error.message || '');
}
