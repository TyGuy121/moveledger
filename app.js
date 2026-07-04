/* The Move Ledger — scenario math + persistence */

const STORAGE_KEY = "move-ledger-scenarios-v1";
const THEME_KEY = "move-ledger-theme";

const $ = (id) => document.getElementById(id);

/* ————— theme ————— */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("themeToggle").textContent = theme === "dark" ? "☀" : "☾";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
  $("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

initTheme();

const MONEY_FIELDS = ["txSalePrice", "txPayoff", "txAnnualTax", "txClosing", "caPrice", "caDown", "insurance", "hoa", "income", "debts"];
const RATE_FIELDS = ["txListingPct", "txBuyerPct", "txClosingPct", "rate", "taxRate"];

let sellMode = "commission"; // "commission" (TX net sheet) | "flatpct"

/* Texas owner's title policy — TDI basic premium rates effective 2026-03-01 */
const TDI_TIERS = [
  [100000000, 0.00116, 179016],
  [50000000, 0.00129, 114516],
  [25000000, 0.00143, 78766],
  [15000000, 0.00238, 54966],
  [5000000, 0.00335, 21466],
  [1000000, 0.00406, 5226],
  [100000, 0.00494, 780],
];

function titlePolicyPremium(price) {
  if (price <= 0) return 0;
  for (const [floor, rate, base] of TDI_TIERS) {
    if (price > floor) return Math.round((price - floor) * rate + base);
  }
  return 780; // at or below $100k — table lookup territory; close enough for this use
}

/* Seller owes property tax from Jan 1 through the day before closing (TX pays in arrears) */
function proratedTaxFraction(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  if (isNaN(d)) return 0;
  const jan1 = new Date(d.getFullYear(), 0, 1, 12);
  const days = Math.round((d - jan1) / 86400000);
  return Math.max(days, 0) / 365;
}

/* ————— parsing / formatting ————— */

function parseMoney(str) {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
  return isFinite(n) && n >= 0 ? n : 0;
}

function parseRate(str) {
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ""));
  return isFinite(n) && n >= 0 ? n : 0;
}

const fmtMoney = (n) =>
  "$" + Math.round(n).toLocaleString("en-US");

const fmtMoneySigned = (n) =>
  (n < 0 ? "−$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");

const fmtPct = (n, digits = 1) =>
  (isFinite(n) ? n.toFixed(digits) : "0") + "%";

function formatMoneyInput(el) {
  const n = parseMoney(el.value);
  el.value = n.toLocaleString("en-US");
}

/* ————— core math ————— */

function readInputs() {
  return {
    txSalePrice: parseMoney($("txSalePrice").value),
    txPayoff: parseMoney($("txPayoff").value),
    txListingPct: parseRate($("txListingPct").value),
    txBuyerPct: parseRate($("txBuyerPct").value),
    txClosingPct: parseRate($("txClosingPct").value),
    txAnnualTax: parseMoney($("txAnnualTax").value),
    txCloseDate: $("txCloseDate").value,
    sellMode,
    txClosing: parseMoney($("txClosing").value),
    caPrice: parseMoney($("caPrice").value),
    caDown: parseMoney($("caDown").value),
    rate: parseRate($("rate").value),
    term: parseInt($("term").value, 10),
    taxRate: parseRate($("taxRate").value),
    insurance: parseMoney($("insurance").value),
    hoa: parseMoney($("hoa").value),
    income: parseMoney($("income").value),
    debts: parseMoney($("debts").value),
  };
}

function compute(v) {
  const flatPct = v.sellMode === "flatpct";
  // legacy saved scenarios stored a single txCommission — treat it as the buyer's-agent side
  const listingPct = v.txListingPct ?? 0;
  const buyerPct = v.txBuyerPct ?? v.txCommission ?? 0;
  const sellCostRate = flatPct ? (v.txClosingPct ?? 0) : listingPct + buyerPct;
  const commission = v.txSalePrice * (sellCostRate / 100);
  const titlePolicy = flatPct ? 0 : titlePolicyPremium(v.txSalePrice);
  const prorated = (v.txAnnualTax ?? 0) * proratedTaxFraction(v.txCloseDate ?? "");
  const proceeds = v.txSalePrice - v.txPayoff - commission - titlePolicy - v.txClosing - prorated;

  const down = Math.min(v.caDown, v.caPrice);
  const loan = Math.max(v.caPrice - down, 0);
  const cushion = proceeds - v.caDown; // negative ⇒ extra cash needed

  const r = v.rate / 100 / 12;
  const n = v.term * 12;
  let pi = 0;
  if (loan > 0) {
    pi = r === 0 ? loan / n : (loan * r) / (1 - Math.pow(1 + r, -n));
  }

  const tax = (v.caPrice * (v.taxRate / 100)) / 12;
  const ins = v.insurance / 12;
  const total = pi + tax + ins + v.hoa;

  const monthlyIncome = v.income / 12;
  const frontPct = monthlyIncome > 0 ? (total / monthlyIncome) * 100 : 0;
  const backPct = monthlyIncome > 0 ? ((total + v.debts) / monthlyIncome) * 100 : 0;

  return { commission, sellCostRate, flatPct, titlePolicy, prorated, fees: v.txClosing, proceeds, down, loan, cushion, pi, tax, ins, hoa: v.hoa, total, frontPct, backPct, downPct: v.caPrice > 0 ? (down / v.caPrice) * 100 : 0 };
}

/* ————— render ————— */

function render() {
  const v = readInputs();
  const c = compute(v);

  $("lblSellCost").textContent = c.flatPct ? `Flat closing (${c.sellCostRate}%)` : "Commissions";
  $("outCommission").textContent = "−" + fmtMoney(c.commission);
  $("rowTitlePolicy").hidden = c.flatPct;
  $("outTitlePolicy").textContent = "−" + fmtMoney(c.titlePolicy);
  $("outFees").textContent = "−" + fmtMoney(c.fees);
  $("outProrated").textContent = "−" + fmtMoney(c.prorated);
  $("outProceeds").textContent = fmtMoneySigned(c.proceeds);

  $("outDownPct").textContent = fmtPct(c.downPct);
  $("outLoan").textContent = fmtMoney(c.loan);

  const cushionRow = $("rowCushion");
  if (c.cushion >= 0) {
    $("lblCushion").textContent = "Proceeds left over";
    $("outCushion").textContent = fmtMoney(c.cushion);
    cushionRow.classList.remove("shortfall");
  } else {
    $("lblCushion").textContent = "Extra cash needed";
    $("outCushion").textContent = fmtMoney(-c.cushion);
    cushionRow.classList.add("shortfall");
  }

  $("outTotal").innerHTML = fmtMoney(c.total) + " <small>/MO</small>";
  $("outPI").textContent = fmtMoney(c.pi);
  $("outTax").textContent = fmtMoney(c.tax);
  $("outIns").textContent = fmtMoney(c.ins);
  $("outHoa").textContent = fmtMoney(c.hoa);
  $("legendHoa").hidden = c.hoa <= 0;

  // donut
  const donut = $("donut");
  if (c.total > 0) {
    const p1 = (c.pi / c.total) * 100;
    const p2 = p1 + (c.tax / c.total) * 100;
    const p3 = p2 + (c.ins / c.total) * 100;
    donut.style.background = `conic-gradient(var(--pi) 0 ${p1}%, var(--tax) ${p1}% ${p2}%, var(--ins) ${p2}% ${p3}%, var(--hoa) ${p3}% 100%)`;
  }

  // affordability
  $("outFrontPct").textContent = fmtPct(c.frontPct);
  const fill = $("meterFront");
  fill.style.width = Math.min(c.frontPct, 100) + "%";

  const verdict = $("outVerdict");
  verdict.classList.remove("ok", "warn", "bad");
  if (v.income <= 0) {
    verdict.textContent = "Enter income to check affordability";
    fill.style.background = "#7fae94";
  } else if (c.frontPct <= 28) {
    verdict.textContent = "Comfortable — under the 28% housing guideline";
    verdict.classList.add("ok");
    fill.style.background = "#7fae94";
  } else if (c.frontPct <= 36) {
    verdict.textContent = "Stretch — above 28%, still under 36%";
    verdict.classList.add("warn");
    fill.style.background = "#e5b969";
  } else {
    verdict.textContent = "Aggressive — above the 36% ceiling most lenders use";
    verdict.classList.add("bad");
    fill.style.background = "#e78d67";
  }
  $("outBackPct").textContent =
    v.income > 0 && v.debts > 0 ? `With other debts: ${fmtPct(c.backPct)} of gross income (back-end DTI)` : "";

  return { v, c };
}

/* ————— scenarios ————— */

function loadScenarios() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveScenarios(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function saveCurrent() {
  const nameEl = $("scenarioName");
  const { v } = render();
  let name = nameEl.value.trim();
  if (!name) {
    name = `Sell ${shortMoney(v.txSalePrice)} / Buy ${shortMoney(v.caPrice)} / ${Math.round((v.caDown / (v.caPrice || 1)) * 100)}% down`;
  }
  const list = loadScenarios();
  const existing = list.findIndex((s) => s.name === name);
  const record = { name, inputs: v, savedAt: Date.now() };
  if (existing >= 0) list[existing] = record;
  else list.push(record);
  saveScenarios(list);
  nameEl.value = "";
  renderCompare();
}

const shortMoney = (n) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M" : "$" + Math.round(n / 1000) + "k";

function applyScenario(inputs) {
  MONEY_FIELDS.forEach((id) => { $(id).value = (inputs[id] ?? 0).toLocaleString("en-US"); });
  RATE_FIELDS.forEach((id) => { $(id).value = String(inputs[id] ?? 0); });
  if (inputs.txClosingPct == null) $("txClosingPct").value = "3.6";
  // legacy scenarios saved a single txCommission — surface it as the buyer's-agent side
  if (inputs.txBuyerPct == null && inputs.txCommission != null) $("txBuyerPct").value = String(inputs.txCommission);
  $("txCloseDate").value = inputs.txCloseDate || "2026-08-25";
  $("term").value = String(inputs.term ?? 30);
  setSellMode(inputs.sellMode ?? "commission");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteScenario(name) {
  saveScenarios(loadScenarios().filter((s) => s.name !== name));
  renderCompare();
}

const CMP_ROWS = [
  ["TX sale price", (c, v) => fmtMoney(v.txSalePrice)],
  ["TX selling costs", (c) => `−${fmtMoney(c.commission + c.titlePolicy + c.fees)} (${c.sellCostRate}%${c.flatPct ? " flat" : " comm. + title/fees"})`],
  ["Prorated TX taxes", (c) => "−" + fmtMoney(c.prorated)],
  ["Net proceeds", (c) => fmtMoneySigned(c.proceeds)],
  ["CA purchase price", (c, v) => fmtMoney(v.caPrice)],
  ["Down payment", (c, v) => `${fmtMoney(v.caDown)} (${fmtPct(c.downPct, 0)})`],
  ["Loan amount", (c) => fmtMoney(c.loan)],
  ["Rate / term", (c, v) => `${v.rate}% · ${v.term}yr`],
  ["P&I", (c) => fmtMoney(c.pi)],
  ["Property tax /mo", (c) => fmtMoney(c.tax)],
  ["Insurance /mo", (c) => fmtMoney(c.ins)],
  ["HOA /mo", (c) => fmtMoney(c.hoa)],
  ["Proceeds left over", (c) => fmtMoneySigned(c.cushion)],
  ["% of income", (c, v) => (v.income > 0 ? fmtPct(c.frontPct) : "—")],
];

function renderCompare() {
  const list = loadScenarios();
  const section = $("compareSection");
  section.hidden = list.length === 0;
  if (list.length === 0) return;

  const computed = list.map((s) => ({ ...s, calc: compute(s.inputs) }));
  const bestTotal = Math.min(...computed.map((s) => s.calc.total));

  const head = $("cmpHeadRow");
  head.innerHTML = "<th></th>" + computed
    .map((s) => `<th>${escapeHtml(s.name)}${s.calc.total === bestTotal && computed.length > 1 ? '<span class="best-flag">lowest</span>' : ""}</th>`)
    .join("");

  const body = $("cmpBody");
  const rows = [];

  rows.push(
    `<tr class="row-total"><td>Monthly payment</td>` +
      computed.map((s) => `<td class="${s.calc.total === bestTotal && computed.length > 1 ? "best" : ""}">${fmtMoney(s.calc.total)}/mo</td>`).join("") +
      `</tr>`
  );

  for (const [label, fn] of CMP_ROWS) {
    rows.push(`<tr><td>${label}</td>` + computed.map((s) => `<td>${fn(s.calc, s.inputs)}</td>`).join("") + `</tr>`);
  }

  rows.push(
    `<tr><td></td>` +
      computed
        .map(
          (s) =>
            `<td><div class="cmp-actions"><button data-load="${escapeAttr(s.name)}">load</button><button class="danger" data-del="${escapeAttr(s.name)}">delete</button></div></td>`
        )
        .join("") +
      `</tr>`
  );

  body.innerHTML = rows.join("");
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeHtml(s).replace(/"/g, "&quot;");

/* ————— sell-mode toggle ————— */

function setSellMode(mode) {
  sellMode = mode;
  const flat = mode === "flatpct";
  document.querySelectorAll("#sellModeToggle button").forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  $("fieldListing").classList.toggle("inactive", flat);
  $("fieldBuyer").classList.toggle("inactive", flat);
  $("fieldClosingPct").classList.toggle("inactive", !flat);
  $("txListingPct").disabled = flat;
  $("txBuyerPct").disabled = flat;
  $("txClosingPct").disabled = !flat;
  render();
}

document.querySelectorAll("#sellModeToggle button").forEach((b) => {
  b.addEventListener("click", () => setSellMode(b.dataset.mode));
});

/* ————— wiring ————— */

document.querySelectorAll("input").forEach((el) => {
  el.addEventListener("input", render);
});
$("term").addEventListener("change", render);

MONEY_FIELDS.forEach((id) => {
  $(id).addEventListener("blur", (e) => { formatMoneyInput(e.target); render(); });
});

$("btnAllProceeds").addEventListener("click", () => {
  const v = readInputs();
  const c = compute(v);
  $("caDown").value = Math.max(Math.round(c.proceeds), 0).toLocaleString("en-US");
  render();
});

$("btnSave").addEventListener("click", saveCurrent);
$("scenarioName").addEventListener("keydown", (e) => { if (e.key === "Enter") saveCurrent(); });

$("compareTable").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.load) {
    const s = loadScenarios().find((x) => x.name === btn.dataset.load);
    if (s) applyScenario(s.inputs);
  } else if (btn.dataset.del) {
    deleteScenario(btn.dataset.del);
  }
});

setSellMode(sellMode);
renderCompare();
