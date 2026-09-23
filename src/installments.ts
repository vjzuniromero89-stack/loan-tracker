import type { LoanRecord, PaymentRecord } from './loanCalc';

const cents = (n: number) => Math.round(n * 100);
export function dueDate(start: string, number: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + number, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}
export function installments(loan: LoanRecord, payments: PaymentRecord[]) {
  const total = cents(Number(loan.principal) * (1 + Number(loan.interest_rate) / 100));
  const n = Number(loan.term_months);
  if (!Number.isInteger(n) || n < 1) return { schedule: [], allocations: [], unallocated: 0 };
  const firstMonths = loan.extension?.original_months ?? n;
  const firstTotal = loan.extension
    ? cents(Number(loan.principal) * (1 + loan.extension.original_rate / 100)) : total;
  const secondTotal = loan.extension ? cents(loan.extension.additional_interest) : 0;
  const schedule = Array.from({ length: n }, (_, i) => {
    const inFirst = i < firstMonths;
    const groupMonths = inFirst ? firstMonths : n - firstMonths;
    const groupTotal = inFirst ? firstTotal : secondTotal;
    const groupIndex = inFirst ? i : i - firstMonths;
    const base = Math.floor(groupTotal / groupMonths);
    const amount = (groupIndex === groupMonths - 1 ? groupTotal - base * (groupMonths - 1) : base) / 100;
    return { number: i + 1, due_date: dueDate(loan.start_date, i + 1),
      amount, paid: 0, remaining: amount };
  });
  const allocations: { payment_id: string; number: number; due_date: string; amount: number }[] = [];
  let unallocated = 0;
  for (const payment of payments.slice().sort((a, b) => a.payment_date.localeCompare(b.payment_date) || (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))) {
    let left = cents(Number(payment.amount));
    const start = payment.installment_number && Number.isInteger(Number(payment.installment_number))
      ? Number(payment.installment_number) - 1 : 0;
    for (let i = Math.max(0, start); i < n && left > 0; i++) {
      const row = schedule[i];
      const take = Math.min(left, cents(row.remaining));
      if (!take) continue;
      row.paid = (cents(row.paid) + take) / 100;
      row.remaining = (cents(row.remaining) - take) / 100;
      allocations.push({ payment_id: payment.id, number: i + 1, due_date: row.due_date, amount: take / 100 });
      left -= take;
    }
    unallocated += left;
  }
  return { schedule, allocations, unallocated: unallocated / 100 };
}
