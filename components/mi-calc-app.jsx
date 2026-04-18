"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  TrendingUp, Users, DollarSign, Clock, AlertCircle,
  Download, RotateCcw, Check, Zap,
} from "lucide-react";
import * as XLSX from "xlsx";

// =============================================================================
// ROI Calculator — Aneko AI
// =============================================================================

const STORAGE_KEY = "mi-calc-v1";
const APP_VERSION = "1.0.0";

const DEFAULT_MODALITIES = [
  { name: "X-ray",        mixPct: 45, revenuePerStudy: 55,  readMinutes: 3 },
  { name: "Ultrasound",   mixPct: 20, revenuePerStudy: 180, readMinutes: 10 },
  { name: "CT",           mixPct: 20, revenuePerStudy: 350, readMinutes: 12 },
  { name: "MRI",          mixPct: 8,  revenuePerStudy: 450, readMinutes: 18 },
  { name: "Mammography",  mixPct: 4,  revenuePerStudy: 120, readMinutes: 5 },
  { name: "Nuclear Med",  mixPct: 2,  revenuePerStudy: 600, readMinutes: 15 },
  { name: "Fluoroscopy",  mixPct: 1,  revenuePerStudy: 280, readMinutes: 8 },
  { name: "Other / misc", mixPct: 0,  revenuePerStudy: 200, readMinutes: 8 },
];

const DEFAULT_INTERRUPTIONS = [
  { id: "comms",    category: "Critical / urgent finding communication",                  engine: "Comms",      rationale: "Radiologist must communicate urgent findings to referrer. Coordination of care required if uncontactable.", defaultFreq: 1.5, defaultMins: 8, idxFreq: 1.5, idxMins: 8, addressablePct: 85 },
  { id: "infoseek", category: "Information seeking (priors, RIS/PACS lookup, history)", engine: "Intake",     rationale: "Radiologist pauses mid-read to fetch priors, search RIS/PACS, look up history or missing context.",          defaultFreq: 5,   defaultMins: 2, idxFreq: 5,   idxMins: 2, addressablePct: 75 },
  { id: "protocol", category: "Tech / protocol escalations",                              engine: "Preference", rationale: "Techs seek radiologist guidance in defined circumstances before proceeding.",                                defaultFreq: 3,   defaultMins: 2, idxFreq: 3,   idxMins: 2, addressablePct: 40 },
  { id: "callback", category: "Referrer callbacks on issued reports",                    engine: "Comms",      rationale: "Reporting radiologist must be available to discuss findings with referrers.",                               defaultFreq: 2,   defaultMins: 3, idxFreq: 2,   idxMins: 3, addressablePct: 30 },
  { id: "other",    category: "Other reading room interruptions",                         engine: "General",    rationale: "Ambient: phone calls, staff queries, equipment issues, admin.",                                              defaultFreq: 4,   defaultMins: 1, idxFreq: 4,   idxMins: 1, addressablePct: 20 },
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

function loadState() {
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

// ---------- flash hook: briefly tint a value indigo when it just changed (Pitch-style cause/effect link) ----------
function useFlash(value, ms = 600) {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), ms);
      return () => clearTimeout(t);
    }
  }, [value, ms]);
  return flash;
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
  const { interruptions } = state.ops;

  const rows = interruptions.map((r) => {
    const timeLost = r.idxFreq * r.idxMins;
    const addr = timeLost * (r.addressablePct / 100);
    return { ...r, timeLost, addr };
  });

  const tot = rows.reduce((s, r) => s + r.timeLost, 0);
  const addr = rows.reduce((s, r) => s + r.addr, 0);
  const yearlyMin = addr * shiftsPerYear * radiologists;
  const totals = {
    tot, addr,
    totPct: shiftMinutes > 0 ? (tot / shiftMinutes) * 100 : 0,
    addrPct: shiftMinutes > 0 ? (addr / shiftMinutes) * 100 : 0,
    yearlyHrs: yearlyMin / 60,
    equivFTERads: (shiftsPerYear * shiftMinutes) > 0 ? yearlyMin / (shiftsPerYear * shiftMinutes) : 0,
  };

  const ranked = [...rows].sort((a, b) => b.addr - a.addr);
  const rankMap = new Map(ranked.map((r, i) => [r.id, i + 1]));
  const maxAddr = Math.max(...rows.map((r) => r.addr), 0.001);

  return { rows, ranked, rankMap, maxAddr, totals };
}

// ---------- Excel export ----------
function exportWorkbook(state) {
  const c = computeCorporate(state);
  const o = computeOps(state);
  const today = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Assumptions
  const assumptions = [
    ["Aneko AI — ROI Scenario"],
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
    ["Investment cost (AUD)", state.board.engagementCost],
    [],
    ["STUDY MIX"],
    ["Modality", "Volume mix %", "Revenue per study (AUD)", "Read minutes"],
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
    ["Labor value reclaimed (AUD)", Math.round(c.laborSaved)],
    ["ANNUAL TOTAL VALUE (AUD)", Math.round(c.totalValue)],
    ["Breakeven (months)", c.breakevenMo !== null ? Number(c.breakevenMo.toFixed(2)) : ""],
    ["Equivalent radiologists", Number(c.equivRads.toFixed(2))],
    [],
    ["SENSITIVITY"],
    ["Efficiency gain %", "Reclaimed / shift (min)", "Additional studies / yr", "Revenue unlocked (AUD)", "Labor reclaimed (AUD)", "Total annual value (AUD)", "Equivalent rads"],
    ...c.scenarios.map(s => [s.pct, Number(s.mR.toFixed(2)), Math.round(s.ast), Math.round(s.rev), Math.round(s.lab), Math.round(s.total), Number(s.equiv.toFixed(2))]),
  ];
  const corpSheet = XLSX.utils.aoa_to_sheet(corp);
  corpSheet["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, corpSheet, "Corporate ROI");

  // Sheet 3: Operations Diagnostic
  const ops = [
    ["OPERATIONS DIAGNOSTIC"],
    [],
    ["INTERRUPTION INVENTORY"],
    ["Rank", "Category", "Engine", "Frequency / shift", "Minutes each", "Time / shift (min)", "Addressable %", "Addressable (min)"],
    ...o.ranked.map(r => [o.rankMap.get(r.id), r.category, r.engine, r.idxFreq, r.idxMins, Number(r.timeLost.toFixed(2)), r.addressablePct, Number(r.addr.toFixed(2))]),
    ["", "TOTAL", "", "", "", Number(o.totals.tot.toFixed(2)), "", Number(o.totals.addr.toFixed(2))],
    [],
    ["NETWORK IMPACT"],
    ["Interrupted (% of shift)", Number(o.totals.totPct.toFixed(2))],
    ["Addressable (% of shift)", Number(o.totals.addrPct.toFixed(2))],
    ["Network-wide addressable hours / yr", Math.round(o.totals.yearlyHrs)],
    ["Equivalent FTE radiologists recovered annually", Number(o.totals.equivFTERads.toFixed(2))],
  ];
  const opsSheet = XLSX.utils.aoa_to_sheet(ops);
  opsSheet["!cols"] = [{ wch: 6 }, { wch: 44 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, opsSheet, "Operations");

  XLSX.writeFile(wb, `aneko-roi-${today}.xlsx`);
}

// =============================================================================
// ASSUMPTIONS RAIL (right column)
// =============================================================================
function AssumptionsRail({ tab, state, updShared, updBoard }) {
  const { modalities, engagementCost } = state.board;
  const c = useMemo(() => computeCorporate(state), [state]);
  const { wRev, wTime, totalMix, breakevenMo } = c;

  const updateModality = (idx, field, value) => {
    const next = [...modalities];
    next[idx] = { ...next[idx], [field]: parseFloat(value) || 0 };
    updBoard("modalities", next);
  };

  return (
    <div className="w-full flex flex-col gap-5 px-6 py-6">
      {/* Header — mirrors the left's "Annual financial impact" header */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Assumptions</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Inputs driving every number on the left.</p>
        </div>
      </div>

      {/* Shared inputs — card section matching left */}
      <section className="rounded-lg bg-aneko-elev/60 px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Shared inputs</h3>
          <span className="text-[11px] text-muted-foreground">Network baseline</span>
        </div>
        <div className="grid grid-cols-4 gap-x-3">
          <RailInput label="Radiologists" value={state.shared.radiologists} onChange={(v) => updShared("radiologists", v)} />
          <RailInput label="Shifts / yr" value={state.shared.shiftsPerYear} onChange={(v) => updShared("shiftsPerYear", v)} />
          <RailInput label="Minutes / shift" value={state.shared.shiftMinutes} onChange={(v) => updShared("shiftMinutes", v)} />
          <RailInput label="Rad cost / yr" value={state.shared.radCostPerYear} onChange={(v) => updShared("radCostPerYear", v)} prefix="$" />
        </div>
      </section>

      {tab === "board" && (
        <>
          {/* Study mix */}
          <section className="rounded-lg bg-aneko-elev/60 px-5 py-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Study mix</h3>
              <span className="text-[11px] text-muted-foreground">Weighted averages used on the left</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                  <th className="text-left pb-2 font-semibold">Modality</th>
                  <th className="text-right pb-2 font-semibold px-1">Mix %</th>
                  <th className="text-right pb-2 font-semibold px-1">Rev / study</th>
                  <th className="text-right pb-2 font-semibold pl-1">Minutes</th>
                </tr>
              </thead>
              <tbody>
                {modalities.map((m, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="py-2 text-foreground font-medium pr-1">{m.name}</td>
                    <td className="text-right py-2 px-1"><CellInput value={m.mixPct} onChange={(v) => updateModality(i, "mixPct", v)} /></td>
                    <td className="text-right py-2 px-1"><CellInput value={m.revenuePerStudy} onChange={(v) => updateModality(i, "revenuePerStudy", v)} wider /></td>
                    <td className="text-right py-2 pl-1"><CellInput value={m.readMinutes} onChange={(v) => updateModality(i, "readMinutes", v)} /></td>
                  </tr>
                ))}
                {totalMix !== 100 && (
                  <tr className="border-t border-border/40 bg-aneko-warning/10">
                    <td className="py-2 pr-1 text-aneko-warning text-[11px] font-semibold uppercase tracking-widest">
                      {totalMix > 100 ? "Over by" : "Remaining"}
                    </td>
                    <td className="text-right py-2 px-1 text-aneko-warning font-semibold tabular-nums text-sm">
                      {totalMix > 100 ? `−${totalMix - 100}%` : `+${100 - totalMix}%`}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                )}
                <tr className="border-t-2 border-border/70 bg-aneko-elev/40">
                  <th scope="row" className="py-2.5 text-left text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Weighted avg</th>
                  <td className={`text-right tabular-nums py-2.5 px-1 font-semibold text-sm ${totalMix === 100 ? "text-foreground" : "text-aneko-warning"}`}>{totalMix}%</td>
                  <td className="text-right tabular-nums py-2.5 px-1 font-semibold text-sm text-foreground">{fmtCurrency(wRev)}</td>
                  <td className="text-right tabular-nums py-2.5 pl-1 font-semibold text-sm text-foreground">{wTime.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Investment */}
          <section className="rounded-lg bg-aneko-elev/60 px-5 py-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Investment</h3>
              <span className="text-[11px] text-muted-foreground">Drives breakeven</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 items-end">
              <div>
                <label className="block text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Investment cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={engagementCost}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^-?\d*\.?\d*$/.test(v)) updBoard("engagementCost", v === "" ? 0 : parseFloat(v) || 0);
                    }}
                    onFocus={(e) => e.target.select()}
                    className="w-full bg-aneko-deep rounded-md pl-7 pr-3 py-1.5 text-right tabular-nums text-base font-semibold text-foreground ring-1 ring-border hover:ring-primary/50 focus:ring-2 focus:ring-primary focus:outline-none transition"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Breakeven</div>
                <div className="tabular-nums font-semibold text-2xl leading-none text-foreground">
                  {breakevenMo !== null ? `${breakevenMo.toFixed(1)}` : "—"}
                  {breakevenMo !== null && <span className="text-xs font-medium text-muted-foreground ml-1">mo</span>}
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// Compact input used inside the rail — visual language matches the left-side sections
function RailInput({ label, value, onChange, prefix }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^-?\d*\.?\d*$/.test(v)) {
              setDraft(v);
              if (v !== "" && v !== "-" && v !== ".") {
                const n = parseFloat(v);
                if (!isNaN(n)) onChange(n);
              } else if (v === "") {
                onChange(0);
              }
            }
          }}
          onFocus={(e) => { setFocused(true); e.target.select(); }}
          onBlur={() => setFocused(false)}
          className={`w-full bg-aneko-deep rounded-md ${prefix ? "pl-7" : "pl-3"} pr-3 py-1.5 text-right tabular-nums text-base font-semibold text-foreground ring-1 ring-border hover:ring-primary/50 focus:ring-2 focus:ring-primary focus:outline-none transition`}
        />
      </div>
    </div>
  );
}

// =============================================================================
// APP SHELL
// =============================================================================
export default function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("board");
  const [savedTick, setSavedTick] = useState(false);
  const firstRun = useRef(true);

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

  const handleReset = () => {
    if (window.confirm("Reset all inputs to defaults?")) {
      setState(deepCopy(DEFAULT_STATE));
    }
  };

  return (
    <div className="min-h-screen w-full font-sans flex flex-col text-sm text-foreground bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-20 px-8 h-16 flex items-center justify-between gap-6 bg-aneko-deep shrink-0 border-b border-border/60">
        <div className="flex items-center gap-4">
          <img src="/logo.svg" alt="Aneko" className="h-7" />
          <div className="h-5 w-px bg-border" />
          <div className="text-base font-semibold text-foreground/90">ROI Calculator</div>
        </div>

        {/* Tabs — bottom-underline indicator */}
        <nav className="flex items-center gap-1 self-stretch">
          <TabButton active={tab === "board"} onClick={() => setTab("board")} icon={<TrendingUp className="w-4 h-4" />}>Corporate</TabButton>
          <TabButton active={tab === "ops"}   onClick={() => setTab("ops")}   icon={<Zap className="w-4 h-4" />}>Operations</TabButton>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <SaveIndicator visible={savedTick} />
          <button onClick={handleReset} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-aneko-elev transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </header>

      {/* Main: results (left) + assumptions rail (right). Whole page scrolls as one — no internal scroll. */}
      <div className="flex-1 flex flex-col lg:flex-row">
        <div className="w-full min-w-0 lg:flex-1 flex flex-col">
          {tab === "board"
            ? <BoardView state={state} updBoard={updBoard} />
            : <OpsView state={state} updOps={updOps} updShared={updShared} />
          }
        </div>
        {tab === "board" && (
          <aside className="shrink-0 w-full lg:w-[38rem] border-t lg:border-t-0 lg:border-l border-border bg-aneko-elev/30">
            <AssumptionsRail tab={tab} state={state} updShared={updShared} updBoard={updBoard} />
          </aside>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// BOARD VIEW
// =============================================================================
function BoardView({ state, updBoard }) {
  const { efficiencyGain, reinvestPct } = state.board;

  const c = useMemo(() => computeCorporate(state), [state]);
  const { minReclaimed, capMin, labMin, addStudiesYr, revenueUnlocked, laborSaved, equivRads, totalValue, scenarios } = c;

  // Pitch-style: indigo flash when a value just changed, fades back to its semantic color
  const flashTotal = useFlash(totalValue);
  const flashRev = useFlash(revenueUnlocked);
  const flashStudies = useFlash(addStudiesYr);
  const flashLabor = useFlash(laborSaved);
  const flashEquiv = useFlash(equivRads);

  const { radiologists } = state.shared;

  return (
    <div className="w-full">
      <div className="w-full max-w-5xl flex flex-col gap-5 px-8 py-6">
        {/* Takeaway line */}
        <div className="shrink-0 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Annual financial impact</h2>
            <p className="text-xs text-muted-foreground mt-0.5">What Aneko-driven efficiency is worth this year.</p>
          </div>
          <div className="inline-flex items-center gap-2 text-[11px] text-muted-foreground rounded-full border border-border/60 bg-aneko-elev/40 px-3 py-1 tabular-nums">
            <span>@ {efficiencyGain.toFixed(1)}% efficiency gain</span>
            <span className="text-border">·</span>
            <span>{fmt(radiologists)} rads</span>
          </div>
        </div>

        {/* Hero total */}
        <section className="shrink-0 rounded-lg bg-aneko-elev/60 ring-1 ring-aneko-success/20 px-6 py-5">
          <div className="text-[11px] uppercase tracking-widest text-aneko-success font-semibold">
            Total annual value <span className="text-muted-foreground/70 font-medium normal-case tracking-normal">(AUD)</span>
          </div>
          <div className={`tabular-nums font-bold text-5xl leading-none mt-2 transition-colors duration-500 ${flashTotal ? "text-primary" : "text-aneko-success"}`}>{fmtCurrency(totalValue)}</div>
          <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
            Revenue from the extra studies your team can read, plus the dollar value of time handed back. Assumptions drive every number — edit them in the right column.
          </p>
        </section>

        {/* Bridge + Capacity side-by-side on lg+, stacked otherwise */}
        <div className="shrink-0 grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Bridge table */}
          <section className="lg:col-span-3 rounded-lg bg-aneko-elev/60 px-5 py-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">How it adds up</h3>
              <span className="text-[11px] text-muted-foreground">AUD / year</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t border-border/40">
                  <th scope="row" className="py-2.5 text-left font-medium text-foreground">
                    Revenue unlocked
                    <span className="block text-[11px] font-normal text-muted-foreground">From extra studies read per shift</span>
                  </th>
                  <td className={`py-2.5 text-right tabular-nums font-semibold text-2xl transition-colors duration-500 ${flashRev ? "text-primary" : "text-foreground"}`}>{fmtCurrency(revenueUnlocked)}</td>
                </tr>
                <tr className="border-t border-border/40">
                  <th scope="row" className="py-2.5 text-left font-medium text-foreground">
                    + Labor value reclaimed
                    <span className="block text-[11px] font-normal text-muted-foreground">Dollar value of time banked off the clock</span>
                  </th>
                  <td className={`py-2.5 text-right tabular-nums font-semibold text-2xl transition-colors duration-500 ${flashLabor ? "text-primary" : "text-foreground"}`}>{fmtCurrency(laborSaved)}</td>
                </tr>
                <tr className="border-t-2 border-border/70 bg-aneko-success/5">
                  <th scope="row" className="py-3 text-left font-semibold text-foreground uppercase text-[11px] tracking-widest">
                    = Total annual value
                  </th>
                  <td className={`py-3 text-right tabular-nums font-bold text-2xl transition-colors duration-500 ${flashTotal ? "text-primary" : "text-aneko-success"}`}>{fmtCurrency(totalValue)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* Capacity impact */}
          <section className="lg:col-span-2 rounded-lg bg-aneko-elev/60 px-5 py-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Capacity impact</h3>
              <span className="text-[11px] text-muted-foreground">Non-dollar</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold leading-tight">Studies / yr</div>
                <div className={`tabular-nums font-semibold text-2xl leading-none mt-1 transition-colors duration-500 ${flashStudies ? "text-primary" : "text-foreground"}`}>{fmt(addStudiesYr)}</div>
                <div className="text-[11px] text-muted-foreground mt-1">Extra studies read</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold leading-tight">Equiv. radiologists</div>
                <div className={`tabular-nums font-semibold text-2xl leading-none mt-1 transition-colors duration-500 ${flashEquiv ? "text-primary" : "text-foreground"}`}>{equivRads.toFixed(1)}</div>
                <div className="text-[11px] text-muted-foreground mt-1">Net new clinical capacity</div>
              </div>
            </div>
          </section>
        </div>

        {/* Scenario drivers — full width of shell */}
        <section className="shrink-0 rounded-lg bg-aneko-elev/60 px-5 py-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Scenario drivers</h3>
            <span className="text-[11px] text-muted-foreground">Move the sliders to model a scenario</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div className="min-w-0">
              <SliderInput label="Efficiency gain" value={efficiencyGain} min={0} max={10} step={0.1}
                onChange={(v) => updBoard("efficiencyGain", v)}
                display={`${efficiencyGain.toFixed(1)}%`}
                minL="0%" maxL="10%" />
              <div className="mt-2 flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">Time reclaimed / shift</span>
                <span className="tabular-nums font-semibold text-foreground">{minReclaimed.toFixed(1)} min</span>
              </div>
            </div>
            <div className="min-w-0">
              <SliderInput label="Reinvested for more reads" value={reinvestPct} min={0} max={100} step={5}
                onChange={(v) => updBoard("reinvestPct", v)}
                display={`${reinvestPct}%`}
                minL="0%" maxL="100%" />
              <div className="mt-2 space-y-0.5 text-xs">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">More reads ({reinvestPct}%)</span><span className="tabular-nums font-semibold text-foreground">{capMin.toFixed(1)} min / shift</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground">Off the clock ({100-reinvestPct}%)</span><span className="tabular-nums font-semibold text-foreground">{labMin.toFixed(1)} min / shift</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* Sensitivity — full width of shell */}
        <section className="rounded-lg bg-aneko-elev/60 px-5 pt-4 pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-2">
            <div>
              <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Efficiency sensitivity</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">Other efficiency gains you could assume. The highlighted row matches the slider.</p>
            </div>
          </div>
          <div className="w-full">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                  <th className="text-left py-2 pr-2 font-semibold">
                    <span className="md:hidden">Gain</span>
                    <span className="hidden md:inline">Efficiency</span>
                  </th>
                  <th className="text-right py-2 px-2 font-semibold">
                    <span className="md:hidden">Recl.</span>
                    <span className="hidden md:inline">Reclaimed / shift</span>
                  </th>
                  <th className="text-right py-2 px-2 font-semibold">
                    <span className="md:hidden">Studies</span>
                    <span className="hidden md:inline">Studies / yr</span>
                  </th>
                  <th className="text-right py-2 px-2 font-semibold">Revenue</th>
                  <th className="text-right py-2 px-2 font-semibold">Labor</th>
                  <th className="text-right py-2 px-2 font-semibold text-aneko-success">Total</th>
                  <th className="text-right py-2 pl-2 font-semibold">
                    <span className="md:hidden">Eq.</span>
                    <span className="hidden md:inline">Equiv. rads</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s) => {
                  const active = Math.abs(s.pct - efficiencyGain) < 0.05;
                  return (
                    <tr
                      key={s.pct}
                      className={`border-t border-border/40 ${active ? "bg-primary/5" : "odd:bg-aneko-elev/30"}`}
                    >
                      <td className={`py-2.5 pr-2 text-sm relative ${active ? "font-semibold text-primary" : "text-foreground"}`}>
                        {active && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" aria-hidden />}
                        {s.pct}%
                      </td>
                      <td className="text-right tabular-nums py-2.5 px-2 text-foreground text-sm">{s.mR.toFixed(1)}</td>
                      <td className="text-right tabular-nums py-2.5 px-2 text-foreground text-sm">{fmt(s.ast)}</td>
                      <td className="text-right tabular-nums py-2.5 px-2 text-foreground text-sm">{fmtShort(s.rev)}</td>
                      <td className="text-right tabular-nums py-2.5 px-2 text-foreground text-sm">{fmtShort(s.lab)}</td>
                      <td className={`text-right tabular-nums py-2.5 px-2 font-bold text-base ${active ? "text-aneko-success" : "text-foreground"}`}>{fmtShort(s.total)}</td>
                      <td className="text-right tabular-nums py-2.5 pl-2 text-foreground text-sm">{s.equiv.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// OPERATIONAL DIAGNOSTIC VIEW
// =============================================================================
function OpsView({ state, updOps, updShared }) {
  const { interruptions } = state.ops;

  const updateRow = (idx, field, value) => {
    const next = [...interruptions];
    next[idx] = { ...next[idx], [field]: parseFloat(value) || 0 };
    updOps("interruptions", next);
  };

  const o = useMemo(() => computeOps(state), [state]);
  const { rows, rankMap, maxAddr, totals } = o;

  return (
    <div className="w-full max-w-5xl flex flex-col gap-4 px-8 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-sm font-semibold text-foreground">Results &amp; diagnostic</h2>
        <p className="text-xs text-muted-foreground max-w-xl">
          Within-read interruptions · edit assumptions inline below
        </p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Tile label="Interrupted / shift" value={`${totals.tot.toFixed(1)} min`} sub={`${totals.totPct.toFixed(1)}% of shift`} />
        <HeroTile label="Addressable / shift" value={`${totals.addr.toFixed(1)} min`} sub={`${totals.addrPct.toFixed(1)}% of shift`} />
        <Tile label="Addressable hrs / yr" value={fmt(totals.yearlyHrs)} sub="network-wide" />
        <Tile label="Equivalent FTE rads" value={totals.equivFTERads.toFixed(1)} sub="recovered annually" />
      </div>

      <section className="rounded-lg bg-aneko-elev/60 px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">Assumptions</h3>
          <span className="text-[11px] text-muted-foreground">Inputs driving every metric above</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InputCard label="Radiologists" value={state.shared.radiologists} onChange={(v) => updShared("radiologists", v)} />
          <InputCard label="Shifts / yr" value={state.shared.shiftsPerYear} onChange={(v) => updShared("shiftsPerYear", v)} />
          <InputCard label="Minutes / shift" value={state.shared.shiftMinutes} onChange={(v) => updShared("shiftMinutes", v)} />
          <InputCard label="Rad cost / yr" value={state.shared.radCostPerYear} onChange={(v) => updShared("radCostPerYear", v)} prefix="$" />
        </div>
      </section>

      <div className="rounded-lg bg-aneko-elev/60 flex flex-col border border-border/30">
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Interruption inventory</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              <span className="font-medium text-foreground/80">Engines</span>: <span className="text-violet-300">Comms</span> · <span className="text-primary">Intake</span> · <span className="text-aneko-warning">Preference</span> · <span className="text-slate-300">General</span>
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold whitespace-nowrap">Per rad / shift</div>
        </div>
        <div className="w-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                <th className="text-center px-2 py-2 w-10">#</th>
                <th className="text-left px-2 py-2">Category</th>
                <th className="text-left px-2 py-2">Engine</th>
                <th className="text-center px-2 py-2">Freq.</th>
                <th className="text-center px-2 py-2">Min ea.</th>
                <th className="text-right px-2 py-2">Time</th>
                <th className="text-right px-2 py-2">Addr %</th>
                <th className="px-3 py-2">Addressable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pctOfMax = (r.addr / maxAddr) * 100;
                return (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-aneko-overlay/40 transition">
                    <td className="text-center align-middle px-2 py-2">
                      <div className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold tabular-nums">{rankMap.get(r.id)}</div>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <div className="font-medium text-foreground text-sm leading-snug">{r.category}</div>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <EngineBadge engine={r.engine} />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <CellInput value={r.idxFreq} onChange={(v) => updateRow(i, "idxFreq", v)} wider />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <CellInput value={r.idxMins} onChange={(v) => updateRow(i, "idxMins", v)} wider />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-sm text-foreground">{r.timeLost.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <CellInput value={r.addressablePct} onChange={(v) => updateRow(i, "addressablePct", v)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-aneko-deep/60 rounded-full h-1.5 overflow-hidden min-w-0">
                          <div className="bg-primary h-full rounded-full" style={{ width: `${pctOfMax}%` }} />
                        </div>
                        <div className="w-14 text-right tabular-nums font-semibold text-foreground text-sm shrink-0">{r.addr.toFixed(1)}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border/80">
                <td></td>
                <td className="px-2 py-3 text-muted-foreground uppercase tracking-wide text-[10px] font-semibold" colSpan={2}>Total</td>
                <td></td><td></td>
                <td className="px-2 py-3 text-right tabular-nums font-bold text-xl text-foreground">{totals.tot.toFixed(1)}</td>
                <td></td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-xl text-aneko-success">{totals.addr.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// =============================================================================
// SHARED COMPONENTS
// =============================================================================
// Engine tag — borderless pill, lower font weight, reads as label not button
function EngineBadge({ engine }) {
  const map = {
    Comms:      "bg-violet-500/15 text-violet-300",
    Intake:     "bg-primary/15 text-primary",
    Preference: "bg-aneko-warning/15 text-aneko-warning",
    General:    "bg-slate-500/15 text-slate-300",
  };
  const cls = map[engine] || "bg-slate-500/15 text-slate-300";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {engine}
    </span>
  );
}

function TabButton({ active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-4 h-full text-sm font-semibold transition focus-visible:outline-none ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon} {children}
      {active && <span className="absolute left-3 right-3 bottom-0 h-0.5 rounded-full bg-primary" />}
    </button>
  );
}

function SaveIndicator({ visible }) {
  return (
    <div className={`inline-flex items-center gap-1 text-xs font-semibold transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}>
      <Check className="w-3.5 h-3.5 text-aneko-success" />
      <span className="text-aneko-success">Saved</span>
    </div>
  );
}

// Free-typing input with local draft + select-on-focus, board-readable size
function InputCard({ label, value, onChange, prefix }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  return (
    <div>
      <label className="text-sm uppercase tracking-wide text-muted-foreground font-bold block mb-1.5">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">{prefix}</span>}
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^-?\d*\.?\d*$/.test(v)) {
              setDraft(v);
              if (v !== "" && v !== "-" && v !== ".") {
                const n = parseFloat(v);
                if (!isNaN(n)) onChange(n);
              } else if (v === "") {
                onChange(0);
              }
            }
          }}
          onFocus={(e) => { setFocused(true); e.target.select(); }}
          onBlur={() => setFocused(false)}
          className={`w-full bg-aneko-deep border border-border rounded ${prefix ? "pl-7" : "pl-3"} pr-3 py-2 text-lg font-bold tabular-nums text-foreground hover:border-primary/50 focus:border-primary focus:outline-none transition`}
        />
      </div>
    </div>
  );
}

// Stat tile — borderless, elevation-only, calm typography
function Tile({ label, value, sub, valueTone }) {
  const valueClass =
    valueTone === "emerald" ? "text-aneko-success"
    : valueTone === "orange" ? "text-aneko-warning"
    : "text-foreground";
  return (
    <div className="rounded-lg bg-aneko-elev/60 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold truncate">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <div className={`text-3xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    </div>
  );
}

// Hero tile — neutral surface, single bold accent on value only
function HeroTile({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-aneko-elev/60 ring-1 ring-aneko-success/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-widest text-aneko-success font-semibold truncate">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <div className="text-3xl font-bold tabular-nums leading-none text-aneko-success">{value}</div>
        {sub && <div className="text-xs text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    </div>
  );
}

// Input panel — borderless surface, single section heading
function InputPanel({ title, children, className = "", dense = false }) {
  return (
    <div className={`rounded-lg bg-aneko-elev/60 flex flex-col overflow-hidden ${className}`}>
      <div className={`shrink-0 ${dense ? "px-3 pt-2 pb-1" : "px-4 pt-3 pb-2"}`}>
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">{title}</span>
      </div>
      <div className={`${dense ? "px-3 pb-3 space-y-3" : "px-4 pb-4 space-y-4"}`}>{children}</div>
    </div>
  );
}

function SliderInput({ label, value, min, max, step, onChange, display, minL, maxL, compact = false }) {
  return (
    <div>
      <div className={`flex justify-between items-baseline ${compact ? "mb-1" : "mb-2"}`}>
        <label className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{label}</label>
        <span className={`tabular-nums font-bold text-primary leading-none ${compact ? "text-base" : "text-lg"}`}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary cursor-pointer"
      />
      {(minL || maxL) && (
        <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5">
          <span>{minL}</span>
          <span>{maxL}</span>
        </div>
      )}
    </div>
  );
}

function CellInput({ value, onChange, wider = false }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" || /^-?\d*\.?\d*$/.test(v)) {
          setDraft(v);
          if (v !== "" && v !== "-" && v !== ".") {
            const n = parseFloat(v);
            if (!isNaN(n)) onChange(n);
          }
        }
      }}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); }}
      className={`${wider ? "w-24" : "w-20"} text-right bg-aneko-deep border border-border rounded px-2.5 py-2 tabular-nums text-base font-bold text-foreground hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none transition`}
    />
  );
}

