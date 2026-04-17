"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  TrendingUp, Users, DollarSign, Clock, AlertCircle,
  Download, RotateCcw, Check, Zap, Link2,
} from "lucide-react";
import * as XLSX from "xlsx";

// =============================================================================
// IDX Group Australia × Aneko AI — Unified Calculator
// Design system:
//   bg-slate-950   → app background
//   bg-slate-900   → top bar, sections
//   bg-slate-800   → input/context panels (visually lifted)
//   bg-slate-950 + border-slate-600 → input fields (sunken, clear affordance)
//   violet-500     → primary accent (active tab, focus, brand)
//   emerald-400    → reserved for the hero total + "saved"
//   orange-400     → reserved for warning / below-target reconciliation
//   white / slate-200 / slate-400 → 3-level text contrast
// =============================================================================

const STORAGE_KEY = "idx-aneko-calc-v1";
const APP_VERSION = "1.0.0";

const DEFAULT_MODALITIES = [
  { name: "X-ray",       mixPct: 45, revenuePerStudy: 55,  readMinutes: 3 },
  { name: "Ultrasound",  mixPct: 20, revenuePerStudy: 180, readMinutes: 10 },
  { name: "CT",          mixPct: 20, revenuePerStudy: 350, readMinutes: 12 },
  { name: "MRI",         mixPct: 8,  revenuePerStudy: 450, readMinutes: 18 },
  { name: "Mammography", mixPct: 4,  revenuePerStudy: 120, readMinutes: 5 },
  { name: "Nuclear Med", mixPct: 2,  revenuePerStudy: 600, readMinutes: 15 },
  { name: "Fluoroscopy", mixPct: 1,  revenuePerStudy: 280, readMinutes: 8 },
];

const DEFAULT_INTERRUPTIONS = [
  { id: "comms",         category: "Critical / urgent finding communication",     engine: "Comms",      ranzcr: "S9.1, R9.1",          rationale: "Radiologist must communicate urgent findings to referrer. Coordination of care required if uncontactable.",           defaultFreq: 1.5, defaultMins: 8, idxFreq: 1.5, idxMins: 8, addressablePct: 85 },
  { id: "inappropriate", category: "Clinically inappropriate referrals",          engine: "Intake",     ranzcr: "R7.4, R7.8",          rationale: "Referrals must be reviewed and only accepted upon clinical appropriateness determination.",                              defaultFreq: 2,   defaultMins: 4, idxFreq: 2,   idxMins: 4, addressablePct: 60 },
  { id: "prereqs",       category: "Incomplete prerequisites (priors, labs, safety)", engine: "Intake",  ranzcr: "R7.7, R7.11, R7.12, R9.4", rationale: "Referrals reviewed for previous imaging, contraindications, allergies, pregnancy, metal, blood tests.",             defaultFreq: 3,   defaultMins: 3, idxFreq: 3,   idxMins: 3, addressablePct: 75 },
  { id: "protocol",      category: "Tech / protocol escalations",                 engine: "Preference", ranzcr: "R8.7, R8.19",         rationale: "Techs seek radiologist guidance in defined circumstances before proceeding.",                                           defaultFreq: 3,   defaultMins: 2, idxFreq: 3,   idxMins: 2, addressablePct: 40 },
  { id: "callback",      category: "Referrer callbacks on issued reports",        engine: "Comms",      ranzcr: "S9.4",                rationale: "Reporting radiologist must be available to discuss findings with referrers.",                                          defaultFreq: 2,   defaultMins: 3, idxFreq: 2,   idxMins: 3, addressablePct: 30 },
  { id: "other",         category: "Other reading room interruptions",            engine: "General",    ranzcr: "—",                   rationale: "Ambient: phone calls, staff queries, equipment issues, admin.",                                                          defaultFreq: 4,   defaultMins: 1, idxFreq: 4,   idxMins: 1, addressablePct: 20 },
];

const DEFAULT_STATE = {
  version: APP_VERSION,
  shared: {
    radiologists: 485,
    shiftsPerYear: 220,
    shiftMinutes: 450,
    radCostPerYear: 700000,
  },
  board: {
    efficiencyGain: 2,
    reinvestPct: 70,
    engagementCost: 0,
    modalities: DEFAULT_MODALITIES,
  },
  ops: {
    interruptions: DEFAULT_INTERRUPTIONS,
    boardTargetPct: 2,
  },
};

// ---------- persistence ----------
const deepCopy = (o) => JSON.parse(JSON.stringify(o));

function mergeWithDefaults(parsed) {
  return {
    version: APP_VERSION,
    shared: { ...DEFAULT_STATE.shared, ...(parsed.shared || {}) },
    board:  { ...DEFAULT_STATE.board,  ...(parsed.board  || {}), modalities: parsed.board?.modalities || deepCopy(DEFAULT_MODALITIES) },
    ops:    { ...DEFAULT_STATE.ops,    ...(parsed.ops    || {}), interruptions: parsed.ops?.interruptions || deepCopy(DEFAULT_INTERRUPTIONS) },
  };
}

// URL hash codec — base64(JSON) with unicode-safe encoding
function encodeState(state) {
  try {
    const json = JSON.stringify(state);
    return btoa(unescape(encodeURIComponent(json)));
  } catch { return ""; }
}
function decodeStateFromHash() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash || "";
  const m = hash.match(/[#&]s=([^&]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    return mergeWithDefaults(JSON.parse(json));
  } catch { return null; }
}

function loadState() {
  // Priority: URL hash > localStorage > defaults
  const fromHash = decodeStateFromHash();
  if (fromHash) return fromHash;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return deepCopy(DEFAULT_STATE);
    return mergeWithDefaults(JSON.parse(raw));
  } catch {
    return deepCopy(DEFAULT_STATE);
  }
}

function persist(state) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage unavailable */ }
}

// ---------- formatters ----------
const fmt = (n, d = 0) => (isNaN(n) || !isFinite(n)) ? "—" : n.toLocaleString("en-AU", { maximumFractionDigits: d });
const fmtCurrency = (n) => (isNaN(n) || !isFinite(n)) ? "—" : "$" + Math.round(n).toLocaleString("en-AU");
const fmtShort = (n) => {
  if (isNaN(n) || !isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return "$" + Math.round(n / 1_000) + "K";
  return "$" + Math.round(n);
};

// ---------- compute (shared between views and export) ----------
function computeCorporate(state) {
  const { radiologists, shiftsPerYear, shiftMinutes, radCostPerYear } = state.shared;
  const { efficiencyGain, reinvestPct, engagementCost, modalities } = state.board;

  const totalMix = modalities.reduce((s, m) => s + m.mixPct, 0);
  const wRev  = totalMix === 0 ? 0 : modalities.reduce((s, m) => s + (m.mixPct / totalMix) * m.revenuePerStudy, 0);
  const wTime = totalMix === 0 ? 0 : modalities.reduce((s, m) => s + (m.mixPct / totalMix) * m.readMinutes, 0);

  const minReclaimed = shiftMinutes * (efficiencyGain / 100);
  const capMin = minReclaimed * (reinvestPct / 100);
  const labMin = minReclaimed * (1 - reinvestPct / 100);
  const addStudiesYr = (wTime > 0 ? capMin / wTime : 0) * shiftsPerYear * radiologists;
  const revenueUnlocked = addStudiesYr * wRev;
  const radCostPerMin = radCostPerYear / (shiftsPerYear * shiftMinutes);
  const laborSaved = radiologists * shiftsPerYear * labMin * radCostPerMin;
  const equivRads = (minReclaimed * radiologists) / shiftMinutes;
  const totalValue = revenueUnlocked + laborSaved;
  const breakevenMo = engagementCost > 0 && totalValue > 0 ? engagementCost / (totalValue / 12) : null;

  const scenarios = [0.5, 1, 2, 3, 5, 7].map((pct) => {
    const mR = shiftMinutes * (pct / 100);
    const cM = mR * (reinvestPct / 100);
    const lM = mR * (1 - reinvestPct / 100);
    const ast = (wTime > 0 ? cM / wTime : 0) * shiftsPerYear * radiologists;
    const rev = ast * wRev;
    const lab = radiologists * shiftsPerYear * lM * radCostPerMin;
    return { pct, mR, ast, rev, lab, total: rev + lab, equiv: (mR * radiologists) / shiftMinutes };
  });

  return {
    wRev, wTime, totalMix,
    minReclaimed, capMin, labMin,
    addStudiesYr, revenueUnlocked, radCostPerMin, laborSaved, equivRads,
    totalValue, breakevenMo, scenarios,
  };
}

function computeOps(state) {
  const { radiologists, shiftsPerYear, shiftMinutes } = state.shared;
  const { interruptions, boardTargetPct } = state.ops;

  const rows = interruptions.map((r) => {
    const timeLost = r.idxFreq * r.idxMins;
    const addr = timeLost * (r.addressablePct / 100);
    return { ...r, timeLost, addr };
  });

  const tot = rows.reduce((s, r) => s + r.timeLost, 0);
  const addr = rows.reduce((s, r) => s + r.addr, 0);
  const totals = {
    tot, addr,
    totPct: shiftMinutes > 0 ? (tot / shiftMinutes) * 100 : 0,
    addrPct: shiftMinutes > 0 ? (addr / shiftMinutes) * 100 : 0,
    yearlyHrs: (addr * shiftsPerYear * radiologists) / 60,
  };

  const ranked = [...rows].sort((a, b) => b.addr - a.addr);
  const rankMap = new Map(ranked.map((r, i) => [r.id, i + 1]));
  const maxAddr = Math.max(...rows.map((r) => r.addr), 0.001);

  const gap = totals.addrPct - boardTargetPct;
  const status =
    gap >= 1 ? { label: "Comfortable margin", tone: "ok" }
    : gap >= 0 ? { label: "Thin margin",      tone: "warn" }
               : { label: "Below target",     tone: "bad" };

  return { rows, ranked, rankMap, maxAddr, totals, gap, status };
}

// ---------- Excel export ----------
function exportWorkbook(state) {
  const c = computeCorporate(state);
  const o = computeOps(state);
  const today = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Assumptions
  const assumptions = [
    ["IDX × Aneko AI — ROI Scenario"],
    ["Generated", today],
    [],
    ["SHARED"],
    ["Radiologists", state.shared.radiologists],
    ["Shifts per year", state.shared.shiftsPerYear],
    ["Minutes per shift", state.shared.shiftMinutes],
    ["Radiologist cost per year (AUD)", state.shared.radCostPerYear],
    [],
    ["CORPORATE DRIVERS"],
    ["Efficiency gain %", state.board.efficiencyGain],
    ["Reinvest to capacity %", state.board.reinvestPct],
    ["Engagement cost (AUD)", state.board.engagementCost],
    [],
    ["STUDY MIX"],
    ["Modality", "Mix %", "Revenue per study (AUD)", "Read minutes"],
    ...state.board.modalities.map(m => [m.name, m.mixPct, m.revenuePerStudy, m.readMinutes]),
    ["Weighted average", c.totalMix, Number(c.wRev.toFixed(2)), Number(c.wTime.toFixed(2))],
  ];
  const assumptionsSheet = XLSX.utils.aoa_to_sheet(assumptions);
  assumptionsSheet["!cols"] = [{ wch: 36 }, { wch: 18 }, { wch: 22 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, assumptionsSheet, "Assumptions");

  // Sheet 2: Corporate ROI
  const corp = [
    ["CORPORATE ROI"],
    [],
    ["OUTPUTS"],
    ["Minutes reclaimed per shift", Number(c.minReclaimed.toFixed(2))],
    ["Capacity minutes (to reading)", Number(c.capMin.toFixed(2))],
    ["Labor minutes (banked)", Number(c.labMin.toFixed(2))],
    ["Additional studies per year", Math.round(c.addStudiesYr)],
    ["Revenue unlocked (AUD)", Math.round(c.revenueUnlocked)],
    ["Labor saved (AUD)", Math.round(c.laborSaved)],
    ["ANNUAL TOTAL VALUE (AUD)", Math.round(c.totalValue)],
    ["Breakeven (months)", c.breakevenMo !== null ? Number(c.breakevenMo.toFixed(2)) : ""],
    ["Equivalent radiologists", Number(c.equivRads.toFixed(2))],
    [],
    ["SENSITIVITY"],
    ["Efficiency %", "Min/shift", "Studies/yr", "Revenue (AUD)", "Labor saved (AUD)", "Total (AUD)", "Equiv rads"],
    ...c.scenarios.map(s => [s.pct, Number(s.mR.toFixed(2)), Math.round(s.ast), Math.round(s.rev), Math.round(s.lab), Math.round(s.total), Number(s.equiv.toFixed(2))]),
  ];
  const corpSheet = XLSX.utils.aoa_to_sheet(corp);
  corpSheet["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, corpSheet, "Corporate ROI");

  // Sheet 3: Operations Diagnostic
  const ops = [
    ["OPERATIONS DIAGNOSTIC"],
    [],
    ["Board target (%)", state.ops.boardTargetPct],
    [],
    ["INTERRUPTION INVENTORY"],
    ["Rank", "Category", "Engine", "RANZCR", "Default freq", "Default min", "IDX freq", "IDX min", "Lost / shift (min)", "Addressable %", "Addressable (min)"],
    ...o.ranked.map(r => [o.rankMap.get(r.id), r.category, r.engine, r.ranzcr, r.defaultFreq, r.defaultMins, r.idxFreq, r.idxMins, Number(r.timeLost.toFixed(2)), r.addressablePct, Number(r.addr.toFixed(2))]),
    ["", "TOTAL", "", "", "", "", "", "", Number(o.totals.tot.toFixed(2)), "", Number(o.totals.addr.toFixed(2))],
    [],
    ["RECONCILIATION"],
    ["Board target (%)", state.ops.boardTargetPct],
    ["Addressable (% of shift)", Number(o.totals.addrPct.toFixed(2))],
    ["Gap (addressable − target)", Number((o.totals.addrPct - state.ops.boardTargetPct).toFixed(2))],
    ["Status", o.status.label],
    ["Network-wide addressable hours / yr", Math.round(o.totals.yearlyHrs)],
  ];
  const opsSheet = XLSX.utils.aoa_to_sheet(ops);
  opsSheet["!cols"] = [{ wch: 6 }, { wch: 44 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, opsSheet, "Operations");

  XLSX.writeFile(wb, `idx-aneko-roi-${today}.xlsx`);
}

// =============================================================================
// APP SHELL
// =============================================================================
export default function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("board");
  const [savedTick, setSavedTick] = useState(false);
  const [copiedTick, setCopiedTick] = useState(false);
  const firstRun = useRef(true);

  // One-shot: if the initial state came from a URL hash, clear it so ongoing
  // edits don't look like they're re-applying an outdated shared scenario.
  useEffect(() => {
    if (typeof window !== "undefined" && /[#&]s=/.test(window.location.hash)) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    persist(state);
    setSavedTick(true);
    const t = setTimeout(() => setSavedTick(false), 1200);
    return () => clearTimeout(t);
  }, [state]);

  const updShared = (k, v) => setState((s) => ({ ...s, shared: { ...s.shared, [k]: v } }));
  const updBoard  = (k, v) => setState((s) => ({ ...s, board:  { ...s.board,  [k]: v } }));
  const updOps    = (k, v) => setState((s) => ({ ...s, ops:    { ...s.ops,    [k]: v } }));

  const handleExport = () => exportWorkbook(state);

  const handleCopyLink = async () => {
    const encoded = encodeState(state);
    if (!encoded) return;
    const url = `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopiedTick(true);
    setTimeout(() => setCopiedTick(false), 1500);
  };

  const handleReset = () => {
    if (window.confirm("Reset all inputs to defaults?")) {
      setState(deepCopy(DEFAULT_STATE));
    }
  };

  return (
    <div className="h-screen w-full font-sans flex flex-col overflow-hidden text-sm text-white bg-slate-950">
      {/* Top bar */}
      <header className="px-5 py-3 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-900 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-violet-500 flex items-center justify-center">
              <span className="text-white font-black text-sm leading-none">A</span>
            </div>
            <div className="text-white font-black tracking-[0.2em] text-sm">ANEKO</div>
          </div>
          <div className="h-6 w-px bg-slate-700" />
          <div className="text-sm font-semibold text-white">IDX ROI</div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-md bg-slate-950 border border-slate-700">
          <TabButton active={tab === "board"} onClick={() => setTab("board")} icon={<TrendingUp className="w-3.5 h-3.5" />}>Corporate</TabButton>
          <TabButton active={tab === "ops"}   onClick={() => setTab("ops")}   icon={<Zap className="w-3.5 h-3.5" />}>Operations</TabButton>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <SaveIndicator visible={savedTick} />
          <button onClick={handleCopyLink} className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition">
            <Link2 className="w-3.5 h-3.5" />
            {copiedTick ? <span className="text-emerald-400">Copied</span> : <span>Share link</span>}
          </button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-violet-500 hover:bg-violet-400 transition">
            <Download className="w-3.5 h-3.5" /> Export Excel
          </button>
          <button onClick={handleReset} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 transition">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </header>

      {/* Shared inputs */}
      <section className="px-5 py-3 shrink-0 border-b border-slate-800 bg-slate-900 grid grid-cols-4 gap-3">
        <InputCard label="Radiologists"    value={state.shared.radiologists}   onChange={(v) => updShared("radiologists", v)} />
        <InputCard label="Shifts / yr"     value={state.shared.shiftsPerYear}  onChange={(v) => updShared("shiftsPerYear", v)} />
        <InputCard label="Minutes / shift" value={state.shared.shiftMinutes}   onChange={(v) => updShared("shiftMinutes", v)} />
        <InputCard label="Rad cost / yr"   value={state.shared.radCostPerYear} onChange={(v) => updShared("radCostPerYear", v)} prefix="$" />
      </section>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "board"
          ? <BoardView state={state} updBoard={updBoard} />
          : <OpsView state={state} updOps={updOps} />
        }
      </div>
    </div>
  );
}

// =============================================================================
// BOARD VIEW
// =============================================================================
function BoardView({ state, updBoard }) {
  const { efficiencyGain, reinvestPct, engagementCost, modalities } = state.board;

  const updateModality = (idx, field, value) => {
    const next = [...modalities];
    next[idx] = { ...next[idx], [field]: parseFloat(value) || 0 };
    updBoard("modalities", next);
  };

  const c = useMemo(() => computeCorporate(state), [state]);
  const { wRev, wTime, totalMix, minReclaimed, capMin, labMin, addStudiesYr, revenueUnlocked, laborSaved, equivRads, totalValue, breakevenMo, scenarios } = c;

  return (
    <div className="h-full flex flex-col gap-3 px-5 py-3 overflow-hidden">
      {/* Headline tiles — one hero, three supporting */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <HeroTile label="Annual value unlocked" value={fmtShort(totalValue)} icon={<DollarSign className="w-4 h-4" />} />
        <Tile label="Additional studies / yr" value={fmt(addStudiesYr)} icon={<TrendingUp className="w-4 h-4" />} />
        <Tile label="Equivalent radiologists" value={equivRads.toFixed(1)} icon={<Users className="w-4 h-4" />} />
        <Tile label="Minutes reclaimed / shift" value={minReclaimed.toFixed(1)} icon={<Clock className="w-4 h-4" />} />
      </div>

      {/* Three-column grid */}
      <div className="grid grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Drivers */}
        <InputPanel title="Drivers" className="col-span-4">
          <div>
            <SliderInput label="Efficiency gain" value={efficiencyGain} min={0.5} max={10} step={0.1}
              onChange={(v) => updBoard("efficiencyGain", v)}
              display={`${efficiencyGain.toFixed(1)}%`} />
            <div className="mt-2 rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 flex justify-between text-xs">
              <span className="text-slate-400">Reclaimed</span>
              <span className="tabular-nums font-bold text-white">{minReclaimed.toFixed(1)} min / shift</span>
            </div>
          </div>

          <div>
            <SliderInput label="Reinvest to capacity" value={reinvestPct} min={0} max={100} step={5}
              onChange={(v) => updBoard("reinvestPct", v)}
              display={`${reinvestPct}%`} />
            <div className="mt-2 space-y-1">
              <div className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 flex justify-between items-baseline text-xs">
                <span className="text-slate-400">Capacity <span className="tabular-nums text-slate-200">{capMin.toFixed(1)}m</span></span>
                <span className="tabular-nums font-bold text-white">+{fmt(addStudiesYr)} studies/yr</span>
              </div>
              <div className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1.5 flex justify-between items-baseline text-xs">
                <span className="text-slate-400">Labor <span className="tabular-nums text-slate-200">{labMin.toFixed(1)}m</span></span>
                <span className="tabular-nums font-bold text-white">{fmtCurrency(laborSaved)}/yr</span>
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-700 my-1" />

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">Engagement cost</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input type="number" value={engagementCost} onChange={(e) => updBoard("engagementCost", parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-600 rounded-md pl-7 pr-3 py-2 text-right tabular-nums text-sm text-white focus:border-violet-400 focus:outline-none"
                placeholder="0" />
            </div>
            <div className="mt-2.5 flex items-center justify-between px-3 py-2 rounded-md bg-slate-950 border border-slate-700">
              <div className="text-xs font-semibold text-slate-300">Breakeven</div>
              <div className="text-base font-bold tabular-nums text-white">{breakevenMo !== null ? `${breakevenMo.toFixed(1)} mo` : "—"}</div>
            </div>
          </div>
        </InputPanel>

        {/* Study mix */}
        <InputPanel title="Study mix" className="col-span-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-700">
                <th className="text-left py-1.5 font-semibold">Modality</th>
                <th className="text-right py-1.5 font-semibold">Mix %</th>
                <th className="text-right py-1.5 font-semibold">Rev $</th>
                <th className="text-right py-1.5 font-semibold">Min</th>
              </tr>
            </thead>
            <tbody>
              {modalities.map((m, i) => (
                <tr key={i} className="border-b border-slate-800">
                  <td className="py-1.5 text-white font-medium pr-1">{m.name}</td>
                  <td className="text-right py-1"><CellInput value={m.mixPct} onChange={(v) => updateModality(i, "mixPct", v)} /></td>
                  <td className="text-right py-1"><CellInput value={m.revenuePerStudy} onChange={(v) => updateModality(i, "revenuePerStudy", v)} wider /></td>
                  <td className="text-right py-1"><CellInput value={m.readMinutes} onChange={(v) => updateModality(i, "readMinutes", v)} /></td>
                </tr>
              ))}
              <tr className="font-semibold border-t-2 border-slate-600 bg-slate-900">
                <td className="py-2 text-slate-300">Weighted avg</td>
                <td className="text-right tabular-nums text-white py-2">{totalMix}%</td>
                <td className="text-right tabular-nums text-white py-2">{fmtCurrency(wRev)}</td>
                <td className="text-right tabular-nums text-white py-2">{wTime.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
          {totalMix !== 100 && <div className="text-xs text-orange-400 mt-2 font-semibold">Mix = {totalMix}%</div>}
        </InputPanel>

        {/* Value breakdown */}
        <OutputPanel title="Value" className="col-span-4">
          <div className="space-y-3 text-xs">
            <ValueRow label="Revenue" value={fmtCurrency(revenueUnlocked)} />
            <ValueRow label="Labor saved" value={fmtCurrency(laborSaved)} />
            <div className="h-px bg-slate-700 my-1" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Annual total</div>
              <div className="tabular-nums font-black text-3xl text-emerald-400 leading-none">{fmtCurrency(totalValue)}</div>
            </div>
          </div>
        </OutputPanel>
      </div>

      {/* Sensitivity */}
      <div className="shrink-0 rounded-md bg-slate-900 border border-slate-700 px-4 py-2.5">
        <h2 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Sensitivity</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-700">
              <th className="text-left py-1.5 font-semibold">Efficiency</th>
              <th className="text-right py-1.5 font-semibold">Min/shift</th>
              <th className="text-right py-1.5 font-semibold">Studies/yr</th>
              <th className="text-right py-1.5 font-semibold">Revenue</th>
              <th className="text-right py-1.5 font-semibold">Labor saved</th>
              <th className="text-right py-1.5 font-semibold">Total</th>
              <th className="text-right py-1.5 font-semibold">Equiv rads</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const active = Math.abs(s.pct - efficiencyGain) < 0.05;
              return (
                <tr key={s.pct} className={`border-b border-slate-800 ${active ? "bg-slate-800" : ""}`}>
                  <td className={`py-1.5 ${active ? "font-bold text-violet-400" : "text-slate-200"}`}>{s.pct}%</td>
                  <td className={`text-right tabular-nums ${active ? "text-white" : "text-slate-200"}`}>{s.mR.toFixed(1)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-white" : "text-slate-200"}`}>{fmt(s.ast)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-white" : "text-slate-200"}`}>{fmtShort(s.rev)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-white" : "text-slate-200"}`}>{fmtShort(s.lab)}</td>
                  <td className={`text-right tabular-nums font-semibold ${active ? "text-emerald-400" : "text-white"}`}>{fmtShort(s.total)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-white" : "text-slate-200"}`}>{s.equiv.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// OPERATIONAL DIAGNOSTIC VIEW
// =============================================================================
function OpsView({ state, updOps }) {
  const { interruptions, boardTargetPct } = state.ops;

  const updateRow = (idx, field, value) => {
    const next = [...interruptions];
    next[idx] = { ...next[idx], [field]: parseFloat(value) || 0 };
    updOps("interruptions", next);
  };

  const o = useMemo(() => computeOps(state), [state]);
  const { rows, rankMap, maxAddr, totals, gap, status } = o;

  const toneClass = {
    ok:   "border-emerald-400 bg-slate-900",
    warn: "border-orange-400 bg-slate-900",
    bad: "border-orange-400 bg-slate-900",
  }[status.tone];
  const toneText = { ok: "text-emerald-400", warn: "text-orange-400", bad: "text-orange-400" }[status.tone];

  return (
    <div className="h-full flex flex-col gap-3 px-5 py-3 overflow-hidden">
      {/* Top row: target input + 4 tiles */}
      <div className="grid grid-cols-5 gap-3 shrink-0">
        <InputCard label="Board target %" value={boardTargetPct} onChange={(v) => updOps("boardTargetPct", v)} step={0.1} />
        <Tile label="Interrupted min / shift"  value={totals.tot.toFixed(1)}  sub={`${totals.totPct.toFixed(1)}%`} />
        <HeroTile label="Addressable min / shift" value={totals.addr.toFixed(1)} sub={`${totals.addrPct.toFixed(1)}%`} />
        <Tile label={`vs ${boardTargetPct.toFixed(1)}% target`} value={`${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`} valueTone={status.tone === "bad" ? "orange" : status.tone === "warn" ? "orange" : "emerald"} />
        <Tile label="Addressable hrs / yr"   value={fmt(totals.yearlyHrs)} />
      </div>

      {/* Main table */}
      <div className="flex-1 min-h-0 rounded-md bg-slate-900 border border-slate-700 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700 flex items-center justify-between shrink-0">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-300 font-bold">Interruption inventory</h2>
          <div className="text-xs text-slate-400">Per rad / shift · RANZCR v12</div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-700">
                <th className="text-center px-2 py-2 w-10 font-semibold">#</th>
                <th className="text-left px-3 py-2 font-semibold">Category</th>
                <th className="text-left px-2 py-2 font-semibold">Engine</th>
                <th className="text-left px-2 py-2 font-semibold">RANZCR</th>
                <th className="text-center px-2 py-2 border-l border-slate-700 font-semibold" colSpan={2}>Public default</th>
                <th className="text-center px-2 py-2 border-l-2 border-violet-500 font-bold text-violet-300 bg-slate-800" colSpan={2}>IDX actual (edit)</th>
                <th className="text-right px-2 py-2 border-l border-slate-700 font-semibold">Lost/shift</th>
                <th className="text-right px-2 py-2 font-semibold">Addr %</th>
                <th className="px-3 py-2 border-l border-slate-700 font-semibold">Addressable</th>
              </tr>
              <tr className="text-[10px] text-slate-500 bg-slate-900 border-b border-slate-700">
                <th></th><th></th><th></th><th></th>
                <th className="text-center border-l border-slate-700 py-1">Freq</th><th className="text-center py-1">Min</th>
                <th className="text-center border-l-2 border-violet-500 bg-slate-800 py-1">Freq</th><th className="text-center bg-slate-800 py-1">Min</th>
                <th className="border-l border-slate-700"></th><th></th>
                <th className="border-l border-slate-700"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pctOfMax = (r.addr / maxAddr) * 100;
                return (
                  <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="text-center align-middle px-2">
                      <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-violet-500 text-white text-[10px] font-bold tabular-nums">{rankMap.get(r.id)}</div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="font-semibold text-white">{r.category}</div>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span className="inline-block px-1.5 py-0.5 rounded border border-slate-600 text-[10px] font-semibold text-slate-200">{r.engine}</span>
                    </td>
                    <td className="px-2 py-2 align-middle text-[10px] text-slate-400 tabular-nums">{r.ranzcr}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-400 border-l border-slate-700">{r.defaultFreq}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-slate-400">{r.defaultMins}</td>
                    <td className="px-1.5 py-1 border-l-2 border-violet-500 bg-slate-800">
                      <CellInput value={r.idxFreq} step={0.1} onChange={(v) => updateRow(i, "idxFreq", v)} wider />
                    </td>
                    <td className="px-1.5 py-1 bg-slate-800">
                      <CellInput value={r.idxMins} step={0.1} onChange={(v) => updateRow(i, "idxMins", v)} wider />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-white border-l border-slate-700">{r.timeLost.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">
                      <CellInput value={r.addressablePct} onChange={(v) => updateRow(i, "addressablePct", v)} />
                    </td>
                    <td className="px-3 py-2 border-l border-slate-700">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-800 rounded-sm h-2 overflow-hidden">
                          <div className="bg-violet-500 h-full" style={{ width: `${pctOfMax}%` }} />
                        </div>
                        <div className="w-12 text-right tabular-nums font-bold text-white text-xs">{r.addr.toFixed(1)}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="font-bold border-t-2 border-slate-600 bg-slate-900">
                <td></td>
                <td className="px-3 py-2 text-white" colSpan={3}>Total</td>
                <td className="border-l border-slate-700"></td><td></td>
                <td className="border-l-2 border-violet-500 bg-slate-800"></td><td className="bg-slate-800"></td>
                <td className="px-2 py-2 text-right tabular-nums text-white border-l border-slate-700">{totals.tot.toFixed(1)}</td>
                <td></td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-400 border-l border-slate-700">{totals.addr.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Reconciliation */}
      <div className={`shrink-0 rounded-md border-l-4 px-3 py-2 ${toneClass} border-t border-r border-b border-slate-700`}>
        <div className="flex items-center gap-2">
          <AlertCircle className={`w-4 h-4 shrink-0 ${toneText}`} />
          <div className="flex-1 text-xs text-slate-200">
            <span className={`font-bold ${toneText}`}>{status.label}.</span>{" "}
            Target <strong className="text-white">{boardTargetPct.toFixed(1)}%</strong> · Addressable <strong className="text-white">{totals.addrPct.toFixed(1)}%</strong> · Gap <strong className={toneText}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SHARED COMPONENTS
// =============================================================================
function TabButton({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition ${
        active
          ? "bg-violet-500 text-white"
          : "text-slate-300 hover:text-white hover:bg-slate-800"
      }`}>
      {icon} {children}
    </button>
  );
}

function SaveIndicator({ visible }) {
  return (
    <div className={`inline-flex items-center gap-1 text-xs font-semibold transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}>
      <Check className="w-3.5 h-3.5 text-emerald-400" />
      <span className="text-emerald-400">Saved</span>
    </div>
  );
}

// Input field with clear visual affordance: sunken bg, solid border, violet focus
function InputCard({ label, value, onChange, prefix, step = 1 }) {
  return (
    <div className="rounded-md bg-slate-800 border border-slate-700 p-3">
      <label className="text-[10px] uppercase tracking-widest text-violet-400 font-bold block mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base">{prefix}</span>}
        <input type="number" step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full bg-slate-950 border border-slate-600 rounded-md ${prefix ? "pl-7" : "pl-3"} pr-3 py-1.5 text-base font-bold tabular-nums text-white focus:border-violet-400 focus:outline-none`} />
      </div>
    </div>
  );
}

// Output tile — neutral dark, white number
function Tile({ label, value, sub, icon, valueTone }) {
  const valueClass =
    valueTone === "emerald" ? "text-emerald-400"
    : valueTone === "orange" ? "text-orange-400"
    : "text-white";
  return (
    <div className="rounded-md bg-slate-900 border border-slate-700 px-4 py-2.5">
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{label}</div>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      <div className={`text-2xl font-black tabular-nums leading-tight mt-1 ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// Hero tile — the ONE number that matters most
function HeroTile({ label, value, sub, icon }) {
  return (
    <div className="rounded-md bg-slate-900 border-2 border-emerald-400 px-4 py-2.5">
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">{label}</div>
        {icon && <div className="text-emerald-400">{icon}</div>}
      </div>
      <div className="text-2xl font-black tabular-nums leading-tight mt-1 text-emerald-400">{value}</div>
      {sub && <div className="text-[10px] text-slate-300 mt-0.5">{sub}</div>}
    </div>
  );
}

// Panel styles — Input vs Output clearly differentiated
function InputPanel({ title, children, className = "" }) {
  return (
    <div className={`rounded-md bg-slate-800 border border-slate-700 flex flex-col overflow-hidden ${className}`}>
      <div className="px-4 py-2 border-b border-slate-700 shrink-0 bg-slate-900">
        <span className="text-[10px] uppercase tracking-widest text-violet-400 font-bold">{title}</span>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">{children}</div>
    </div>
  );
}

function OutputPanel({ title, children, className = "" }) {
  return (
    <div className={`rounded-md bg-slate-900 border border-slate-700 flex flex-col overflow-hidden ${className}`}>
      <div className="px-4 py-2 border-b border-slate-700 shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{title}</span>
      </div>
      <div className="flex-1 overflow-auto p-4">{children}</div>
    </div>
  );
}

function SliderInput({ label, value, min, max, step, onChange, display, minL, maxL }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-xs font-semibold text-white">{label}</label>
        <span className="text-sm tabular-nums font-bold text-violet-400">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet-500" />
      <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
        <span>{minL}</span><span>{maxL}</span>
      </div>
    </div>
  );
}

function CellInput({ value, onChange, step = 1, wider = false }) {
  return (
    <input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)}
      className={`${wider ? "w-16" : "w-14"} text-right bg-slate-950 border border-slate-600 rounded px-1.5 py-1 tabular-nums text-xs font-semibold text-white focus:border-violet-400 focus:outline-none`} />
  );
}

function ValueRow({ label, value }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <div className="text-white text-xs font-medium">{label}</div>
      <div className="tabular-nums font-bold text-base text-white">{value}</div>
    </div>
  );
}
