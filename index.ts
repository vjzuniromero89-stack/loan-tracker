import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
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
      return { ...loan, ...computeLoan(loan, payments), paymentsList: payments };
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
      return { ...loan, ...computeLoan(loan, payments), paymentsList: payments };
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

  const id = crypto.randomUUID();
  const { error } = await supabase.from(LOANS_TABLE).insert({
    id,
    client_id: clientId,
    principal: validated.principal,
    interest_rate: validated.interestRate,
    term_months: validated.termMonths,
    start_date: validated.startDate,
    notes: (body.notes as string) || null,
  });
  if (error) return c.json({ error: error.message }, 500);

  const { data: loan } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  return c.json({ ...(loan as LoanRecord), ...computeLoan(loan as LoanRecord, []) }, 201);
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

  const { client, ...loan } = loanRow;
  const loanWithClient = {
    ...loan,
    client_name: client?.name ?? "",
    client_phone: client?.phone ?? null,
  };

  const payments = await fetchPaymentsForLoan(supabase, id);
  const computed = computeLoan(loan as LoanRecord, payments);
  return c.json({ ...loanWithClient, payments, ...computed });
});

app.put("/api/loans/:id", async (c) => {
  const supabase = getSupabase(c.env);
  const id = c.req.param("id");
  const { data: existing } = await supabase
    .from(LOANS_TABLE)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return c.json({ error: "Préstamo no encontrado" }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const validated = validateLoanInput(body);
  if ("error" in validated) return c.json(validated, 400);

  const { error } = await supabase
    .from(LOANS_TABLE)
    .update({
      principal: validated.principal,
      interest_rate: validated.interestRate,
      term_months: validated.termMonths,
      start_date: validated.startDate,
      notes: (body.notes as string) || null,
    })
    .eq("id", id);
  if (error) return c.json({ error: error.message }, 500);

  const { data: loan } = await supabase
    .from(LOANS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const payments = await fetchPaymentsForLoan(supabase, id);
  return c.json({ ...(loan as LoanRecord), payments, ...computeLoan(loan as LoanRecord, payments) });
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

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ error: "El monto del pago debe ser mayor a 0" }, 400);
  }
  const paymentDate =
    typeof body.payment_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.payment_date)
      ? body.payment_date
      : new Date().toISOString().slice(0, 10);

  const id = crypto.randomUUID();
  const { error } = await supabase.from(PAYMENTS_TABLE).insert({
    id,
    loan_id: loanId,
    amount,
    payment_date: paymentDate,
    notes: (body.notes as string) || null,
  });
  if (error) return c.json({ error: error.message }, 500);

  const payments = await fetchPaymentsForLoan(supabase, loanId);
  const computed = computeLoan(loan as unknown as LoanRecord, payments);
  return c.json(
    { payment: { id, loan_id: loanId, amount, payment_date: paymentDate }, payments, ...computed },
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
    ? computeLoan(loan as unknown as LoanRecord, payments)
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
