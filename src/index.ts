import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { decodeLoan, encodeLoanNotes, type LoanExtension } from "./loanExtension";
import { encodePaymentNotes, missingInstallmentColumn } from "./paymentMetadata";
import { installments } from "./installments";
import { computeLoan, type LoanRecord } from "./loanCalc";
import { createSessionToken, verifySessionToken } from "./auth";
import {
  fetchAllLoansJoined,
  fetchAllPaymentsGrouped,
  fetchPaymentsForLoan,
} from "./db";
import { getSupabase, CLIENTS_TABLE, LOANS_TABLE, PAYMENTS_TABLE } from "./supabase";

type Bindings = {
  ASSETS: Fetcher;
  APP_PASSWORD: string;
  AUTH_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const SESSION_COOKIE = "session";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
// Orden alfabetico sin distinguir mayusculas/acentos (equivalente a lo que
// antes hacia "COLLATE NOCASE" en SQLite).
const byNameAsc = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "es", { sensitivity: "base" });

const app = new Hono<{ Bindings: Bindings }>();

// ---------- Autenticacion ----------

app.use("/api/*", async (c, next) => {
  const openPaths = ["/api/login", "/api/me"];
  // El link de solo lectura para clientes no usa la contraseña del dueño:
  // se valida con su propio token secreto dentro del handler.
  if (openPaths.includes(c.req.path) || c.req.path.startsWith("/api/portal/")) {
    return next();
  }
  const token = getCookie(c, SESSION_COOKIE);
  const ok = await verifySessionToken(token, c.env.AUTH_SECRET);
  if (!ok) return c.json({ error: "No autorizado" }, 401);
  return next();
});

app.get("/api/me", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const ok = await verifySessionToken(token, c.env.AUTH_SECRET);
  return c.json({ authenticated: ok });
});

app.post("/api/login", async (c) => {
  if (!c.env.APP_PASSWORD || !c.env.AUTH_SECRET) {
    return c.json(
      {
        error:
          "El servidor no tiene configurada la contraseña (APP_PASSWORD / AUTH_SECRET). Revisa el README.",
      },
      500
    );
  }
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const password = typeof body.password === "string" ? body.password : "";
  if (password !== c.env.APP_PASSWORD) {
    return c.json({ error: "Contraseña incorrecta" }, 401);
  }
  const token = await createSessionToken(c.env.AUTH_SECRET);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---------- Clientes ----------

app.get("/api/clients", async (c) => {
  const supabase = getSupabase(c.env);
  const { data: clients, error } = await supabase.from(CLIENTS_TABLE).select("*");
  if (error) return c.json({ error: error.message }, 500);

  const loans = await fetchAllLoansJoined(supabase);
  const paymentsMap = await fetchAllPaymentsGrouped(supabase);

  type ClientSummary = {
    totalPrestado: number;
    totalPendiente: number;
    loansCount: number;
    activeCount: number;
    lateCount: number;
    paidCount: number;
  };
  const summaryByClient = new Map<string, ClientSummary>();
  for (const loan of loans) {
    const computed = computeLoan(loan, paymentsMap.get(loan.id) || []);
    const s: ClientSummary = summaryByClient.get(loan.client_id) || {
      totalPrestado: 0,
      totalPendiente: 0,
      loansCount: 0,
      activeCount: 0,
      lateCount: 0,
      paidCount: 0,
    };
    s.totalPrestado = round2(s.totalPrestado + loan.principal);
    s.totalPendiente = round2(s.totalPendiente + computed.pendingBalance);
    s.loansCount += 1;
    if (computed.status === "activo") s.activeCount += 1;
    if (computed.status === "atrasado") s.lateCount += 1;
    if (computed.status === "pagado") s.paidCount += 1;
    summaryByClient.set(loan.client_id, s);
  }

  const result = ((clients as unknown as Array<Record<string, unknown>>) || [])
    .sort(byNameAsc as any)
    .map((cl) => ({
      ...cl,
      summary: summaryByClient.get(cl.id as string) || {
        totalPrestado: 0,
        totalPendiente: 0,
        loansCount: 0,
        activeCount: 0,
        lateCount: 0,
        paidCount: 0,
      },
    }));
  return c.json(result);
});

app.post("/api/clients", async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "El nombre es obligatorio" }, 400);
  const id = crypto.randomUUID();
  const accessToken = crypto.randomUUID();
  const { error } = await supabase.from(CLIENTS_TABLE).insert({
    id,
    name,
    phone: (body.phone as string) || null,
    email: (body.email as string) || null,
    address: (body.address as string) || null,
    notes: (body.notes as string) || null,
    access_token: accessToken,
  });
  if (error) return c.json({ error: error.message }, 500);
  const { data: client } = await supabase
    .from(CLIENTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return c.json(client, 201);
});

app.get("/api/clients/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  let { data: client, error } = await supabase
    .from(CLIENTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();
  if (error) return c.json({ error: error.message }, 500);
  if (!client) return c.json({ error: "Cliente no encontrado" }, 404);

  // Clientes creados antes de que existiera el link de solo lectura no
  // tienen access_token todavia: se genera uno la primera vez que hace falta.
  if (!client.access_token) {
    const accessToken = crypto.randomUUID();
    await supabase.from(CLIENTS_TABLE).update({ access_token: accessToken }).eq("id", id);
    client = { ...client, access_token: accessToken };
  }

  const { data: loans } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("client_id", id)
    .order("start_date", { ascending: false });

  const loansComputed = await Promise.all(
    ((loans as unknown as LoanRecord[]) || []).map(async (loan) => {
      const payments = await fetchPaymentsForLoan(supabase, loan.id);
      const decoded = decodeLoan(loan);
      return { ...decoded, ...computeLoan(decoded, payments), paymentsList: payments };
    })
  );

  return c.json({ ...client, loans: loansComputed });
});

// ---------- Enlace de solo lectura para el cliente ----------
// Publico (no requiere la contrasena del dueno): protegido unicamente por el
// access_token, que solo el dueno puede ver y copiar desde la ficha del
// cliente. No expone ninguna ruta para crear, editar ni borrar nada.

app.get("/api/portal/:clientId/:token", async (c) => {
  const supabase = getSupabase(c.env);
  const clientId = c.req.param("clientId");
  const token = c.req.param("token");
  const invalid = () => c.json({ error: "Este enlace no es válido." }, 404);

  if (!token) return invalid();

  const { data: client } = await supabase
    .from(CLIENTS_TABLE)
    .select("*")
    .eq("id", clientId)
    .maybeSingle<Record<string, unknown>>();
  if (!client || !client.access_token || client.access_token !== token) {
    return invalid();
  }

  const { data: loans } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });

  const loansComputed = await Promise.all(
    ((loans as unknown as LoanRecord[]) || []).map(async (loan) => {
      const payments = await fetchPaymentsForLoan(supabase, loan.id);
      const decoded = decodeLoan(loan);
      return { ...decoded, ...computeLoan(decoded, payments), ...installments(decoded, payments), paymentsList: payments };
    })
  );

  return c.json({
    name: client.name,
    phone: client.phone,
    email: client.email,
    loans: loansComputed,
  });
});

app.put("/api/clients/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: existing } = await supabase
    .from(CLIENTS_TABLE)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return c.json({ error: "Cliente no encontrado" }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "El nombre es obligatorio" }, 400);

  const { error } = await supabase
    .from(CLIENTS_TABLE)
    .update({
      name,
      phone: (body.phone as string) || null,
      email: (body.email as string) || null,
      address: (body.address as string) || null,
      notes: (body.notes as string) || null,
    })
    .eq("id", id);
  if (error) return c.json({ error: error.message }, 500);

  const { data: client } = await supabase
    .from(CLIENTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return c.json(client);
});

app.delete("/api/clients/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: existing } = await supabase
    .from(CLIENTS_TABLE)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return c.json({ error: "Cliente no encontrado" }, 404);

  // Los prestamos y pagos de este cliente se borran solos (ON DELETE CASCADE).
  const { error } = await supabase.from(CLIENTS_TABLE).delete().eq("id", id);
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ ok: true });
});

// ---------- Prestamos ----------

app.get("/api/loans", async (c) => {
  const supabase = getSupabase(c.env);
  const statusFilter = c.req.query("status");
  const clientId = c.req.query("client_id");

  let loans = await fetchAllLoansJoined(supabase);
  if (clientId) loans = loans.filter((l) => l.client_id === clientId);

  const paymentsMap = await fetchAllPaymentsGrouped(supabase);
  let result = loans.map((l) => ({
    ...l,
    ...computeLoan(l, paymentsMap.get(l.id) || []),
  }));

  if (statusFilter) {
    result = result.filter((l) => l.status === statusFilter);
  }

  return c.json(result);
});

function validateLoanInput(body: Record<string, unknown>) {
  const principal = Number(body.principal);
  const interestRate = Number(body.interest_rate);
  const termMonths = Number(body.term_months);
  const startDate = typeof body.start_date === "string" ? body.start_date : "";

  if (!principal || principal <= 0) {
    return { error: "El monto prestado debe ser mayor a 0" };
  }
  if (Number.isNaN(interestRate) || interestRate < 0) {
    return { error: "El porcentaje de interés no es válido" };
  }
  if (!termMonths || termMonths <= 0 || !Number.isInteger(termMonths)) {
    return { error: "El plazo en meses debe ser un número entero mayor a 0" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return { error: "La fecha de inicio es obligatoria (AAAA-MM-DD)" };
  }
  return { principal, interestRate, termMonths, startDate };
}

app.post("/api/loans", async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!clientId) return c.json({ error: "Debes seleccionar un cliente" }, 400);

  const { data: client } = await supabase
    .from(CLIENTS_TABLE)
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return c.json({ error: "Cliente no encontrado" }, 404);

  const validated = validateLoanInput(body);
  if ("error" in validated) return c.json(validated, 400);

  const mode = body.payment_mode ?? "monthly";
  const interestMonths = Number(body.interest_months);
  if (mode !== "monthly" && mode !== "interest_first") return c.json({ error: "Elige una modalidad de cobro válida" }, 400);
  if (mode === "interest_first" && (!Number.isInteger(interestMonths) || interestMonths < 1 || interestMonths >= validated.termMonths)) {
    return c.json({ error: "Los meses de interés deben ser entre 1 y el plazo menos 1" }, 400);
  }
  const plan = mode === "interest_first" ? { interest_months: interestMonths } : undefined;
  const id = crypto.randomUUID();
  const { error } = await supabase.from(LOANS_TABLE).insert({
    id,
    client_id: clientId,
    principal: validated.principal,
    interest_rate: validated.interestRate,
    term_months: validated.termMonths,
    start_date: validated.startDate,
    notes: plan ? encodeLoanNotes((body.notes as string) || null, undefined, plan) : (body.notes as string) || null,
  });
  if (error) return c.json({ error: error.message }, 500);

  const { data: loan } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  const decoded = decodeLoan(loan as LoanRecord);
  return c.json({ ...decoded, ...computeLoan(decoded, []) }, 201);
});

app.get("/api/loans/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: loanRow } = await supabase
    .from(LOANS_TABLE)
    .select(`*, client:${CLIENTS_TABLE}(name, phone)`)
    .eq("id", id)
    .maybeSingle<any>();
  if (!loanRow) return c.json({ error: "Préstamo no encontrado" }, 404);

  const { client, ...rawLoan } = loanRow;
  const loan = decodeLoan(rawLoan as LoanRecord);
  const loanWithClient = {
    ...loan,
    client_name: client?.name ?? "",
    client_phone: client?.phone ?? null,
  };

  const payments = await fetchPaymentsForLoan(supabase, id);
  const computed = computeLoan(loan as LoanRecord, payments);
  return c.json({ ...loanWithClient, payments, ...computed, ...installments(loan as LoanRecord, payments) });
});

app.put("/api/loans/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: existing } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return c.json({ error: "Préstamo no encontrado" }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const validated = validateLoanInput(body);
  if ("error" in validated) return c.json(validated, 400);
  const currentLoan = decodeLoan(existing as LoanRecord);
  const payments = await fetchPaymentsForLoan(supabase, id);
  if (currentLoan.payment_plan && currentLoan.payment_plan.interest_months >= validated.termMonths + (currentLoan.extension?.additional_months ?? 0)) {
    return c.json({ error: "El plazo debe tener meses suficientes para cobrar intereses y capital." }, 400);
  }
  const extension = currentLoan.extension ? { ...currentLoan.extension } : undefined;
  if (extension) {
    extension.original_months = validated.termMonths;
    extension.original_rate = validated.interestRate;
    const originalInterest = round2(validated.principal * validated.interestRate / 100);
    const paidAtAgreement = payments.filter(p => p.payment_date <= extension.agreement_date)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    extension.base_amount = extension.calculation_base === "original"
      ? validated.principal
      : round2(Math.max(0, validated.principal - Math.max(0, paidAtAgreement - originalInterest)));
    extension.additional_interest = round2(extension.base_amount * extension.additional_rate / 100);
  }
  const notes = extension || currentLoan.payment_plan
    ? encodeLoanNotes((body.notes as string) || null, extension, currentLoan.payment_plan)
    : (body.notes as string) || null;
  const candidate = decodeLoan({ ...existing, principal: validated.principal,
    interest_rate: validated.interestRate, term_months: validated.termMonths,
    start_date: validated.startDate, notes } as LoanRecord);
  const candidateSchedule = installments(candidate, payments);
  if (candidateSchedule.unallocated > 0.001) {
    return c.json({ error: "Los pagos registrados no caben en el nuevo calendario. Revisa el monto, el interés y el plazo." }, 400);
  }
  const { error } = await supabase
    .from(LOANS_TABLE)
    .update({
      principal: validated.principal,
      interest_rate: validated.interestRate,
      term_months: validated.termMonths,
      start_date: validated.startDate,
      notes,
    })
    .eq("id", id);
  if (error) return c.json({ error: error.message }, 500);

  const { data: loan } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const decoded = decodeLoan(loan as LoanRecord);
  return c.json({ ...decoded, payments, ...computeLoan(decoded, payments) });
});

app.post("/api/loans/:id/extension", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: rawLoan, error: readError } = await supabase.from(LOANS_TABLE)
    .select("*").eq("id", id).maybeSingle();
  if (readError) return c.json({ error: readError.message }, 500);
  if (!rawLoan) return c.json({ error: "Préstamo no encontrado" }, 404);
  const loan = decodeLoan(rawLoan as LoanRecord);
  if (loan.extension) return c.json({ error: "Este préstamo ya tiene una extensión registrada" }, 400);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const originalMonths = Number(body.original_months);
  const additionalMonths = Number(body.additional_months);
  const originalRate = Number(body.original_rate);
  const additionalRate = Number(body.additional_rate);
  const base = body.calculation_base;
  const agreementDate = typeof body.agreement_date === "string" ? body.agreement_date : "";
  if (!Number.isInteger(originalMonths) || originalMonths < 1 || originalMonths > 120 ||
      !Number.isInteger(additionalMonths) || additionalMonths < 1 || additionalMonths > 120 ||
      !Number.isFinite(originalRate) || originalRate < 0 || originalRate > 1000 ||
      !Number.isFinite(additionalRate) || additionalRate < 0 || additionalRate > 1000 ||
      (base !== "original" && base !== "remaining") ||
      !/^\d{4}-\d{2}-\d{2}$/.test(agreementDate) ||
      Number.isNaN(Date.parse(agreementDate + "T00:00:00Z"))) {
    return c.json({ error: "Revisa los meses, porcentajes, base y fecha de la extensión" }, 400);
  }
  const payments = await fetchPaymentsForLoan(supabase, id);
  const paid = round2(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  const originalInterest = round2(Number(loan.principal) * originalRate / 100);
  const recoveredPrincipal = Math.max(0, paid - originalInterest);
  const baseAmount = base === "original" ? Number(loan.principal) : round2(Math.max(0, Number(loan.principal) - recoveredPrincipal));
  const extraInterest = round2(baseAmount * additionalRate / 100);
  const extension: LoanExtension = {
    original_months: originalMonths, original_rate: originalRate,
    additional_months: additionalMonths, additional_rate: additionalRate,
    calculation_base: base, base_amount: baseAmount,
    additional_interest: extraInterest, agreement_date: agreementDate,
  };
  const candidate = decodeLoan({ ...rawLoan, notes: encodeLoanNotes(loan.notes, extension, loan.payment_plan) } as LoanRecord);
  const candidateTotal = round2(Number(loan.principal) + originalInterest + extraInterest);
  if (paid > candidateTotal + 0.001) return c.json({ error: "Los pagos existentes superan el total calculado. Revisa los porcentajes." }, 400);
  const candidateSchedule = installments(candidate, payments);
  if (candidateSchedule.unallocated > 0.001) return c.json({ error: "Hay pagos asignados fuera del nuevo plazo. Revisa el plazo original y la extensión." }, 400);
  let updateQuery = supabase.from(LOANS_TABLE).update({
    interest_rate: originalRate,
    term_months: originalMonths,
    notes: encodeLoanNotes(loan.notes, extension, loan.payment_plan),
  }).eq("id", id);
  updateQuery = rawLoan.notes === null ? updateQuery.is("notes", null) : updateQuery.eq("notes", rawLoan.notes);
  const { data: updated, error } = await updateQuery.select("id");
  if (error) return c.json({ error: error.message }, 500);
  if (!updated?.length) return c.json({ error: "El préstamo cambió mientras registrabas la extensión. Recarga la ficha y revisa los datos." }, 409);
  return c.json({ ...candidate, payments, ...computeLoan(candidate, payments), ...candidateSchedule }, 201);
});

app.delete("/api/loans/:id/extension", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: rawLoan, error: readError } = await supabase.from(LOANS_TABLE)
    .select("*").eq("id", id).maybeSingle();
  if (readError) return c.json({ error: readError.message }, 500);
  if (!rawLoan) return c.json({ error: "Préstamo no encontrado" }, 404);
  const loan = decodeLoan(rawLoan as LoanRecord);
  if (!loan.extension) return c.json({ error: "Este préstamo no tiene una extensión para eliminar" }, 400);
  const originalMonths = loan.extension.original_months;
  const originalRate = loan.extension.original_rate;
  if (loan.payment_plan && loan.payment_plan.interest_months >= originalMonths) {
    return c.json({ error: "Ajusta primero el plan de interés: sus meses deben ser menos que el plazo original." }, 400);
  }
  const payments = await fetchPaymentsForLoan(supabase, id);
  if (payments.some(p => p.installment_number && p.installment_number > originalMonths)) {
    return c.json({ error: "Hay pagos asignados a los meses de la extensión. Revisa esos pagos antes de eliminarla." }, 400);
  }
  const originalTotal = round2(Number(loan.principal) * (1 + originalRate / 100));
  const totalPaid = round2(payments.reduce((sum, p) => sum + Number(p.amount), 0));
  if (totalPaid > originalTotal + 0.001) {
    return c.json({ error: "Los pagos registrados superan el total original. No se puede eliminar la extensión sin corregirlos." }, 400);
  }
  const notes = loan.payment_plan ? encodeLoanNotes(loan.notes, undefined, loan.payment_plan) : loan.notes;
  const restored = decodeLoan({ ...rawLoan, interest_rate: originalRate,
    term_months: originalMonths, notes } as LoanRecord);
  const schedule = installments(restored, payments);
  if (schedule.unallocated > 0.001) {
    return c.json({ error: "Un pago no cabe en el calendario original. Revisa sus meses antes de eliminar la extensión." }, 400);
  }
  let updateQuery = supabase.from(LOANS_TABLE).update({
    interest_rate: originalRate, term_months: originalMonths, notes,
  }).eq("id", id);
  updateQuery = rawLoan.notes === null ? updateQuery.is("notes", null) : updateQuery.eq("notes", rawLoan.notes);
  const { data: updated, error } = await updateQuery.select("id");
  if (error) return c.json({ error: error.message }, 500);
  if (!updated?.length) return c.json({ error: "El préstamo cambió. Recarga la ficha antes de eliminar la extensión." }, 409);
  return c.json({ ...restored, payments, ...computeLoan(restored, payments), ...schedule });
});

app.post("/api/loans/:id/payment-plan", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: rawLoan, error: readError } = await supabase.from(LOANS_TABLE)
    .select("*").eq("id", id).maybeSingle();
  if (readError) return c.json({ error: readError.message }, 500);
  if (!rawLoan) return c.json({ error: "Préstamo no encontrado" }, 404);
  const loan = decodeLoan(rawLoan as LoanRecord);
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const mode = body.payment_mode ?? "interest_first";
  const interestMonths = Number(body.interest_months);
  if (mode !== "monthly" && mode !== "interest_first") return c.json({ error: "Elige una modalidad de cobro válida" }, 400);
  if (mode === "interest_first" && (!Number.isInteger(interestMonths) || interestMonths < 1 || interestMonths >= loan.term_months)) {
    return c.json({ error: "Los meses de interés deben ser menores que el plazo total" }, 400);
  }
  const plan = mode === "interest_first" ? { interest_months: interestMonths } : undefined;
  const notes = loan.extension || plan ? encodeLoanNotes(loan.notes, loan.extension, plan) : loan.notes;
  const candidate = decodeLoan({ ...rawLoan, notes } as LoanRecord);
  const payments = await fetchPaymentsForLoan(supabase, id);
  const schedule = installments(candidate, payments);
  if (schedule.unallocated > 0.001) return c.json({ error: "Hay pagos que exceden el plan; revisa los meses aplicados antes de guardarlo" }, 400);
  const firstCapital = schedule.schedule.find(row => row.principal_amount > 0)?.number ?? loan.term_months + 1;
  if (plan && payments.some(p => p.installment_number && p.installment_number >= firstCapital) &&
      schedule.schedule.slice(0, interestMonths).some(row => row.remaining > 0.001)) {
    return c.json({ error: "Hay pagos ya asignados a meses de capital mientras el interés está pendiente. Corrige esos meses antes de aplicar el plan." }, 400);
  }
  let updateQuery = supabase.from(LOANS_TABLE).update({ notes }).eq("id", id);
  updateQuery = rawLoan.notes === null ? updateQuery.is("notes", null) : updateQuery.eq("notes", rawLoan.notes);
  const { data: updated, error } = await updateQuery.select("id");
  if (error) return c.json({ error: error.message }, 500);
  if (!updated?.length) return c.json({ error: "El préstamo cambió. Recarga la ficha antes de guardar el plan." }, 409);
  return c.json({ ...candidate, payments, ...computeLoan(candidate, payments), ...schedule });
});

app.delete("/api/loans/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: existing } = await supabase
    .from(LOANS_TABLE)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return c.json({ error: "Préstamo no encontrado" }, 404);

  // Los pagos de este prestamo se borran solos (ON DELETE CASCADE).
  const { error } = await supabase.from(LOANS_TABLE).delete().eq("id", id);
  if (error) return c.json({ error: error.message }, 500);

  return c.json({ ok: true });
});

// ---------- Pagos ----------

app.get("/api/loans/:id/payments", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const payments = await fetchPaymentsForLoan(supabase, id);
  return c.json(payments);
});

app.post("/api/loans/:id/payments", async (c) => {
  const supabase = getSupabase(c.env);
  const loanId = c.req.param("id");
  const { data: loan } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", loanId)
    .maybeSingle();
  if (!loan) return c.json({ error: "Préstamo no encontrado" }, 404);
  const currentLoan = decodeLoan(loan as LoanRecord);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ error: "El monto del pago debe ser mayor a 0" }, 400);
  }
  const paymentDate =
    typeof body.payment_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.payment_date)
      ? body.payment_date
      : new Date().toISOString().slice(0, 10);

  const existing = await fetchPaymentsForLoan(supabase, loanId);
  const allocation = installments(currentLoan, existing);
  const installmentNumber = Number(body.installment_number);
  if (!Number.isInteger(installmentNumber) || installmentNumber < 1 || installmentNumber > Number(currentLoan.term_months)) {
    return c.json({ error: "Selecciona una cuota válida del plazo" }, 400);
  }
  const available = allocation.schedule.slice(installmentNumber - 1).reduce((sum, r) => sum + r.remaining, 0);
  if (amount > Math.round(available * 100) / 100 + 0.001) {
    return c.json({ error: "El monto excede el saldo de las cuotas desde el mes seleccionado" }, 400);
  }
  if (currentLoan.payment_plan) {
    const firstUnpaidInterest = allocation.schedule
      .slice(0, currentLoan.payment_plan.interest_months).find(row => row.remaining > 0.001);
    if (firstUnpaidInterest && installmentNumber !== firstUnpaidInterest.number) {
      return c.json({ error: `Primero completa el interés de la cuota ${firstUnpaidInterest.number} antes de pasar al capital o a otro mes` }, 400);
    }
  }
  if (allocation.schedule[installmentNumber - 1].remaining <= 0) {
    return c.json({ error: "La cuota elegida ya está pagada" }, 400);
  }
  if (!Number.isFinite(amount) || Math.round(amount * 100) !== amount * 100) {
    return c.json({ error: "Usa un monto válido con hasta dos decimales" }, 400);
  }
  const id = crypto.randomUUID();
  const userNotes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  const paymentToInsert = {
    id, loan_id: loanId, amount, payment_date: paymentDate,
    installment_number: installmentNumber, notes: userNotes,
  };
  let { error } = await supabase.from(PAYMENTS_TABLE).insert(paymentToInsert);
  // Solo ante la columna faltante: conservar la cuota dentro de notes. Nunca
  // reintentar otros errores, para evitar duplicados o esconder fallos reales.
  if (error && missingInstallmentColumn(error)) {
    ({ error } = await supabase.from(PAYMENTS_TABLE).insert({
      id, loan_id: loanId, amount, payment_date: paymentDate,
      notes: encodePaymentNotes(installmentNumber, userNotes),
    }));
  }
  if (error) return c.json({ error: error.message }, 500);

  const payments = await fetchPaymentsForLoan(supabase, loanId);
  const computed = computeLoan(currentLoan, payments);
  return c.json(
    { payment: { id, loan_id: loanId, amount, payment_date: paymentDate, installment_number: installmentNumber }, payments, ...computed },
    201
  );
});

app.delete("/api/payments/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: payment } = await supabase
    .from(PAYMENTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle<{ loan_id: string }>();
  if (!payment) return c.json({ error: "Pago no encontrado" }, 404);

  await supabase.from(PAYMENTS_TABLE).delete().eq("id", id);

  const { data: loan } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", payment.loan_id)
    .maybeSingle();
  const payments = await fetchPaymentsForLoan(supabase, payment.loan_id);
  const computed = loan
    ? computeLoan(decodeLoan(loan as LoanRecord), payments)
    : null;

  return c.json({ ok: true, payments, ...computed });
});

// ---------- Panel / dashboard ----------

app.get("/api/dashboard", async (c) => {
  const supabase = getSupabase(c.env);
  const loans = await fetchAllLoansJoined(supabase);
  const paymentsMap = await fetchAllPaymentsGrouped(supabase);
  const computedLoans = loans.map((l) => ({
    ...l,
    ...computeLoan(l, paymentsMap.get(l.id) || []),
  }));

  const totals = computedLoans.reduce(
    (acc, l) => {
      acc.capitalPrestado += l.principal;
      acc.totalCobrado += l.totalPaid;
      acc.gananciaProyectada += l.totalInterest;
      acc.saldoPendiente += l.pendingBalance;
      if (l.totalToPay > 0) {
        acc.gananciaCobrada += l.totalPaid * (l.totalInterest / l.totalToPay);
      }
      if (l.status === "activo") acc.activos += 1;
      if (l.status === "pagado") acc.pagados += 1;
      if (l.status === "atrasado") acc.atrasados += 1;
      return acc;
    },
    {
      capitalPrestado: 0,
      totalCobrado: 0,
      gananciaProyectada: 0,
      gananciaCobrada: 0,
      saldoPendiente: 0,
      activos: 0,
      pagados: 0,
      atrasados: 0,
    }
  );

  (Object.keys(totals) as Array<keyof typeof totals>).forEach((k) => {
    totals[k] = round2(totals[k]);
  });

  const { count: clientsCount } = await supabase
    .from(CLIENTS_TABLE)
    .select("*", { count: "exact", head: true });

  const { data: recentPaymentsRaw } = await supabase
    .from(PAYMENTS_TABLE)
    .select(`id, amount, payment_date, loan_id, loan:${LOANS_TABLE}(client:${CLIENTS_TABLE}(name))`)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8);

  const recentPayments = ((recentPaymentsRaw as any[]) || []).map((p) => ({
    id: p.id,
    amount: p.amount,
    payment_date: p.payment_date,
    loan_id: p.loan_id,
    client_name: p.loan?.client?.name ?? "",
  }));

  const overdueLoans = computedLoans
    .filter((l) => l.status === "atrasado")
    .sort((a, b) => b.overdueAmount - a.overdueAmount)
    .slice(0, 10);

  return c.json({
    totals,
    loansCount: computedLoans.length,
    clientsCount: clientsCount || 0,
    overdueLoans,
    recentPayments,
  });
});

// ---------- Estatico + arranque ----------

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Bindings>;
