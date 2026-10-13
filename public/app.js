/**
 * GiftFlow Dashboard — client.
 * Plain modules, no build step: it is a print station, not a product.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  view: new URLSearchParams(location.search).get("view") || "new",
  q: "",
  orders: [],
  total: 0,
  selected: new Set(),
  me: null,
  refreshSeconds: 60,
  knownNewIds: null,
  loading: false,
};

const PAGE = 100;

// ── api ──────────────────────────────────────────────────────────────────────

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "X-Requested-With": "giftflow-dashboard",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/me") {
    location.href = "/login";
    throw new Error("Logged out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── header and counts ───────────────────────────────────────────────────────

async function loadMe() {
  try {
    const me = await api("/me");
    state.me = me;
    hideError();
    $("[data-shop]").textContent = me.shop.name;
    const plan = $("[data-plan]");
    plan.hidden = false;
    plan.textContent =
      me.usage.limit === null
        ? `${me.plan.label} · ${me.usage.used} this month`
        : `${me.plan.label} · ${me.usage.used}/${me.usage.limit} this month`;
    plan.classList.toggle("pill--warn", me.usage.limit !== null && me.usage.used >= me.usage.limit);

    for (const [view, n] of Object.entries(me.counts)) {
      $$(`[data-count="${view}"]`).forEach((el) => (el.textContent = n));
      $$(`[data-tab-count="${view}"]`).forEach((el) => (el.textContent = n ? `(${n})` : ""));
    }
    $("[data-goto=review]").classList.toggle("stat--alert", me.counts.review > 0);
    $("[data-goto=held]").classList.toggle("stat--alert", me.counts.held > 0);

    const c = me.card;
    $("[data-card-size]").textContent =
      `${fmt(c.widthMm)} × ${fmt(c.heightMm)} mm + ${fmt(c.bleedMm)} mm bleed${c.cropMarks ? ", crop marks" : ""}`;
  } catch (e) {
    showError(e.message);
  }
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

// ── orders ──────────────────────────────────────────────────────────────────

async function loadOrders({ append = false, quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet && !append) $("[data-loading]").hidden = false;
  try {
    const skip = append ? state.orders.length : 0;
    const data = await api(`/orders?${new URLSearchParams({ view: state.view, q: state.q, take: PAGE, skip })}`);
    state.orders = append ? [...state.orders, ...data.orders] : data.orders;
    state.total = data.total;
    // Drop selections that are no longer in the list.
    const ids = new Set(state.orders.map((o) => o.id));
    for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
    hideError();
    render();
  } catch (e) {
    showError(e.message);
  } finally {
    state.loading = false;
    $("[data-loading]").hidden = true;
  }
}

function render() {
  $$("[data-tabs] [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));

  const tbody = $("[data-rows]");
  tbody.innerHTML = "";
  for (const o of state.orders) tbody.appendChild(row(o));

  const empty = $("[data-empty]");
  empty.hidden = state.orders.length > 0;
  $("[data-empty-text]").textContent = state.q
    ? "No gift orders match that search."
    : {
        new: "Nothing waiting to print.",
        review: "No customer images waiting for approval.",
        held: "Nothing on hold.",
        printed: "No printed cards waiting to be packed.",
        packed: "Nothing packed yet.",
        all: "No gift orders yet.",
      }[state.view];

  $("[data-more]").hidden = state.orders.length >= state.total;

  const printAll = $("[data-print-all]");
  const printable = state.orders.filter((o) => !o.printBlocker);
  printAll.hidden = state.view !== "new" || printable.length === 0;
  printAll.textContent = `Print all (${printable.length})`;

  renderSelection();
}

function row(o) {
  const tr = document.createElement("tr");
  tr.dataset.id = o.id;
  tr.classList.toggle("is-selected", state.selected.has(o.id));
  tr.innerHTML = `
    <td class="col-check"><input type="checkbox" aria-label="Select ${esc(o.orderName)}"></td>
    <td>${o.image ? `<img class="thumb" src="${esc(o.image)}" alt="" loading="lazy">` : `<div class="thumb thumb--none">✉</div>`}</td>
    <td><strong>${esc(o.orderName)}</strong><div class="muted small">${esc(when(o.orderedAt))}</div></td>
    <td>${esc(o.recipient || o.customerName || "—")}${o.sender ? `<div class="muted small">from ${esc(o.sender)}</div>` : ""}</td>
    <td class="col-msg"><div class="clamp">${esc(o.messageText || "—")}</div></td>
    <td>${badges(o)}</td>
    <td class="col-actions">
      <button class="btn btn--sm" data-view-one>View</button>
      <button class="btn btn--sm btn--primary" data-print-one ${o.printBlocker ? "disabled" : ""} title="${esc(o.printBlocker || "Print this card")}">Print</button>
    </td>`;
  const cb = $("input[type=checkbox]", tr);
  cb.checked = state.selected.has(o.id);
  cb.addEventListener("change", () => toggle(o.id, cb.checked));
  tr.addEventListener("click", (e) => {
    if (e.target.closest("button, input, a")) return;
    cb.checked = !cb.checked;
    toggle(o.id, cb.checked);
  });
  $("[data-view-one]", tr).addEventListener("click", () => openPreview(o));
  $("[data-print-one]", tr).addEventListener("click", () => print([o.id]));
  return tr;
}

function badges(o) {
  const b = [];
  if (o.overLimit) b.push(`<span class="badge badge--warn">On hold</span>`);
  if (o.uploadStatus === "pending") b.push(`<span class="badge badge--attn">Needs approval</span>`);
  if (o.uploadStatus === "rejected") b.push(`<span class="badge badge--bad">Image rejected</span>`);
  if (o.isUpload && o.uploadStatus === "approved") b.push(`<span class="badge">Customer image</span>`);
  b.push(
    o.status === "new"
      ? `<span class="badge badge--info">To print</span>`
      : o.status === "printed"
        ? `<span class="badge badge--ok">Printed</span>`
        : `<span class="badge">Packed</span>`,
  );
  return `<div class="badges">${b.join("")}</div>`;
}

// ── selection ───────────────────────────────────────────────────────────────

function toggle(id, on) {
  on ? state.selected.add(id) : state.selected.delete(id);
  $(`tr[data-id="${CSS.escape(id)}"]`)?.classList.toggle("is-selected", on);
  renderSelection();
}

function renderSelection() {
  const n = state.selected.size;
  $("[data-selbar]").hidden = n === 0;
  $("[data-sel-count]").textContent = `${n} selected`;
  const all = $("[data-check-all]");
  all.checked = n > 0 && n === state.orders.length;
  all.indeterminate = n > 0 && n < state.orders.length;

  const chosen = state.orders.filter((o) => state.selected.has(o.id));
  const blocked = chosen.filter((o) => o.printBlocker);
  const batchOff = state.me && !state.me.plan.batchPrint && n > 1;
  const printBtn = $("[data-act=print]");
  printBtn.disabled = blocked.length > 0 || batchOff;
  printBtn.textContent = `Print ${n} card${n === 1 ? "" : "s"}`;
  printBtn.title = blocked.length
    ? `${blocked.length} selected can't be printed yet: ${blocked[0].printBlocker}`
    : batchOff
      ? `Batch printing isn't in the ${state.me.plan.label} plan`
      : "";

  const hasUploads = chosen.some((o) => o.isUpload);
  $("[data-act=approve]").hidden = !hasUploads;
  $("[data-act=reject]").hidden = !hasUploads;
}

$("[data-check-all]").addEventListener("change", (e) => {
  state.selected = e.target.checked ? new Set(state.orders.map((o) => o.id)) : new Set();
  render();
});

$$("[data-selbar] [data-act]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const ids = [...state.selected];
    const act = btn.dataset.act;
    if (act === "clear") { state.selected.clear(); return render(); }
    if (act === "print") return print(ids);
    if (act === "approve" || act === "reject") return moderate(ids, act === "approve" ? "approved" : "rejected");
    return setStatus(ids, act);
  }),
);

// ── actions ─────────────────────────────────────────────────────────────────

async function setStatus(ids, status) {
  try {
    const r = await api("/status", { method: "POST", body: { ids, status } });
    toast(`${r.updated} card${r.updated === 1 ? "" : "s"} marked ${status === "new" ? "to print" : status}.`);
    state.selected.clear();
    await refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function moderate(ids, decision) {
  if (decision === "rejected" && !confirm("Reject the customer's image? The card will not be printed.")) return;
  try {
    const r = await api("/moderate", { method: "POST", body: { ids, decision } });
    toast(r.updated ? `${r.updated} image${r.updated === 1 ? "" : "s"} ${decision}.` : "None of those cards has a customer image.");
    state.selected.clear();
    await refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

let lastPdfUrl = null;

async function print(ids) {
  if (!ids.length) return;
  const dlg = $("[data-printer]");
  const frame = $("[data-pr-frame]");
  const printBtn = $("[data-pr-print]");
  const dl = $("[data-pr-download]");
  $("[data-pr-title]").textContent = `Preparing ${ids.length} card${ids.length === 1 ? "" : "s"}…`;
  $("[data-pr-wait]").hidden = false;
  frame.hidden = true;
  printBtn.disabled = true;
  dl.hidden = true;
  dlg.showModal();

  const markPrinted = $("[data-mark-printed]").checked;
  try {
    const res = await fetch("/api/print", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "giftflow-dashboard" },
      body: JSON.stringify({ ids, markPrinted }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Printing failed (${res.status})`);
    }
    const blob = await res.blob();
    if (lastPdfUrl) URL.revokeObjectURL(lastPdfUrl);
    lastPdfUrl = URL.createObjectURL(blob);

    const count = Number(res.headers.get("x-card-count")) || ids.length;
    $("[data-pr-title]").textContent = `${count} card${count === 1 ? "" : "s"} ready`;
    frame.src = lastPdfUrl;
    frame.hidden = false;
    $("[data-pr-wait]").hidden = true;
    dl.href = lastPdfUrl;
    dl.download = `giftflow-${count}-cards-${new Date().toISOString().slice(0, 10)}.pdf`;
    dl.hidden = false;
    printBtn.disabled = false;
    printBtn.onclick = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch {
        // Some browsers will not print a PDF inside a frame; open it instead.
        window.open(lastPdfUrl, "_blank");
      }
    };
    if (markPrinted) {
      state.selected.clear();
      refresh();
    }
  } catch (e) {
    dlg.close();
    toast(e.message, "error");
  }
}

$("[data-print-all]").addEventListener("click", () => {
  const ids = state.orders.filter((o) => !o.printBlocker).map((o) => o.id);
  if (state.me && !state.me.plan.batchPrint && ids.length > 1) {
    return toast(`Batch printing isn't in the ${state.me.plan.label} plan. Print cards one at a time.`, "error");
  }
  print(ids);
});

// ── preview ─────────────────────────────────────────────────────────────────

function openPreview(o) {
  const dlg = $("[data-preview]");
  const card = $("[data-pv-card]");
  const c = state.me?.card ?? { widthMm: 105, heightMm: 148 };
  card.style.aspectRatio = `${c.widthMm} / ${c.heightMm}`;
  card.innerHTML = `
    ${o.image ? `<img src="${esc(o.image)}" alt="">` : ""}
    <div class="preview__text">
      ${o.recipient ? `<div class="preview__to">${esc(o.recipient)}</div>` : ""}
      <div class="preview__msg">${safeHtml(o.messageHtml) || esc(o.messageText || "")}</div>
      ${o.sender ? `<div class="preview__from">${esc(o.sender)}</div>` : ""}
    </div>`;
  $("[data-pv-title]").textContent = o.orderName;
  $("[data-pv-meta]").textContent = `Ordered ${when(o.orderedAt)}${o.customerName ? ` by ${o.customerName}` : ""}${o.customerEmail ? ` · ${o.customerEmail}` : ""}`;
  const blocker = $("[data-pv-blocker]");
  blocker.hidden = !o.printBlocker;
  blocker.textContent = o.printBlocker || "";
  $("[data-pv-to]").textContent = o.recipient || "—";
  $("[data-pv-from]").textContent = o.sender || "—";
  $("[data-pv-cardname]").textContent = o.cardTitle || "—";
  $("[data-pv-status]").innerHTML = badges(o);

  const actions = $("[data-pv-actions]");
  actions.innerHTML = "";
  const add = (label, cls, fn, disabled = false) => {
    const b = document.createElement("button");
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener("click", () => { dlg.close(); fn(); });
    actions.appendChild(b);
  };
  add("Print this card", "btn--primary", () => print([o.id]), Boolean(o.printBlocker));
  if (o.isUpload && o.uploadStatus !== "approved") add("Approve image", "btn--ok", () => moderate([o.id], "approved"));
  if (o.isUpload && o.uploadStatus !== "rejected") add("Reject image", "btn--danger", () => moderate([o.id], "rejected"));
  if (o.status !== "printed") add("Mark printed", "", () => setStatus([o.id], "printed"));
  if (o.status !== "packed") add("Mark packed", "", () => setStatus([o.id], "packed"));
  if (o.status !== "new") add("Back to “To print”", "btn--ghost", () => setStatus([o.id], "new"));
  dlg.showModal();
}

/**
 * GiftFlow sanitizes messages before storing them; this is a second, stricter
 * pass so the dashboard never trusts markup it did not check itself.
 */
const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "BLOCKQUOTE", "SPAN"]);
function safeHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!ALLOWED.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent || ""));
          continue;
        }
        for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
        walk(child);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    }
  };
  const root = doc.body.firstElementChild;
  walk(root);
  return root.innerHTML;
}

// ── navigation, search, refresh ─────────────────────────────────────────────

function setView(view) {
  state.view = view;
  state.selected.clear();
  const url = new URL(location.href);
  url.searchParams.set("view", view);
  history.replaceState(null, "", url);
  loadOrders();
}

$$("[data-tabs] [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$$("[data-goto]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.goto)));

let searchTimer;
$("[data-q]").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadOrders(); }, 300);
});
$("[data-search]").addEventListener("submit", (e) => {
  e.preventDefault();
  state.q = $("[data-q]").value.trim();
  loadOrders();
});
$("[data-refresh]").addEventListener("click", () => refresh());
$("[data-load-more]").addEventListener("click", () => loadOrders({ append: true }));

async function refresh({ quiet = false } = {}) {
  await Promise.all([loadMe(), loadOrders({ quiet })]);
}

/** Tells staff when new cards arrive while the page sits open. */
async function poll() {
  if (document.hidden || $("dialog[open]")) return;
  const before = state.me?.counts?.new;
  await loadMe();
  const after = state.me?.counts?.new;
  if (before !== undefined && after > before) {
    toast(`${after - before} new card${after - before === 1 ? "" : "s"} to print.`);
  }
  if (state.selected.size === 0) loadOrders({ quiet: true });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = msg;
  $("[data-toasts]").appendChild(el);
  setTimeout(() => el.classList.add("is-out"), kind === "error" ? 7000 : 3500);
  setTimeout(() => el.remove(), kind === "error" ? 7600 : 4100);
}

function showError(msg) {
  const el = $("[data-error]");
  el.textContent = msg;
  el.hidden = false;
}
function hideError() { $("[data-error]").hidden = true; }

// ── start ───────────────────────────────────────────────────────────────────

(async function start() {
  try {
    const cfg = await api("/config");
    state.refreshSeconds = cfg.refreshSeconds;
    $("[data-user]").textContent = cfg.user.name;
    if (!cfg.configured) showError("The dashboard is not connected yet: set GIFTFLOW_URL and GIFTFLOW_API_KEY in its .env file and restart it.");
  } catch {
    return;
  }
  await refresh();
  setInterval(poll, state.refreshSeconds * 1000);
})();
