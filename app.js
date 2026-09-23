"use strict";

/* ==================== Utilidades ==================== */

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function formatMoney(n) {
  const v = Number(n) || 0;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(s) {
  if (!s) return "-";
  const parts = String(s).slice(0, 10).split("-");
  if (parts.length !== 3) return s;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function buildPortalUrl(clientId, accessToken) {
  return `${location.origin}${location.pathname}#/portal/${clientId}/${accessToken || ""}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

const STATUS_LABELS = { activo: "Activo", pagado: "Pagado", atrasado: "Atrasado" };

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

/* ==================== Avatares ==================== */

const AVATAR_COLORS = ["#2c4a72", "#3f6b4f", "#8a5a2b", "#5c4b7a", "#8a6d1f", "#2f6b6b", "#6b3f52", "#45607a"];

function avatarColor(name) {
  let hash = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatar(name, size) {
  size = size || "md";
  return `<span class="avatar ${size}" style="background:${avatarColor(name)}">${escapeHtml(initials(name))}</span>`;
}

/* ==================== Cascada de cobro (ganancia primero, luego capital) ==================== */

function buildWaterfall(loan) {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const gananciaTotal = loan.totalInterest;
  const gananciaCobrada = round2(Math.min(loan.totalPaid, gananciaTotal));
  const gananciaPct = gananciaTotal > 0 ? Math.min(round2((gananciaCobrada / gananciaTotal) * 100), 100) : 100;
  const gananciaDone = gananciaTotal <= 0 || gananciaCobrada >= gananciaTotal - 0.005;

  const capitalTotal = loan.principal;
  const capitalRecuperado = round2(Math.min(Math.max(loan.totalPaid - gananciaTotal, 0), capitalTotal));
  const capitalPct = capitalTotal > 0 ? Math.min(round2((capitalRecuperado / capitalTotal) * 100), 100) : 100;
  const capitalDone = capitalRecuperado >= capitalTotal - 0.005;

  const gananciaPhase = gananciaDone ? "done" : "active";
  const capitalPhase = capitalDone ? "done" : (gananciaDone ? "active" : "locked");

  return `
    <div class="waterfall">
      <div class="wf-phase ${gananciaPhase}">
        <div class="wf-head">
          <span class="wf-icon profit-icon">${gananciaDone ? "✓" : "1"}</span>
          <span class="wf-title">Ganancia (interés)</span>
          <span class="wf-amt num">${formatMoney(gananciaCobrada)} / ${formatMoney(gananciaTotal)}</span>
        </div>
        <div class="wf-track"><div class="wf-fill profit" data-w="${gananciaPct}"></div></div>
        ${gananciaDone
          ? `<div class="wf-note">✓ Ganancia totalmente recuperada</div>`
          : `<div class="wf-note muted">Cada pago cubre primero tu ganancia</div>`}
      </div>
      <div class="wf-phase ${capitalPhase}">
        <div class="wf-head">
          <span class="wf-icon capital-icon">${capitalDone ? "✓" : "2"}</span>
          <span class="wf-title">Capital</span>
          <span class="wf-amt num">${formatMoney(capitalRecuperado)} / ${formatMoney(capitalTotal)}</span>
        </div>
        <div class="wf-track"><div class="wf-fill capital" data-w="${capitalPct}"></div></div>
        ${capitalPhase === "locked"
          ? `<div class="wf-note muted">Se activa en cuanto termines de cobrar la ganancia</div>`
          : (capitalDone
            ? `<div class="wf-note">✓ Capital totalmente recuperado</div>`
            : `<div class="wf-note muted">Ya estás recuperando tu capital prestado</div>`)}
      </div>
    </div>`;
}

// Barra de dos colores: cuánto de todo lo que este cliente va a pagar en
// total es capital (lo que se le prestó) y cuánto es ganancia (interés).
function buildSplitSummary(totals) {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  if (!totals.prestado) return "";
  // La ganancia se muestra como porcentaje del capital prestado (lo mismo
  // que el interés que le cobras al cliente): si prestas $5,000 al 40%,
  // la ganancia es 40% y el capital ocupa el resto de la barra.
  let pctGanancia = Math.round((totals.ganancia / totals.prestado) * 100);
  pctGanancia = Math.min(Math.max(pctGanancia, 0), 100);
  const pctCapital = 100 - pctGanancia;

  const seg = (pct, extraClass, label) =>
    `<div class="split-seg ${extraClass}" data-w="${pct}" style="width:0%">${pct >= 12 ? `<span>${pct}%</span>` : ""}</div>`;

  return `
    <div class="split-summary">
      <div class="split-summary-head">
        <span class="split-legend"><span class="split-dot dot-primary"></span>Capital <b class="num">${pctCapital}%</b> <span class="muted">· ${formatMoney(round2(totals.prestado))}</span></span>
        <span class="split-legend"><span class="split-dot dot-profit"></span>Ganancia <b class="num">${pctGanancia}%</b> <span class="muted">· ${formatMoney(round2(totals.ganancia))}</span></span>
      </div>
      <div class="split-bar">
        ${seg(pctCapital, "seg-primary")}
        ${seg(pctGanancia, "seg-profit")}
      </div>
    </div>`;
}

function animateSplitBars() {
  const segs = document.querySelectorAll(".split-seg[data-w]");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      segs.forEach((el) => { el.style.width = el.dataset.w + "%"; });
    });
  });
}

function animateWaterfall() {
  const fills = document.querySelectorAll(".wf-fill[data-w]");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fills.forEach((el) => { el.style.width = el.dataset.w + "%"; });
    });
  });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* respuesta vacia */ }
  if (!res.ok) {
    const message = (data && data.error) || `Error ${res.status}`;
    throw new Error(message);
  }
  return data;
}

/* ==================== Toasts ==================== */

const toastRoot = document.getElementById("toast-root");

function showToast(message, type = "error") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

/* ==================== Modal ==================== */

const modalRoot = document.getElementById("modal-root");

function openModal(title, bodyHtml, opts = {}) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-card ${opts.size === "lg" ? "modal-lg" : ""}">
        <div class="modal-header">
          <h2>${escapeHtml(title)}</h2>
          <button class="modal-close" id="modal-close-btn" aria-label="Cerrar">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  document.getElementById("modal-close-btn").onclick = closeModal;
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
  if (opts.onMount) opts.onMount(modalRoot);
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function confirmModal(message, onConfirm, confirmLabel = "Eliminar") {
  openModal("Confirmar", `
    <p>${escapeHtml(message)}</p>
    <div class="form-actions">
      <button class="btn-secondary" id="confirm-cancel">Cancelar</button>
      <button class="btn-danger" id="confirm-ok">${escapeHtml(confirmLabel)}</button>
    </div>`, {
    onMount: (root) => {
      root.querySelector("#confirm-cancel").onclick = closeModal;
      root.querySelector("#confirm-ok").onclick = async () => {
        closeModal();
        try {
          await onConfirm();
        } catch (e) {
          showToast(e.message);
        }
      };
    },
  });
}

/* ==================== Router ==================== */

const contentEl = document.getElementById("app-content");
const pageTitleEl = document.getElementById("page-title");
const topbarDateEl = document.getElementById("topbar-date");
if (topbarDateEl) topbarDateEl.textContent = formatDate(todayStr());

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "dashboard";
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const query = new URLSearchParams(queryPart || "");
  return { segments, query };
}

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("active", el.dataset.nav === name);
  });
}

async function route() {
  const { segments, query } = parseHash();
  const section = segments[0] || "dashboard";

  if (section === "portal") {
    pageTitleEl.textContent = "Tu préstamo";
    try {
      await renderPortalClient(segments[1], segments[2]);
    } catch (e) {
      contentEl.innerHTML = `<div class="panel"><p class="error-text">${escapeHtml(e.message)}</p></div>`;
    }
    return;
  }

  setActiveNav(section);

  try {
    if (section === "clients" && segments[1]) {
      pageTitleEl.textContent = "Cliente";
      await renderClientDetail(segments[1]);
    } else if (section === "clients") {
      pageTitleEl.textContent = "Clientes";
      await renderClients();
    } else if (section === "loans" && segments[1]) {
      pageTitleEl.textContent = "Préstamo";
      await renderLoanDetail(segments[1]);
    } else if (section === "loans") {
      pageTitleEl.textContent = "Préstamos";
      await renderLoans(query.get("status"));
    } else {
      pageTitleEl.textContent = "Panel";
      await renderDashboard();
    }
  } catch (e) {
    contentEl.innerHTML = `<div class="panel"><p class="error-text">${escapeHtml(e.message)}</p></div>`;
  }
}

window.addEventListener("hashchange", route);

/* ==================== Dashboard ==================== */

async function renderDashboard() {
  contentEl.innerHTML = `<p class="loading">Cargando…</p>`;
  const data = await api("/api/dashboard");
  const t = data.totals;

  const overdueRows = data.overdueLoans.length
    ? data.overdueLoans.map((l) => `
        <tr data-loan-id="${l.id}">
          <td>${escapeHtml(l.client_name)}</td>
          <td>${formatMoney(l.overdueAmount)}</td>
          <td>${formatMoney(l.pendingBalance)}</td>
          <td>${l.nextDueDate ? formatDate(l.nextDueDate) : "-"}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="empty-state">No hay préstamos atrasados 🎉</td></tr>`;

  const paymentRows = data.recentPayments.length
    ? data.recentPayments.map((p) => `
        <tr data-loan-id="${p.loan_id}">
          <td>${formatDate(p.payment_date)}</td>
          <td>${escapeHtml(p.client_name)}</td>
          <td>${formatMoney(p.amount)}</td>
        </tr>`).join("")
    : `<tr><td colspan="3" class="empty-state">Todavía no hay pagos registrados</td></tr>`;

  contentEl.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent-primary">
        <div class="stat-icon">💰</div>
        <div class="stat-label">Capital Prestado</div>
        <div class="stat-value">${formatMoney(t.capitalPrestado)}</div>
      </div>
      <div class="stat-card accent-success">
        <div class="stat-icon">📥</div>
        <div class="stat-label">Pagos Recibidos</div>
        <div class="stat-value">${formatMoney(t.totalCobrado)}</div>
      </div>
      <div class="stat-card accent-profit">
        <div class="stat-icon">📈</div>
        <div class="stat-label">Ganancia Proyectada</div>
        <div class="stat-value">${formatMoney(t.gananciaProyectada)}</div>
      </div>
      <div class="stat-card accent-danger">
        <div class="stat-icon">⚠️</div>
        <div class="stat-label">Saldo por Cobrar</div>
        <div class="stat-value">${formatMoney(t.saldoPendiente)}</div>
      </div>
    </div>

    <div class="chip-row">
      <a class="chip" href="#/loans?status=activo">Activos: ${t.activos}</a>
      <a class="chip" href="#/loans?status=pagado">Pagados: ${t.pagados}</a>
      <a class="chip" href="#/loans?status=atrasado">Atrasados: ${t.atrasados}</a>
      <span class="chip" style="cursor:default">Ganancia ya cobrada: ${formatMoney(t.gananciaCobrada)}</span>
    </div>

    <div class="panel">
      <div class="panel-header"><h2>⚠️ Préstamos atrasados</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th>Monto atrasado</th><th>Saldo</th><th>Próximo pago</th></tr></thead>
          <tbody>${overdueRows}</tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h2>Pagos recientes</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Monto</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </div>
    </div>
  `;

  contentEl.querySelectorAll("tr[data-loan-id]").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/loans/${row.dataset.loanId}`; });
  });
}

/* ==================== Clientes ==================== */

let clientsCache = [];

function clientFormHtml(client = {}) {
  return `
    <div class="form-grid">
      <div class="field full">
        <label>Nombre *</label>
        <input type="text" id="f-name" value="${escapeHtml(client.name || "")}" required />
      </div>
      <div class="field">
        <label>Teléfono</label>
        <input type="text" id="f-phone" value="${escapeHtml(client.phone || "")}" />
      </div>
      <div class="field">
        <label>Correo</label>
        <input type="email" id="f-email" value="${escapeHtml(client.email || "")}" />
      </div>
      <div class="field full">
        <label>Dirección</label>
        <input type="text" id="f-address" value="${escapeHtml(client.address || "")}" />
      </div>
      <div class="field full">
        <label>Notas</label>
        <textarea id="f-notes">${escapeHtml(client.notes || "")}</textarea>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn-secondary" id="cancel-btn">Cancelar</button>
      <button type="submit" class="btn-primary">Guardar</button>
    </div>
  `;
}

function openClientModal(client = null) {
  const isEdit = !!client;
  openModal(isEdit ? "Editar cliente" : "Nuevo cliente", `<form id="client-form">${clientFormHtml(client || {})}</form>`, {
    onMount: (root) => {
      root.querySelector("#cancel-btn").onclick = closeModal;
      root.querySelector("#client-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          name: root.querySelector("#f-name").value.trim(),
          phone: root.querySelector("#f-phone").value.trim(),
          email: root.querySelector("#f-email").value.trim(),
          address: root.querySelector("#f-address").value.trim(),
          notes: root.querySelector("#f-notes").value.trim(),
        };
        try {
          if (isEdit) {
            await api(`/api/clients/${client.id}`, { method: "PUT", body: JSON.stringify(payload) });
            showToast("Cliente actualizado", "success");
          } else {
            await api("/api/clients", { method: "POST", body: JSON.stringify(payload) });
            showToast("Cliente creado", "success");
          }
          closeModal();
          route();
        } catch (err) {
          showToast(err.message);
        }
      });
    },
  });
}

function clientRowHtml(c) {
  const s = c.summary || {};
  return `
    <tr data-id="${c.id}">
      <td><div class="name-cell">${avatar(c.name, "sm")}<span>${escapeHtml(c.name)}</span></div></td>
      <td>${escapeHtml(c.phone || "-")}</td>
      <td>${s.loansCount || 0}</td>
      <td>${formatMoney(s.totalPrestado)}</td>
      <td>${formatMoney(s.totalPendiente)}</td>
      <td>
        ${s.activeCount ? `<span class="badge badge-activo">${s.activeCount} activo(s)</span>` : ""}
        ${s.lateCount ? `<span class="badge badge-atrasado">${s.lateCount} atrasado(s)</span>` : ""}
        ${!s.activeCount && !s.lateCount ? `<span class="muted">-</span>` : ""}
      </td>
    </tr>`;
}

function renderClientsTable(list) {
  const rows = list.length
    ? list.map(clientRowHtml).join("")
    : `<tr><td colspan="6" class="empty-state">No hay clientes registrados todavía</td></tr>`;
  const tableWrap = document.getElementById("clients-table-wrap");
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Nombre</th><th>Teléfono</th><th>Préstamos</th><th>Prestado</th><th>Pendiente</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  tableWrap.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/clients/${row.dataset.id}`; });
  });
}

async function renderClients() {
  contentEl.innerHTML = `<p class="loading">Cargando…</p>`;
  clientsCache = await api("/api/clients");

  contentEl.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <input type="text" class="search-input" id="client-search" placeholder="Buscar cliente por nombre o teléfono…" />
        <button class="btn-primary" id="new-client-btn">+ Nuevo cliente</button>
      </div>
      <div class="table-wrap" id="clients-table-wrap" style="margin-top:14px;"></div>
    </div>
  `;

  renderClientsTable(clientsCache);

  document.getElementById("new-client-btn").addEventListener("click", () => openClientModal());
  document.getElementById("client-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = clientsCache.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q)
    );
    renderClientsTable(filtered);
  });
}

async function renderClientDetail(id) {
  contentEl.innerHTML = `<p class="loading">Cargando…</p>`;
  const client = await api(`/api/clients/${id}`);
  pageTitleEl.textContent = client.name;

  const loanRows = client.loans.length
    ? client.loans.map((l) => `
        <tr data-id="${l.id}">
          <td>${formatDate(l.start_date)}</td>
          <td>${formatMoney(l.principal)}</td>
          <td>${l.interest_rate}%</td>
          <td>${l.term_months} m</td>
          <td>${formatMoney(l.monthlyPayment)}</td>
          <td>${l.percentPaid}%</td>
          <td>${formatMoney(l.pendingBalance)}</td>
          <td>${statusBadge(l.status)}</td>
        </tr>`).join("")
    : `<tr><td colspan="8" class="empty-state">Este cliente todavía no tiene préstamos</td></tr>`;

  const clientTotals = client.loans.reduce(
    (acc, l) => {
      acc.prestado += l.principal;
      acc.pagado += l.totalPaid;
      acc.pendiente += l.pendingBalance;
      acc.ganancia += l.totalInterest;
      acc.totalAPagar += l.totalToPay;
      return acc;
    },
    { prestado: 0, pagado: 0, pendiente: 0, ganancia: 0, totalAPagar: 0 }
  );

  const allPayments = client.loans
    .flatMap((l) => (l.paymentsList || []).map((p) => ({ ...p, loanPrincipal: l.principal, loanStartDate: l.start_date, loanId: l.id })))
    .sort((a, b) => (b.payment_date || "").localeCompare(a.payment_date || ""));

  const paymentRows = allPayments.length
    ? allPayments.map((p) => `
        <tr data-id="${p.loanId}">
          <td>${formatDate(p.payment_date)}</td>
          <td>Préstamo de ${formatMoney(p.loanPrincipal)} (${formatDate(p.loanStartDate)})</td>
          <td>${formatMoney(p.amount)}</td>
          <td>${escapeHtml(p.notes || "-")}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="empty-state">Este cliente todavía no ha hecho pagos</td></tr>`;

  contentEl.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="profile-head">
          ${avatar(client.name, "lg")}
          <h2>${escapeHtml(client.name)}</h2>
        </div>
        <div class="actions">
          <button class="btn-secondary btn-sm" id="edit-client-btn">Editar</button>
          <button class="btn-danger btn-sm" id="delete-client-btn">Eliminar</button>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Teléfono</div><div class="detail-value">${escapeHtml(client.phone || "-")}</div></div>
        <div class="detail-item"><div class="detail-label">Correo</div><div class="detail-value">${escapeHtml(client.email || "-")}</div></div>
        <div class="detail-item"><div class="detail-label">Dirección</div><div class="detail-value">${escapeHtml(client.address || "-")}</div></div>
      </div>
      ${client.notes ? `<p class="muted" style="margin-top:12px;">${escapeHtml(client.notes)}</p>` : ""}
      <div class="portal-link-box">
        <div class="detail-label">Link para ${escapeHtml(client.name)}</div>
        <p class="muted" style="margin:2px 0 8px;font-size:0.82rem;">Compártelo con tu cliente para que vea el estado de su préstamo. Solo puede ver, no puede editar nada.</p>
        <div class="portal-link-row">
          <input type="text" id="portal-link-input" readonly value="${escapeHtml(buildPortalUrl(client.id, client.access_token))}" />
          <button class="btn-secondary btn-sm" id="copy-portal-link-btn">Copiar link</button>
        </div>
      </div>
      <div class="stat-grid" style="margin-top:16px;">
        <div class="stat-card accent-primary"><div class="stat-icon">💰</div><div class="stat-label">Total prestado</div><div class="stat-value">${formatMoney(clientTotals.prestado)}</div></div>
        <div class="stat-card accent-success"><div class="stat-icon">📥</div><div class="stat-label">Total pagado</div><div class="stat-value">${formatMoney(clientTotals.pagado)}</div></div>
        <div class="stat-card ${clientTotals.pendiente > 0 ? "accent-danger" : "accent-success"}"><div class="stat-icon">${clientTotals.pendiente > 0 ? "⚠️" : "✅"}</div><div class="stat-label">Saldo pendiente</div><div class="stat-value">${formatMoney(clientTotals.pendiente)}</div></div>
      </div>
      ${client.loans.length ? buildSplitSummary(clientTotals) : ""}
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Préstamos</h2>
        <div class="actions"><button class="btn-primary btn-sm" id="new-loan-btn">+ Nuevo préstamo</button></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Inicio</th><th>Monto</th><th>Interés</th><th>Plazo</th><th>Cuota</th><th>Pagado</th><th>Saldo</th><th>Estado</th></tr></thead>
          <tbody>${loanRows}</tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2>Historial de pagos</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Préstamo</th><th>Monto</th><th class="wrap">Notas</th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </div>
    </div>
  `;

  animateSplitBars();

  contentEl.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/loans/${row.dataset.id}`; });
  });

  const portalLinkInput = document.getElementById("portal-link-input");
  portalLinkInput.addEventListener("click", () => portalLinkInput.select());
  document.getElementById("copy-portal-link-btn").addEventListener("click", async () => {
    portalLinkInput.select();
    const ok = await copyToClipboard(portalLinkInput.value);
    showToast(ok ? "Link copiado" : "No se pudo copiar automáticamente; el link ya está seleccionado, cópialo con Ctrl+C", ok ? "success" : "error");
  });

  document.getElementById("edit-client-btn").addEventListener("click", () => openClientModal(client));
  document.getElementById("delete-client-btn").addEventListener("click", () => {
    confirmModal(
      `¿Eliminar a "${client.name}" y todos sus préstamos y pagos? Esta acción no se puede deshacer.`,
      async () => {
        await api(`/api/clients/${id}`, { method: "DELETE" });
        showToast("Cliente eliminado", "success");
        location.hash = "#/clients";
      }
    );
  });
  document.getElementById("new-loan-btn").addEventListener("click", () => openLoanModal(null, client));
}

/* ==================== Portal de solo lectura para el cliente ==================== */

async function renderPortalClient(clientId, token) {
  contentEl.innerHTML = `<p class="loading">Cargando…</p>`;

  if (!clientId || !token) {
    contentEl.innerHTML = `<div class="panel"><p class="error-text">Este enlace no es válido.</p></div>`;
    return;
  }

  let client;
  try {
    client = await api(`/api/portal/${encodeURIComponent(clientId)}/${encodeURIComponent(token)}`);
  } catch (e) {
    contentEl.innerHTML = `
      <div class="panel" style="max-width:440px;margin:40px auto;text-align:center;">
        <p class="error-text">Este enlace no es válido o ya no está disponible.</p>
        <p class="muted">Si crees que esto es un error, contacta a la persona que te lo compartió.</p>
      </div>`;
    return;
  }

  pageTitleEl.textContent = client.name;

  const loanBlocks = client.loans.length
    ? client.loans.map((l) => {
        const allocationByPayment = new Map();
        for (const allocation of l.allocations || []) {
          const list = allocationByPayment.get(allocation.payment_id) || [];
          list.push(allocation);
          allocationByPayment.set(allocation.payment_id, list);
        }
        const paymentRows = (l.paymentsList || []).length
          ? l.paymentsList.slice().reverse().map((p) => `
              <tr>
                <td>${formatDate(p.payment_date)}</td>
                <td>${formatMoney(p.amount)}</td>
                <td>${(allocationByPayment.get(p.id) || []).map(item => `${escapeHtml(new Date(item.due_date + "T12:00:00Z").toLocaleDateString("es", { month: "long", year: "numeric", timeZone: "UTC" }))}: ${formatMoney(item.amount)}${l.payment_plan ? ` (${formatMoney(item.interest_amount)} interés, ${formatMoney(item.principal_amount)} capital)` : ""}`).join("<br>") || "-"}</td>
                <td class="wrap">${escapeHtml(p.notes || "-")}</td>
              </tr>`).join("")
          : `<tr><td colspan="4" class="empty-state">Todavía no hay pagos registrados</td></tr>`;

        const overdueNote = l.status === "atrasado"
          ? `<p class="error-text">Atrasado por ${formatMoney(l.overdueAmount)} respecto a lo esperado a la fecha.</p>`
          : "";

        return `
          <div class="panel">
            <div class="panel-header">
              <h2>Préstamo del ${formatDate(l.start_date)} ${statusBadge(l.status)}</h2>
            </div>
            <div class="detail-grid">
              <div class="detail-item"><div class="detail-label">Monto prestado</div><div class="detail-value v-primary">${formatMoney(l.principal)}</div></div>
              <div class="detail-item"><div class="detail-label">Interés total</div><div class="detail-value">${l.interest_rate}%</div></div>
              <div class="detail-item"><div class="detail-label">Plazo</div><div class="detail-value">${l.term_months} meses</div></div>
              <div class="detail-item"><div class="detail-label">Total a pagar</div><div class="detail-value v-primary">${formatMoney(l.totalToPay)}</div></div>
              <div class="detail-item"><div class="detail-label">${l.payment_plan ? "Cuota de interés" : l.extension ? "Cuota original" : "Cuota mensual"}</div><div class="detail-value v-primary">${formatMoney(l.monthlyPayment)}</div></div>
              <div class="detail-item"><div class="detail-label">Total pagado</div><div class="detail-value v-success">${formatMoney(l.totalPaid)}</div></div>
              <div class="detail-item"><div class="detail-label">Saldo pendiente</div><div class="detail-value ${l.pendingBalance > 0 ? "v-danger" : "v-success"}">${formatMoney(l.pendingBalance)}</div></div>
              <div class="detail-item"><div class="detail-label">Próximo vencimiento</div><div class="detail-value">${l.nextDueDate ? formatDate(l.nextDueDate) : "-"}</div></div>
            </div>
            <div style="margin-top:16px;">
              <div class="detail-label" style="margin-bottom:6px;">Progreso: ${l.percentPaid}%</div>
              <div class="progress-track"><div class="progress-fill ${l.status === "pagado" ? "is-complete" : ""}" style="width:${Math.min(l.percentPaid, 100)}%"></div></div>
            </div>
            ${overdueNote}
            ${renderExtensionSummary(l)}
            ${renderPaymentPlanSummary(l)}
            ${l.notes ? `<div class="portal-loan-note"><strong>Nota del préstamo</strong><p>${escapeHtml(l.notes)}</p></div>` : ""}
          </div>
          ${renderInstallmentCalendar(l)}
          <div class="panel">
            <div class="panel-header"><h2>Historial de pagos</h2></div>
            <div class="table-wrap" style="margin-top:16px;">
              <table>
                <thead><tr><th>Fecha cobrada</th><th>Monto</th><th>Mes aplicado</th><th class="wrap">Notas</th></tr></thead>
                <tbody>${paymentRows}</tbody>
              </table>
            </div>
          </div>`;
      }).join("")
    : `<div class="panel"><p class="empty-state">Todavía no hay préstamos registrados a tu nombre.</p></div>`;

  contentEl.innerHTML = `
    <div class="panel portal-welcome">
      <h2 style="margin:0;">Hola, ${escapeHtml(client.name)} 👋</h2>
      <p class="muted" style="margin-top:6px;">Aquí puedes ver el estado de tu(s) préstamo(s). Esta vista es de solo lectura.</p>
    </div>
    ${loanBlocks}
  `;
}

/* ==================== Prestamos ==================== */

function loanFormHtml(loan, clients, preselectedClient) {
  const options = clients.map((c) =>
    `<option value="${c.id}" ${((loan && loan.client_id) || (preselectedClient && preselectedClient.id)) === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
  ).join("");

  return `
    <div class="form-grid">
      <div class="field full">
        <label>Cliente *</label>
        <select id="f-client" ${loan ? "disabled" : ""} required>${options}</select>
      </div>
      <div class="field">
        <label>Monto prestado *</label>
        <input type="number" id="f-principal" ${loan?.extension || loan?.payment_plan ? "readonly" : ""} min="0.01" step="0.01" value="${loan ? loan.principal : ""}" required />
      </div>
      <div class="field">
        <label>Interés total del préstamo (%) *</label>
        <input type="number" id="f-rate" ${loan?.extension || loan?.payment_plan ? "readonly" : ""} min="0" step="0.01" value="${loan ? loan.interest_rate : ""}" required />
      </div>
      <div class="field">
        <label>Plazo (meses) *</label>
        <input type="number" id="f-term" ${loan?.extension || loan?.payment_plan ? "readonly" : ""} min="1" step="1" value="${loan ? loan.term_months : ""}" required />
      </div>
      <div class="field">
        <label>Fecha de inicio *</label>
        <input type="date" id="f-start" ${loan?.extension || loan?.payment_plan ? "readonly" : ""} value="${loan ? loan.start_date : todayStr()}" required />
      </div>
      <div class="field full">
        <p class="muted" style="margin:0;font-size:0.85rem;">${loan?.extension || loan?.payment_plan ? "Este préstamo tiene un calendario acordado. Puedes editar la nota; las condiciones y los pagos quedan protegidos." : "Ejemplo: $5,000 al 40% = $2,000 de interés total → $7,000 a pagar, sea cual sea el plazo."}</p>
      </div>
      <div class="field full">
        <label>Notas</label>
        <textarea id="f-notes">${escapeHtml((loan && loan.notes) || "")}</textarea>
      </div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn-secondary" id="cancel-btn">Cancelar</button>
      <button type="submit" class="btn-primary">Guardar</button>
    </div>
  `;
}

async function openLoanModal(loan, preselectedClient) {
  const isEdit = !!loan;
  const clients = isEdit ? [] : (clientsCache.length ? clientsCache : await api("/api/clients"));

  openModal(isEdit ? "Editar préstamo" : "Nuevo préstamo", `<form id="loan-form">${loanFormHtml(loan, clients, preselectedClient)}</form>`, {
    size: "lg",
    onMount: (root) => {
      root.querySelector("#cancel-btn").onclick = closeModal;
      root.querySelector("#loan-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          client_id: isEdit ? loan.client_id : root.querySelector("#f-client").value,
          principal: root.querySelector("#f-principal").value,
          interest_rate: root.querySelector("#f-rate").value,
          term_months: root.querySelector("#f-term").value,
          start_date: root.querySelector("#f-start").value,
          notes: root.querySelector("#f-notes").value.trim(),
        };
        try {
          if (isEdit) {
            await api(`/api/loans/${loan.id}`, { method: "PUT", body: JSON.stringify(payload) });
            showToast("Préstamo actualizado", "success");
          } else {
            await api("/api/loans", { method: "POST", body: JSON.stringify(payload) });
            showToast("Préstamo creado", "success");
          }
          closeModal();
          route();
        } catch (err) {
          showToast(err.message);
        }
      });
    },
  });
}

function loanRowHtml(l) {
  return `
    <tr data-id="${l.id}">
      <td>${escapeHtml(l.client_name)}</td>
      <td>${formatMoney(l.principal)}</td>
      <td>${l.interest_rate}%</td>
      <td>${l.term_months} m</td>
      <td>${formatMoney(l.monthlyPayment)}</td>
      <td>${l.percentPaid}%</td>
      <td>${formatMoney(l.pendingBalance)}</td>
      <td>${statusBadge(l.status)}</td>
    </tr>`;
}

function renderLoansTable(list) {
  const rows = list.length
    ? list.map(loanRowHtml).join("")
    : `<tr><td colspan="8" class="empty-state">No hay préstamos que coincidan</td></tr>`;
  const wrap = document.getElementById("loans-table-wrap");
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Cliente</th><th>Monto</th><th>Interés</th><th>Plazo</th><th>Cuota</th><th>Pagado</th><th>Saldo</th><th>Estado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/loans/${row.dataset.id}`; });
  });
}

async function renderLoans(statusFilter) {
  contentEl.innerHTML = `<p class="loading">Cargando…</p>`;
  const [loans, clients] = await Promise.all([api("/api/loans"), api("/api/clients")]);
  clientsCache = clients;

  const chip = (label, value) => `
    <a class="chip ${statusFilter === value ? "active" : ""}" href="#/loans${value ? `?status=${value}` : ""}">${label}</a>`;

  contentEl.innerHTML = `
    <div class="chip-row">
      ${chip("Todos", "")}
      ${chip("Activos", "activo")}
      ${chip("Pagados", "pagado")}
      ${chip("Atrasados", "atrasado")}
    </div>
    <div class="panel">
      <div class="toolbar">
        <input type="text" class="search-input" id="loan-search" placeholder="Buscar por cliente…" />
        <button class="btn-primary" id="new-loan-btn">+ Nuevo préstamo</button>
      </div>
      <div class="table-wrap" id="loans-table-wrap" style="margin-top:14px;"></div>
    </div>
  `;

  let currentList = statusFilter ? loans.filter((l) => l.status === statusFilter) : loans;
  renderLoansTable(currentList);

  document.getElementById("new-loan-btn").addEventListener("click", () => openLoanModal(null, null));
  document.getElementById("loan-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    renderLoansTable(currentList.filter((l) => l.client_name.toLowerCase().includes(q)));
  });
}

async function renderLoanDetail(id) {
  contentEl.innerHTML = `<p class="loading">Cargando…</p>`;
  const loan = await api(`/api/loans/${id}`);
  pageTitleEl.textContent = `Préstamo de ${loan.client_name}`;

  const allocationByPayment = new Map();
  for (const a of loan.allocations || []) {
    const list = allocationByPayment.get(a.payment_id) || [];
    list.push(a);
    allocationByPayment.set(a.payment_id, list);
  }
  const paymentRows = loan.payments.length
    ? loan.payments.slice().reverse().map((p) => `
        <tr>
          <td>${formatDate(p.payment_date)}</td>
          <td>${formatMoney(p.amount)}</td>
          <td>${(allocationByPayment.get(p.id) || []).map(a => `${escapeHtml(new Date(a.due_date + "T12:00:00Z").toLocaleDateString("es", { month: "long", year: "numeric", timeZone: "UTC" }))}: ${formatMoney(a.amount)}${loan.payment_plan ? ` (${formatMoney(a.interest_amount)} interés, ${formatMoney(a.principal_amount)} capital)` : ""}`).join("<br>") || "-"}</td>
          <td class="wrap">${escapeHtml(p.notes || "-")}</td>
          <td><button class="btn-danger btn-sm" data-delete-payment="${p.id}">Eliminar</button></td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="empty-state">Todavía no hay pagos registrados</td></tr>`;

  const overdueNote = loan.status === "atrasado"
    ? `<p class="error-text">Atrasado por ${formatMoney(loan.overdueAmount)} respecto a lo esperado a la fecha.</p>`
    : "";

  const panelAccent = loan.status === "atrasado" ? "accent-danger" : (loan.status === "pagado" ? "accent-success" : "accent-primary");

  contentEl.innerHTML = `
    <div class="panel ${panelAccent}">
      <div class="panel-header">
        <div class="profile-head">
          ${avatar(loan.client_name, "md")}
          <h2><a href="#/clients/${loan.client_id}" class="btn-link">${escapeHtml(loan.client_name)}</a></h2>
          ${statusBadge(loan.status)}
        </div>
        <div class="actions">
          <button class="btn-primary btn-sm" id="register-payment-btn">+ Registrar pago</button>
          ${loan.extension ? "" : `<button class="btn-secondary btn-sm" id="extend-loan-btn">+ Prorrogar préstamo</button>`}
          ${loan.term_months > 1 ? `<button class="btn-secondary btn-sm" id="payment-plan-btn">${loan.payment_plan ? "Ajustar plan" : "+ Plan interés → capital"}</button>` : ""}
          <button class="btn-secondary btn-sm" id="edit-loan-btn">Editar</button>
          <button class="btn-danger btn-sm" id="delete-loan-btn">Eliminar</button>
        </div>
      </div>

      <div class="detail-grid">
        <div class="detail-item"><div class="detail-label">Monto prestado</div><div class="detail-value v-primary">${formatMoney(loan.principal)}</div></div>
        <div class="detail-item"><div class="detail-label">Interés total</div><div class="detail-value">${loan.interest_rate}%</div></div>
        <div class="detail-item"><div class="detail-label">Plazo</div><div class="detail-value">${loan.term_months} meses</div></div>
        <div class="detail-item"><div class="detail-label">Inicio</div><div class="detail-value">${formatDate(loan.start_date)}</div></div>
        <div class="detail-item"><div class="detail-label">Ganancia (interés)</div><div class="detail-value v-profit">${formatMoney(loan.totalInterest)}</div></div>
        <div class="detail-item"><div class="detail-label">Total a pagar</div><div class="detail-value v-primary">${formatMoney(loan.totalToPay)}</div></div>
        <div class="detail-item"><div class="detail-label">${loan.payment_plan ? "Cuota de interés" : loan.extension ? "Cuota original" : "Cuota mensual"}</div><div class="detail-value v-primary">${formatMoney(loan.monthlyPayment)}</div></div>
        <div class="detail-item"><div class="detail-label">Total pagado</div><div class="detail-value v-success">${formatMoney(loan.totalPaid)}</div></div>
        <div class="detail-item"><div class="detail-label">Saldo pendiente</div><div class="detail-value ${loan.pendingBalance > 0 ? "v-danger" : "v-success"}">${formatMoney(loan.pendingBalance)}</div></div>
        <div class="detail-item"><div class="detail-label">Próximo vencimiento</div><div class="detail-value">${loan.nextDueDate ? formatDate(loan.nextDueDate) : "-"}</div></div>
      </div>

      <div style="margin-top:16px;">
        <div class="detail-label" style="margin-bottom:6px;">Progreso: ${loan.percentPaid}%</div>
        <div class="progress-track"><div class="progress-fill ${loan.status === "pagado" ? "is-complete" : ""}" style="width:${Math.min(loan.percentPaid, 100)}%"></div></div>
      </div>
      ${overdueNote}
      ${loan.notes ? `<p class="muted" style="margin-top:14px;">${escapeHtml(loan.notes)}</p>` : ""}
      ${renderExtensionSummary(loan)}
      ${renderPaymentPlanSummary(loan)}
    </div>

    <div class="panel accent-primary">
      <div class="panel-header">
        <h2>Cómo se está cobrando este préstamo</h2>
      </div>
      <p class="muted" style="margin:-6px 0 14px;font-size:0.86rem;">Cada pago recupera primero tu ganancia; el capital se recupera después</p>
      ${buildWaterfall(loan)}
    </div>

    ${renderInstallmentCalendar(loan)}
    <div class="panel">
      <div class="panel-header"><h2>Historial de pagos</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha cobrada</th><th>Monto</th><th>Mes aplicado</th><th class="wrap">Notas</th><th></th></tr></thead>
          <tbody>${paymentRows}</tbody>
        </table>
      </div>
    </div>
  `;

  animateWaterfall();

  document.getElementById("register-payment-btn").addEventListener("click", () => openPaymentModal(loan));
  document.getElementById("extend-loan-btn")?.addEventListener("click", () => openExtensionModal(loan));
  document.getElementById("payment-plan-btn")?.addEventListener("click", () => openPaymentPlanModal(loan));
  document.getElementById("edit-loan-btn").addEventListener("click", () => openLoanModal(loan));
  document.getElementById("delete-loan-btn").addEventListener("click", () => {
    confirmModal(
      `¿Eliminar este préstamo de ${loan.client_name} y todos sus pagos? Esta acción no se puede deshacer.`,
      async () => {
        await api(`/api/loans/${id}`, { method: "DELETE" });
        showToast("Préstamo eliminado", "success");
        location.hash = `#/clients/${loan.client_id}`;
      }
    );
  });

  contentEl.querySelectorAll("[data-delete-payment]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const paymentId = btn.dataset.deletePayment;
      confirmModal("¿Eliminar este pago? El saldo del préstamo se recalculará.", async () => {
        await api(`/api/payments/${paymentId}`, { method: "DELETE" });
        showToast("Pago eliminado", "success");
        renderLoanDetail(id);
      });
    });
  });
}

function renderPaymentPlanSummary(loan) {
  if (!loan.payment_plan) return "";
  const months = loan.payment_plan.interest_months;
  const schedule = loan.schedule || [];
  const interestPaid = schedule.reduce((sum, row) => sum + row.interest_paid, 0);
  const principalPaid = schedule.reduce((sum, row) => sum + row.principal_paid, 0);
  return `<div class="payment-plan-summary"><strong>Plan: primero interés, después capital</strong>
    <div>Meses 1–${months}: interés ${formatMoney(loan.totalInterest)} · cobrado ${formatMoney(interestPaid)}.</div>
    <div>Meses ${months + 1}–${loan.term_months}: capital ${formatMoney(loan.principal)} · recuperado ${formatMoney(principalPaid)}.</div>
  </div>`;
}

function openPaymentPlanModal(loan) {
  openModal("Plan: interés antes del capital", `
    <form id="plan-form">
      <p class="muted">Define cuántos meses se usan para cobrar el interés total. El capital se reparte entre los meses restantes.</p>
      <div class="field"><label>Meses para cobrar el interés *</label><input id="plan-months" type="number" min="1" max="${loan.term_months - 1}" step="1" value="${loan.payment_plan?.interest_months || Math.min(3, loan.term_months - 1)}" required /></div>
      <div id="plan-preview" class="extension-preview" aria-live="polite"></div>
      <div class="form-actions"><button id="cancel-btn" type="button" class="btn-secondary">Cancelar</button><button id="save-plan" type="submit" class="btn-primary">Guardar plan</button></div>
    </form>`, {
    onMount: root => {
      root.querySelector("#cancel-btn").onclick = closeModal;
      const monthsEl = root.querySelector("#plan-months");
      const preview = () => {
        const months = Number(monthsEl.value);
        const valid = Number.isInteger(months) && months > 0 && months < loan.term_months;
        root.querySelector("#save-plan").disabled = !valid;
        if (!valid) { root.querySelector("#plan-preview").textContent = "Elige menos meses que el plazo total."; return; }
        const interestMonthly = loan.totalInterest / months;
        const capitalMonthly = loan.principal / (loan.term_months - months);
        root.querySelector("#plan-preview").innerHTML = `<strong>Vista previa</strong>
          <div>Primero: ${formatMoney(loan.totalInterest)} de interés en ${months} meses (aprox. ${formatMoney(interestMonthly)} por mes).</div>
          <div>Después: ${formatMoney(loan.principal)} de capital en ${loan.term_months - months} meses (aprox. ${formatMoney(capitalMonthly)} por mes).</div>
          <div>Total: ${formatMoney(loan.totalToPay)} · ya cobrado: ${formatMoney(loan.totalPaid)} · saldo: ${formatMoney(loan.pendingBalance)}.</div>
          <small>Los pagos existentes mantienen fecha y monto; sus importes se aplicarán al calendario nuevo. Revisa los meses antes de guardar.</small>`;
      };
      monthsEl.addEventListener("input", preview);
      preview();
      root.querySelector("#plan-form").addEventListener("submit", async event => {
        event.preventDefault();
        try {
          await api(`/api/loans/${loan.id}/payment-plan`, { method: "POST", body: JSON.stringify({ interest_months: Number(monthsEl.value) }) });
          closeModal();
          showToast("Plan de interés y capital guardado", "success");
          renderLoanDetail(loan.id);
        } catch (err) { showToast(err.message); }
      });
    },
  });
}

function renderExtensionSummary(loan) {
  const e = loan.extension;
  if (!e) return "";
  const originalInterest = Math.round(loan.principal * e.original_rate) / 100;
  const newStage = (loan.schedule || []).slice(e.original_months);
  return `<div class="extension-summary">
    <strong>Prórroga acordada el ${formatDate(e.agreement_date)}</strong>
    <div>Etapa inicial: ${e.original_months} meses al ${e.original_rate}% · interés ${formatMoney(originalInterest)}.</div>
    <div>Etapa adicional: ${e.additional_months} meses al ${e.additional_rate}% sobre ${e.calculation_base === "original" ? "capital original" : "capital pendiente"} (${formatMoney(e.base_amount)}) · interés extra ${formatMoney(e.additional_interest)}.</div>
    <div>Cuota adicional: ${newStage.length ? formatMoney(newStage[0].amount) : "-"} · saldo total actual: ${formatMoney(loan.pendingBalance)}.</div>
  </div>`;
}

function openExtensionModal(loan) {
  openModal("Prorrogar préstamo", `
    <form id="extension-form">
      <p class="muted">Capital prestado: <strong>${formatMoney(loan.principal)}</strong>. Los pagos ya registrados se conservan.</p>
      <div class="form-grid">
        <div class="field"><label>Meses del acuerdo original *</label><input id="ext-original-months" type="number" min="1" max="120" step="1" value="${loan.term_months === 10 && loan.interest_rate === 80 ? 5 : loan.term_months}" required /></div>
        <div class="field"><label>Interés original (%) *</label><input id="ext-original-rate" type="number" min="0" max="1000" step="0.01" value="${loan.term_months === 10 && loan.interest_rate === 80 ? 40 : loan.interest_rate}" required /></div>
        <div class="field"><label>Meses adicionales *</label><input id="ext-additional-months" type="number" min="1" max="120" step="1" value="5" required /></div>
        <div class="field"><label>Interés adicional (%) *</label><input id="ext-additional-rate" type="number" min="0" max="1000" step="0.01" value="40" required /></div>
        <div class="field"><label>Aplicar el nuevo interés sobre *</label><select id="ext-base"><option value="original">Capital original</option><option value="remaining">Capital pendiente</option></select></div>
        <div class="field"><label>Fecha del acuerdo *</label><input id="ext-date" type="date" value="${todayStr()}" required /></div>
      </div>
      <div id="extension-preview" class="extension-preview" aria-live="polite"></div>
      <div class="form-actions"><button type="button" id="cancel-btn" class="btn-secondary">Cancelar</button><button type="submit" id="save-extension" class="btn-primary">Guardar prórroga</button></div>
    </form>`, {
    size: "lg",
    onMount: root => {
      root.querySelector("#cancel-btn").onclick = closeModal;
      const input = id => root.querySelector(id);
      const values = () => ({
        original_months: Number(input("#ext-original-months").value),
        original_rate: Number(input("#ext-original-rate").value),
        additional_months: Number(input("#ext-additional-months").value),
        additional_rate: Number(input("#ext-additional-rate").value),
        calculation_base: input("#ext-base").value,
        agreement_date: input("#ext-date").value,
      });
      const updatePreview = () => {
        const v = values();
        const preview = input("#extension-preview");
        const valid = Number.isInteger(v.original_months) && v.original_months > 0 &&
          Number.isInteger(v.additional_months) && v.additional_months > 0 &&
          v.original_rate >= 0 && v.additional_rate >= 0 && v.agreement_date;
        input("#save-extension").disabled = !valid;
        if (!valid) { preview.textContent = "Completa los meses, porcentajes y fecha para ver el cálculo."; return; }
        const interest1 = Math.round(loan.principal * v.original_rate) / 100;
        const paid = loan.totalPaid;
        const capitalRemaining = Math.max(0, loan.principal - Math.max(0, paid - interest1));
        const base = v.calculation_base === "original" ? loan.principal : capitalRemaining;
        const interest2 = Math.round(base * v.additional_rate) / 100;
        const total = Math.round((loan.principal + interest1 + interest2) * 100) / 100;
        const firstMonthly = (loan.principal + interest1) / v.original_months;
        const extraMonthly = interest2 / v.additional_months;
        const end = new Date(loan.start_date + "T12:00:00Z");
        end.setUTCMonth(end.getUTCMonth() + v.original_months + v.additional_months);
        preview.innerHTML = `<strong>Vista previa del nuevo acuerdo</strong>
          <div>Interés original: ${formatMoney(interest1)} · interés extra: ${formatMoney(interest2)} sobre ${formatMoney(base)}.</div>
          <div>Total del préstamo: <strong>${formatMoney(total)}</strong> · pagado: ${formatMoney(paid)} · falta: <strong>${formatMoney(Math.max(0, total - paid))}</strong>.</div>
          <div>Etapa original: ${v.original_months} cuotas de aproximadamente ${formatMoney(firstMonthly)}. Etapa adicional: ${v.additional_months} cuotas de aproximadamente ${formatMoney(extraMonthly)}.</div>
          <small>Los pagos anteriores mantienen su fecha y mes aplicado. Fecha final estimada: ${formatDate(end.toISOString().slice(0, 10))}.</small>`;
      };
      root.querySelectorAll("#extension-form input, #extension-form select").forEach(el => el.addEventListener("input", updatePreview));
      updatePreview();
      root.querySelector("#extension-form").addEventListener("submit", async event => {
        event.preventDefault();
        try {
          await api(`/api/loans/${loan.id}/extension`, { method: "POST", body: JSON.stringify(values()) });
          closeModal();
          showToast("Prórroga guardada; calendario recalculado", "success");
          renderLoanDetail(loan.id);
        } catch (err) { showToast(err.message); }
      });
    },
  });
}

function renderInstallmentCalendar(loan) {
  return `    <div class="panel">
      <div class="panel-header"><h2>Calendario de cuotas</h2></div>
      <div class="installment-summary" aria-label="Resumen de cuotas">
        <div class="installment-summary-paid"><strong>${(loan.schedule || []).filter(r => installmentStatus(r, todayStr()).tone === "paid").length}</strong><span>Pagadas</span></div>
        <div class="installment-summary-partial"><strong>${(loan.schedule || []).filter(r => r.paid > 0 && r.remaining >= 0.005).length}</strong><span>Con pago parcial</span></div>
        <div class="installment-summary-late"><strong>${(loan.schedule || []).filter(r => installmentStatus(r, todayStr()).tone === "late").length}</strong><span>Atrasadas</span></div>
        <div class="installment-summary-pending"><strong>${(loan.schedule || []).filter(r => installmentStatus(r, todayStr()).tone === "pending").length}</strong><span>Pendientes</span></div>
      </div>
      <div class="table-wrap installment-table-wrap"><table class="installment-table"><thead><tr><th>Mes</th><th>Vence</th><th>Concepto</th><th>Cuota</th><th>Pagado</th><th>Falta</th><th>Estado</th><th>Avance</th></tr></thead><tbody>
        ${(loan.schedule || []).map(r => renderInstallment(r, todayStr(), !!loan.payment_plan)).join("")}
      </tbody></table></div>
    </div>`;
}

function installmentStatus(row, today) {
  if (row.remaining < 0.005) return { label: "Pagado", tone: "paid" };
  if (row.due_date < today) return { label: row.paid > 0 ? "Pago parcial · atrasado" : "Atrasado", tone: "late" };
  if (row.paid > 0) return { label: "Pago parcial", tone: "partial" };
  return { label: "Pendiente", tone: "pending" };
}

function renderInstallment(row, today, hasPlan) {
  const state = installmentStatus(row, today);
  const progress = row.amount > 0 ? Math.min(100, Math.max(0, Math.round(row.paid / row.amount * 100))) : 100;
  const month = new Date(row.due_date + "T12:00:00Z").toLocaleDateString("es", { month: "long", year: "numeric", timeZone: "UTC" });
  return `<tr class="installment-row installment-row-${state.tone}">
    <td><strong class="installment-month">${escapeHtml(month)}</strong><span class="installment-mobile-date">Vence ${formatDate(row.due_date)}</span></td>
    <td>${formatDate(row.due_date)}</td>
    <td>${hasPlan ? `<span class="installment-kind ${row.interest_amount ? "installment-kind-interest" : "installment-kind-capital"}">${row.interest_amount ? "Interés" : "Capital"}</span>` : "-"}</td>
    <td>${formatMoney(row.amount)}</td>
    <td>${formatMoney(row.paid)}</td>
    <td><strong>${formatMoney(row.remaining)}</strong></td>
    <td><span class="installment-badge installment-badge-${state.tone}">${state.label}</span></td>
    <td><div class="installment-progress" role="progressbar" aria-label="Progreso de ${escapeHtml(month)}" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><span class="installment-progress-${state.tone}" style="width:${progress}%"></span></div><small>${progress}%</small></td>
  </tr>`;
}

function openPaymentModal(loan) {
  const firstUnpaidInterest = loan.payment_plan && (loan.schedule || []).slice(0, loan.payment_plan.interest_months).find(r => r.remaining > 0.001);
  const interestOutstanding = !!firstUnpaidInterest;
  const openRows = (loan.schedule || []).filter(r => r.remaining > 0 && (!interestOutstanding || r.number === firstUnpaidInterest.number));
  if (!openRows.length) return showToast("Todas las cuotas están pagadas", "success");
  const suggested = openRows[0];
  openModal("Registrar pago", `
    <form id="payment-form">
      <p class="muted">Saldo pendiente actual: <strong>${formatMoney(loan.pendingBalance)}</strong></p>
      <div class="form-grid">
        <div class="field">
          <label>Monto pagado *</label>
          <input type="number" id="f-amount" min="0.01" step="0.01" value="${Math.min(suggested.remaining, loan.pendingBalance)}" required />
        </div>
        <div class="field">
          <label>Fecha de pago *</label>
          <input type="date" id="f-date" value="${todayStr()}" required />
        </div>
        <div class="field full">
          <label>¿A qué mes corresponde? *</label>
          <select id="f-installment" required>${openRows.map(r => `<option value="${r.number}">${escapeHtml(new Date(r.due_date + "T12:00:00Z").toLocaleDateString("es", { month: "long", year: "numeric", timeZone: "UTC" }))} · vence ${formatDate(r.due_date)} · falta ${formatMoney(r.remaining)}</option>`).join("")}</select>
          ${interestOutstanding ? `<p class="muted">Primero se completa el interés. Después se habilitan los meses de capital.</p>` : ""}
          <p class="muted" id="payment-preview" aria-live="polite"></p>
        </div>
        <div class="field full">
          <label>Notas</label>
          <textarea id="f-notes"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="cancel-btn">Cancelar</button>
        <button type="submit" class="btn-primary">Registrar</button>
      </div>
    </form>
  `, {
    onMount: (root) => {
      root.querySelector("#cancel-btn").onclick = closeModal;
      const preview = () => {
        let remaining = Math.round(Number(root.querySelector("#f-amount").value) * 100);
        const start = Number(root.querySelector("#f-installment").value);
        const lines = [];
        for (const row of (loan.schedule || []).filter(r => r.number >= start)) {
          const take = Math.min(remaining, Math.round(row.remaining * 100));
          if (take > 0) lines.push(`${new Date(row.due_date + "T12:00:00Z").toLocaleDateString("es", { month: "long", year: "numeric", timeZone: "UTC" })}: ${formatMoney(take / 100)}${loan.payment_plan ? row.interest_amount ? " interés" : " capital" : ""}`);
          remaining -= take;
          if (remaining <= 0) break;
        }
        root.querySelector("#payment-preview").textContent = lines.length ? `Este pago se aplicará a: ${lines.join(" · ")}${remaining > 0 ? " · El monto excede el saldo" : ""}` : "Indica un monto para ver los meses cubiertos";
      };
      root.querySelector("#f-amount").addEventListener("input", preview);
      root.querySelector("#f-installment").addEventListener("change", preview);
      preview();
      root.querySelector("#payment-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          amount: root.querySelector("#f-amount").value,
          payment_date: root.querySelector("#f-date").value,
          installment_number: Number(root.querySelector("#f-installment").value),
          notes: root.querySelector("#f-notes").value.trim(),
        };
        try {
          await api(`/api/loans/${loan.id}/payments`, { method: "POST", body: JSON.stringify(payload) });
          showToast("Pago registrado", "success");
          closeModal();
          renderLoanDetail(loan.id);
        } catch (err) {
          showToast(err.message);
        }
      });
    },
  });
}

/* ==================== Autenticacion / arranque ==================== */

const loginScreen = document.getElementById("login-screen");
const appShell = document.getElementById("app-shell");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
  route();
}

function showLogin() {
  loginScreen.hidden = false;
  appShell.hidden = true;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const password = document.getElementById("login-password").value;
  const submitBtn = document.getElementById("login-submit");
  submitBtn.disabled = true;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    document.getElementById("login-password").value = "";
    showApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch (e) { /* ignorar */ }
  location.hash = "";
  showLogin();
});

(async function init() {
  const { segments } = parseHash();
  if (segments[0] === "portal") {
    // Link de solo lectura para un cliente: no requiere la contraseña del
    // dueño, ni muestra el menú ni el resto de la app.
    appShell.classList.add("portal-mode");
    loginScreen.hidden = true;
    appShell.hidden = false;
    route();
    return;
  }

  try {
    const me = await api("/api/me");
    if (me.authenticated) {
      showApp();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();
