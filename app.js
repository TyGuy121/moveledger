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

let sellMode = "flatpct"; // "flatpct" (universal, default) | "commission" (Texas net sheet)

/* Non-commission seller closing costs (title, escrow, transfer taxes) ≈ 2.5% of sale
   price nationally — commissions + this baseline give the all-in flat closing %. */
const NON_COMMISSION_PCT = 2.5;

/* Per-state averages: [code, name, avg effective property-tax rate (% of value),
   avg annual homeowners premium ($ — NerdWallet 2026, $400k dwelling / $300k
   liability / $1k deductible)]. Illustrative defaults — both stay editable. */
const STATES = [
  ["AL", "Alabama", 0.40, 4285], ["AK", "Alaska", 1.07, 1385], ["AZ", "Arizona", 0.63, 3415],
  ["AR", "Arkansas", 0.62, 4955], ["CA", "California", 0.75, 1820], ["CO", "Colorado", 0.51, 3910],
  ["CT", "Connecticut", 1.79, 2135], ["DE", "Delaware", 0.58, 1365], ["DC", "District of Columbia", 0.57, 1645],
  ["FL", "Florida", 0.83, 2845], ["GA", "Georgia", 0.90, 3225], ["HI", "Hawaii", 0.29, 900],
  ["ID", "Idaho", 0.63, 2195], ["IL", "Illinois", 2.08, 3240], ["IN", "Indiana", 0.84, 2985],
  ["IA", "Iowa", 1.52, 3765], ["KS", "Kansas", 1.34, 5455], ["KY", "Kentucky", 0.83, 3795],
  ["LA", "Louisiana", 0.56, 2020], ["ME", "Maine", 1.24, 1525], ["MD", "Maryland", 1.05, 2375],
  ["MA", "Massachusetts", 1.14, 1645], ["MI", "Michigan", 1.38, 2415], ["MN", "Minnesota", 1.11, 3615],
  ["MS", "Mississippi", 0.79, 4445], ["MO", "Missouri", 0.98, 3805], ["MT", "Montana", 0.74, 3765],
  ["NE", "Nebraska", 1.63, 6015], ["NV", "Nevada", 0.55, 1635], ["NH", "New Hampshire", 1.93, 1500],
  ["NJ", "New Jersey", 2.23, 1480], ["NM", "New Mexico", 0.67, 2800], ["NY", "New York", 1.72, 1710],
  ["NC", "North Carolina", 0.80, 3025], ["ND", "North Dakota", 0.98, 3510], ["OH", "Ohio", 1.59, 2080],
  ["OK", "Oklahoma", 0.89, 7255], ["OR", "Oregon", 0.93, 1705], ["PA", "Pennsylvania", 1.49, 1720],
  ["RI", "Rhode Island", 1.40, 2230], ["SC", "South Carolina", 0.57, 3205], ["SD", "South Dakota", 1.17, 3965],
  ["TN", "Tennessee", 0.67, 4220], ["TX", "Texas", 1.68, 4915], ["UT", "Utah", 0.57, 1810],
  ["VT", "Vermont", 1.83, 1170], ["VA", "Virginia", 0.87, 2265], ["WA", "Washington", 0.87, 1880],
  ["WV", "West Virginia", 0.57, 2465], ["WI", "Wisconsin", 1.61, 2175], ["WY", "Wyoming", 0.61, 1805],
];
const STATE_TAX_RATES = Object.fromEntries(STATES.map(([code, , rate]) => [code, rate]));
const STATE_NAMES = Object.fromEntries(STATES.map(([code, name]) => [code, name]));
const STATE_INS_AVG = Object.fromEntries(STATES.map(([code, , , ins]) => [code, ins]));

/* States where the average effective rate misleads for a NEW purchase.
   CA reassesses at the purchase price (Prop 13 keeps long-held homes' average low),
   so a fresh buy typically runs ≈1.0–1.25% with local bonds. */
const PURCHASE_RATE_OVERRIDES = { CA: 1.10 };
const STATE_RATE_NOTES = {
  CA: "California reassesses at your purchase price — new purchases typically run ≈1.0–1.25% with local bonds (the 0.75% state average reflects long-held homes)",
};

const stateFillRate = (code) => PURCHASE_RATE_OVERRIDES[code] ?? STATE_TAX_RATES[code];
const stateNote = (code) =>
  STATE_RATE_NOTES[code] ?? `${STATE_NAMES[code]} average ≈ ${STATE_TAX_RATES[code].toFixed(2)}% — verify your parcel`;

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

/* ————— location / state property tax ————— */

function populateStates() {
  const sel = $("destState");
  for (const [code, name] of STATES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${name} (${code})`;
    sel.appendChild(opt);
  }
}

function applyStateRate(code) {
  const note = $("taxRateNote");
  const insNote = $("insuranceNote");
  if (!code || STATE_TAX_RATES[code] == null) {
    note.hidden = true;
    insNote.hidden = true;
    return;
  }
  $("taxRate").value = stateFillRate(code).toFixed(2);
  note.hidden = false;
  note.textContent = stateNote(code);

  // Homeowners insurance: NerdWallet's state averages are quoted for $400k of
  // dwelling (rebuild) coverage — roughly a $1M-market-price home once land
  // value is counted — so fill the average as-is rather than scaling by price.
  $("insurance").value = STATE_INS_AVG[code].toLocaleString("en-US");
  insNote.hidden = false;
  insNote.textContent = `${STATE_NAMES[code]} average (NerdWallet) — get a quote`;
}

/* ————— help modals ————— */

const HELP = {
  "commissions": {
    title: "Agent commissions",
    body: `<p>The listing agent represents you (the seller); the buyer's agent represents your buyer. Each is entered as a percentage of the sale price.</p>
<p><b>Both are negotiable.</b> Since the 2024 NAR settlement there is no "standard" rate — nationally they average about 5.5% combined, but every listing agreement is its own deal. Selling it yourself, or you're the agent? Set the listing side to 0.</p>
<p>In flat-% mode these two fields drive the all-in closing cost number below. In Texas net-sheet mode they're itemized directly.</p>`,
  },
  "closing-pct": {
    title: "All-in closing costs",
    body: `<p>Everything the seller pays at closing, rolled into one percentage of the sale price: agent commissions plus roughly 2.5% for title insurance, escrow/settlement fees, and transfer costs.</p>
<p>It auto-adjusts when you edit the commission fields (commissions + ≈2.5%). Drag the slider or type to override it with your own number.</p>
<p><b>Caveats:</b> the ≈2.5% baseline varies by state — transfer taxes are steep in some (NY, DE, WA) and zero in others (TX). Your mortgage payoff and prorated property taxes are <b>not</b> included here; they're separate lines. National all-in seller costs typically run 8–10%.</p>`,
  },
  "title-policy": {
    title: "Owner's title policy",
    body: `<p>Title insurance protecting the buyer against defects in the title (liens, forged deeds, ownership disputes). In Texas the premium is set by the state (TDI basic rates) and by custom the <b>seller</b> pays it — that's what this checkbox models.</p>
<p><b>It's negotiable.</b> If your contract has the buyer paying for their own policy, uncheck this — plenty of net sheets show $0 here. On a ~$1M sale the premium is roughly $5–6k, so it's worth knowing who's covering it.</p>`,
  },
  "fees": {
    title: "Escrow & fixed fees",
    body: `<p>The flat-dollar items on a seller's closing statement: escrow/settlement fee, recording fees, tax certificate, and attorney document prep. On a typical Texas net sheet these total around $1,100.</p>
<p>This field only applies in net-sheet mode — in flat-% mode the all-in percentage already covers these costs, so it's disabled to avoid double-counting.</p>`,
  },
  "close-date": {
    title: "Closing date & tax proration",
    body: `<p>In states that pay property tax in arrears (like Texas), the seller owes the taxes that accrued from January 1 through closing day — the buyer gets that amount as a credit and pays the full bill later.</p>
<p>This calculator computes it as: annual taxes × (days from Jan 1 to closing ÷ 365). A later closing date means a bigger deduction — closing in December costs you nearly the full year's taxes; closing in March, only a few months' worth.</p>
<p><b>Caveat:</b> in states that pay taxes in advance, the proration can run the other way (a credit to you). Your title company's net sheet is the authority.</p>`,
  },
  "dest-state": {
    title: "Destination state",
    body: `<p>Picking a state auto-fills two fields from statewide averages: the <b>property tax rate</b> (average effective rate) and <b>annual homeowners insurance</b> (NerdWallet 2026 averages).</p>
<p>Both stay fully editable — the averages get you in the ballpark, and your county assessor and an actual insurance quote get you the real numbers.</p>`,
  },
  "tax-rate": {
    title: "Property tax rate",
    body: `<p>Your effective annual property tax as a percentage of the home's value. The monthly figure is: purchase price × rate ÷ 12.</p>
<p><b>Caveats:</b> real rates are set at the county/city/district level, not the state — local bonds, school districts, and special assessments (like Mello-Roos in California) can push a specific parcel well above the state average. California reassesses at your purchase price, so a new purchase typically runs ≈1.0–1.25% even though the state "average" looks lower. Check the actual parcel's tax history before you rely on this.</p>`,
  },
  "insurance": {
    title: "Homeowners insurance",
    body: `<p>Auto-filled with your destination state's average annual premium (NerdWallet 2026, based on $400k dwelling coverage with a $1,000 deductible — roughly what a ~$1M-market-price home carries once land value is excluded).</p>
<p><b>Caveats:</b> real quotes swing wildly with wildfire, hail, wind, and flood exposure, the home's age and construction, and your deductible. In high-risk pockets (coastal Florida, wildfire-zone California) actual premiums can be a multiple of the state average — or require state FAIR plans. Get real quotes before you commit; flood insurance is always separate.</p>`,
  },
};

let helpReturnFocus = null;

function openHelp(key) {
  const item = HELP[key];
  if (!item) return;
  $("helpTitle").textContent = item.title;
  $("helpBody").innerHTML = item.body;
  $("helpOverlay").hidden = false;
  helpReturnFocus = document.activeElement;
  $("helpClose").focus();
}

function closeHelp() {
  $("helpOverlay").hidden = true;
  if (helpReturnFocus) { helpReturnFocus.focus(); helpReturnFocus = null; }
}

document.addEventListener("click", (e) => {
  const hint = e.target.closest(".hint[data-help]");
  if (hint) { openHelp(hint.dataset.help); return; }
  if (e.target.id === "helpOverlay" || e.target.closest("#helpClose")) closeHelp();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("helpOverlay").hidden) closeHelp();
});

/* ————— all-in closing % ⇄ commissions / slider ————— */

function syncClosingSlider() {
  const n = parseRate($("txClosingPct").value);
  $("txClosingPctSlider").value = String(Math.min(n, 15));
}

/* commissions drive the all-in % (flat mode only); manual edits override */
function autoFlatFromCommissions() {
  if (sellMode !== "flatpct") return;
  const l = parseRate($("txListingPct").value);
  const b = parseRate($("txBuyerPct").value);
  const allIn = Number((l + b + NON_COMMISSION_PCT).toFixed(2));
  $("txClosingPct").value = String(allIn);
  syncClosingSlider();
  const note = $("closingPctNote");
  note.hidden = false;
  note.textContent = `${(l + b).toFixed(2)}% commissions + ≈${NON_COMMISSION_PCT}% title, escrow & transfer`;
}

function setSubtitle(id, text) {
  const el = $(id);
  if (text) {
    el.textContent = "— " + text;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

/* ————— core math ————— */

function readInputs() {
  return {
    originLabel: $("originLabel").value.trim(),
    destLabel: $("destLabel").value.trim(),
    destState: $("destState").value,
    txSalePrice: parseMoney($("txSalePrice").value),
    txPayoff: parseMoney($("txPayoff").value),
    txListingPct: parseRate($("txListingPct").value),
    txBuyerPct: parseRate($("txBuyerPct").value),
    txClosingPct: parseRate($("txClosingPct").value),
    txAnnualTax: parseMoney($("txAnnualTax").value),
    txCloseDate: $("txCloseDate").value,
    sellMode,
    sellerPaysTitle: $("sellerPaysTitle").checked,
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
  // legacy scenarios predate the checkbox — treat missing as the TX custom (seller pays)
  const titlePolicy = flatPct || v.sellerPaysTitle === false ? 0 : titlePolicyPremium(v.txSalePrice);
  const fees = flatPct ? 0 : v.txClosing; // flat % already covers fixed fees
  const prorated = (v.txAnnualTax ?? 0) * proratedTaxFraction(v.txCloseDate ?? "");
  const proceeds = v.txSalePrice - v.txPayoff - commission - titlePolicy - fees - prorated;

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

  return { commission, sellCostRate, flatPct, titlePolicy, prorated, fees, proceeds, down, loan, cushion, pi, tax, ins, hoa: v.hoa, total, frontPct, backPct, downPct: v.caPrice > 0 ? (down / v.caPrice) * 100 : 0 };
}

/* ————— render ————— */

function render() {
  const v = readInputs();
  const c = compute(v);

  setSubtitle("sellSubtitle", v.originLabel);
  setSubtitle("buySubtitle", v.destLabel);

  $("lblSellCost").textContent = c.flatPct ? `Flat closing (${c.sellCostRate}%)` : "Commissions";
  $("outCommission").textContent = "−" + fmtMoney(c.commission);
  $("rowTitlePolicy").hidden = c.flatPct;
  $("outTitlePolicy").textContent = "−" + fmtMoney(c.titlePolicy);
  $("rowFees").hidden = c.flatPct;
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
    const route = v.originLabel && v.destLabel ? `${v.originLabel} → ${v.destLabel}` : v.destLabel || v.originLabel;
    const money = `Sell ${shortMoney(v.txSalePrice)} / Buy ${shortMoney(v.caPrice)} / ${Math.round((v.caDown / (v.caPrice || 1)) * 100)}% down`;
    name = route ? `${route} · ${money}` : money;
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
  $("originLabel").value = inputs.originLabel || "";
  $("destLabel").value = inputs.destLabel || "";
  // legacy scenarios predate the checkbox
  $("sellerPaysTitle").checked = inputs.sellerPaysTitle !== false;
  const st = inputs.destState || "";
  $("destState").value = st;
  $("insuranceNote").hidden = true; // saved insurance value takes over
  // show the state note only if the saved rate still matches that state's fill rate
  const note = $("taxRateNote");
  if (st && STATE_TAX_RATES[st] != null && Math.abs((inputs.taxRate ?? 0) - stateFillRate(st)) < 0.005) {
    note.hidden = false;
    note.textContent = stateNote(st);
  } else {
    note.hidden = true;
  }
  if (inputs.txClosingPct == null) $("txClosingPct").value = "8.0";
  syncClosingSlider();
  $("closingPctNote").hidden = true; // saved value may not be commission-derived
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
  ["Sale price", (c, v) => fmtMoney(v.txSalePrice)],
  ["Selling costs", (c) => `−${fmtMoney(c.commission + c.titlePolicy + c.fees)} (${c.sellCostRate}%${c.flatPct ? " flat" : " comm. + title/fees"})`],
  ["Prorated taxes", (c) => "−" + fmtMoney(c.prorated)],
  ["Net proceeds", (c) => fmtMoneySigned(c.proceeds)],
  ["Purchase price", (c, v) => fmtMoney(v.caPrice)],
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
  // commissions stay active in both modes — in flat mode they drive the all-in %
  $("fieldTitlePolicy").classList.toggle("inactive", flat);
  $("fieldFees").classList.toggle("inactive", flat);
  $("fieldClosingPct").classList.toggle("inactive", !flat);
  $("sellerPaysTitle").disabled = flat;
  $("txClosing").disabled = flat;
  $("txClosingPct").disabled = !flat;
  $("txClosingPctSlider").disabled = !flat;
  render();
}

document.querySelectorAll("#sellModeToggle button").forEach((b) => {
  b.addEventListener("click", () => {
    // entering net-sheet mode with no itemized fees: prefill typical TX flat-dollar
    // items (escrow $750 + recording $66 + tax cert $65 + attorney $225 = $1,106)
    if (b.dataset.mode === "commission" && parseMoney($("txClosing").value) === 0) {
      $("txClosing").value = "1,106";
    }
    setSellMode(b.dataset.mode);
  });
});

/* ————— wiring ————— */

document.querySelectorAll("input").forEach((el) => {
  el.addEventListener("input", render);
});
$("term").addEventListener("change", render);

["txListingPct", "txBuyerPct"].forEach((id) => {
  $(id).addEventListener("input", () => { autoFlatFromCommissions(); render(); });
});

$("txClosingPctSlider").addEventListener("input", (e) => {
  $("txClosingPct").value = e.target.value;
  $("closingPctNote").hidden = true; // manual override — no longer commission-derived
  render();
});

$("txClosingPct").addEventListener("input", () => {
  syncClosingSlider();
  $("closingPctNote").hidden = true;
});

// clicking anywhere on the closing-date box opens the native calendar —
// the built-in picker icon is easy to miss in the narrow field
$("txCloseDate").addEventListener("click", (e) => {
  if (typeof e.target.showPicker === "function") {
    try { e.target.showPicker(); } catch { /* non-gesture or unsupported — segment editing still works */ }
  }
});

$("destState").addEventListener("change", (e) => {
  applyStateRate(e.target.value);
  render();
});
// a manual edit detaches the value from the state average, so drop the note
$("taxRate").addEventListener("input", () => { $("taxRateNote").hidden = true; });
$("insurance").addEventListener("input", () => { $("insuranceNote").hidden = true; });

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

populateStates();
autoFlatFromCommissions(); // defaults: 2.75 + 2.75 + 2.5 = 8.0% all-in
setSellMode(sellMode);
renderCompare();
