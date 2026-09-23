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
  const interestTotal = loan.extension
    ? cents(Number(loan.principal) * loan.extension.original_rate / 100) + cents(loan.extension.additional_interest)
    : cents(Number(loan.principal) * Number(loan.interest_rate) / 100);
  const distribute = (sum: number, index: number, count: number) =>
    Math.floor(sum / count) + (index < sum % count ? 1 : 0);
  const schedule = Array.from({ length: n }, (_, i) => {
    let interest = 0, principal = 0;
    if (loan.payment_plan) {
      const months = loan.payment_plan.interest_months;
      interest = i < months ? distribute(interestTotal, i, months) : 0;
      principal = i >= months ? distribute(cents(Number(loan.principal)), i - months, n - months) : 0;
    } else {
      const firstMonths = loan.extension?.original_months ?? n;
      const inFirst = i < firstMonths;
      const count = inFirst ? firstMonths : n - firstMonths;
      const groupTotal = inFirst
        ? loan.extension ? cents(Number(loan.principal)) + cents(Number(loan.principal) * loan.extension.original_rate / 100) : total
        : cents(loan.extension?.additional_interest || 0);
      const amount = distribute(groupTotal, inFirst ? i : i - firstMonths, count);
      interest = Math.min(amount, Math.max(0, interestTotal - scheduleInterestBefore(i)));
      principal = amount - interest;
    }
    const amount = (interest + principal) / 100;
    return { number: i + 1, due_date: dueDate(loan.start_date, i + 1), amount,
      interest_amount: interest / 100, principal_amount: principal / 100,
      interest_paid: 0, principal_paid: 0, paid: 0, remaining: amount };
  });
  function scheduleInterestBefore(index: number): number {
    // Existing schedules keep their original amount split; the explicit plan
    // above is the only mode that guarantees interest-only early installments.
    if (loan.extension) {
      const base = cents(Number(loan.principal)) + cents(Number(loan.principal) * loan.extension.original_rate / 100);
      let before = 0;
      for (let j = 0; j < index; j++) before += distribute(j < loan.extension.original_months ? base : cents(loan.extension.additional_interest),
        j < loan.extension.original_months ? j : j - loan.extension.original_months,
        j < loan.extension.original_months ? loan.extension.original_months : n - loan.extension.original_months);
      return Math.min(before, interestTotal);
    }
    let before = 0;
    for (let j = 0; j < index; j++) before += distribute(total, j, n);
    return Math.min(before, interestTotal);
  }
  const allocations: { payment_id: string; number: number; due_date: string; amount: number; interest_amount: number; principal_amount: number }[] = [];
  let unallocated = 0;
  for (const payment of payments.slice().sort((a, b) => a.payment_date.localeCompare(b.payment_date) || (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))) {
    let left = cents(Number(payment.amount));
    const start = payment.installment_number && Number.isInteger(Number(payment.installment_number))
      ? Number(payment.installment_number) - 1 : 0;
    for (let i = Math.max(0, start); i < n && left > 0; i++) {
      const row = schedule[i];
      const take = Math.min(left, cents(row.remaining));
      if (!take) continue;
      const interestTake = Math.min(take, cents(row.interest_amount) - cents(row.interest_paid));
      row.interest_paid = (cents(row.interest_paid) + interestTake) / 100;
      row.principal_paid = (cents(row.principal_paid) + take - interestTake) / 100;
      row.paid = (cents(row.paid) + take) / 100;
      row.remaining = (cents(row.remaining) - take) / 100;
      allocations.push({ payment_id: payment.id, number: i + 1, due_date: row.due_date, amount: take / 100, interest_amount: interestTake / 100, principal_amount: (take - interestTake) / 100 });
      left -= take;
    }
    unallocated += left;
  }
  return { schedule, allocations, unallocated: unallocated / 100 };
}
