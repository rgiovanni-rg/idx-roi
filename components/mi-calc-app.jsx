"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  TrendingUp, Users, DollarSign, Clock, AlertCircle,
  Download, RotateCcw, Check, Zap,
} from "lucide-react";
import * as XLSX from "xlsx";

// =============================================================================
// MI-Calc — Unified calculator (Aneko AI)
// UI tokens match Ask-Clarifier: see app/globals.css + tailwind aneko.*
// =============================================================================

const STORAGE_KEY = "mi-calc-v1";
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
  const corporateTargetPct = state.board.efficiencyGain;

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

  const gap = totals.addrPct - corporateTargetPct;
  const status =
    gap >= 1 ? { label: "Addressable interruptions exceed corporate target — defensible", tone: "ok" }
    : gap >= 0 ? { label: "Addressable interruptions just meet corporate target — thin",  tone: "warn" }
               : { label: "Addressable interruptions fall short of corporate target",     tone: "bad" };

  return { rows, ranked, rankMap, maxAddr, totals, gap, status, corporateTargetPct };
}

// ---------- Excel export ----------
function exportWorkbook(state) {
  const c = computeCorporate(state);
  const o = computeOps(state);
  const today = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Assumptions
  const assumptions = [
    ["MI-Calc × Aneko AI — ROI Scenario"],
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
    ["Labor value reclaimed (AUD)", Math.round(c.laborSaved)],
    ["ANNUAL TOTAL VALUE (AUD)", Math.round(c.totalValue)],
    ["Breakeven (months)", c.breakevenMo !== null ? Number(c.breakevenMo.toFixed(2)) : ""],
    ["Equivalent radiologists", Number(c.equivRads.toFixed(2))],
    [],
    ["SENSITIVITY"],
    ["Efficiency %", "Min/shift", "Studies/yr", "Revenue (AUD)", "Labor reclaimed (AUD)", "Total (AUD)", "Equiv rads"],
    ...c.scenarios.map(s => [s.pct, Number(s.mR.toFixed(2)), Math.round(s.ast), Math.round(s.rev), Math.round(s.lab), Math.round(s.total), Number(s.equiv.toFixed(2))]),
  ];
  const corpSheet = XLSX.utils.aoa_to_sheet(corp);
  corpSheet["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, corpSheet, "Corporate ROI");

  // Sheet 3: Operations Diagnostic
  const ops = [
    ["OPERATIONS DIAGNOSTIC"],
    [],
    ["Corporate efficiency target (from Corporate tab, %)", o.corporateTargetPct],
    [],
    ["INTERRUPTION INVENTORY"],
    ["Rank", "Category", "Engine", "Default freq", "Default min", "MI-Calc freq", "MI-Calc min", "Lost / shift (min)", "Addressable %", "Addressable (min)"],
    ...o.ranked.map(r => [o.rankMap.get(r.id), r.category, r.engine, r.defaultFreq, r.defaultMins, r.idxFreq, r.idxMins, Number(r.timeLost.toFixed(2)), r.addressablePct, Number(r.addr.toFixed(2))]),
    ["", "TOTAL", "", "", "", "", "", Number(o.totals.tot.toFixed(2)), "", Number(o.totals.addr.toFixed(2))],
    [],
    ["RECONCILIATION"],
    ["Corporate efficiency target (%)", o.corporateTargetPct],
    ["Addressable interruptions (% of shift)", Number(o.totals.addrPct.toFixed(2))],
    ["Gap (addressable − target)", Number(o.gap.toFixed(2))],
    ["Status", o.status.label],
    ["Network-wide addressable hours / yr", Math.round(o.totals.yearlyHrs)],
  ];
  const opsSheet = XLSX.utils.aoa_to_sheet(ops);
  opsSheet["!cols"] = [{ wch: 6 }, { wch: 44 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, opsSheet, "Operations");

  XLSX.writeFile(wb, `mi-calc-roi-${today}.xlsx`);
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
    <div className="h-screen w-full font-sans flex flex-col overflow-hidden text-sm text-foreground bg-background">
      {/* Top bar */}
      <header className="px-8 h-16 flex items-center justify-between gap-6 bg-aneko-deep shrink-0">
        <div className="flex items-center gap-4">
          <img src="/favicon.svg" alt="Aneko" className="w-8 h-8 rounded-md" />
          <div className="text-foreground font-bold tracking-[0.18em] text-sm">ANEKO</div>
          <div className="h-5 w-px bg-border" />
          <div className="text-base font-semibold text-foreground/90">MI-Calc</div>
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

      {/* Shared inputs — borderless surface, more breathing room */}
      <section className="px-8 py-4 shrink-0 bg-aneko-elev/30">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Shared assumptions</h2>
          <span className="text-xs text-muted-foreground">Used by both tabs</span>
        </div>
        <div className="grid grid-cols-4 gap-6">
          <InputCard label="Radiologists"    value={state.shared.radiologists}   onChange={(v) => updShared("radiologists", v)} />
          <InputCard label="Shifts / yr"     value={state.shared.shiftsPerYear}  onChange={(v) => updShared("shiftsPerYear", v)} />
          <InputCard label="Minutes / shift" value={state.shared.shiftMinutes}   onChange={(v) => updShared("shiftMinutes", v)} />
          <InputCard label="Rad cost / yr"   value={state.shared.radCostPerYear} onChange={(v) => updShared("radCostPerYear", v)} prefix="$" />
        </div>
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
    <div className="h-full flex flex-col gap-6 px-8 py-6 min-h-0 overflow-y-auto">
      {/* Headline: revenue unlocked + breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <div className="md:col-span-2 rounded-lg bg-aneko-elev/60 px-6 py-5">
          <div className="text-xs uppercase tracking-widest text-aneko-success font-semibold">Total annual value</div>
          <div className="flex items-baseline gap-3 mt-2">
            <div className="tabular-nums font-bold text-5xl text-aneko-success leading-none">{fmtCurrency(totalValue)}</div>
            <div className="text-sm text-muted-foreground">at {efficiencyGain.toFixed(1)}% efficiency gain</div>
          </div>
          <div className="grid grid-cols-2 gap-6 mt-5 pt-4 border-t border-border/60">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Revenue unlocked</div>
              <div className="tabular-nums font-bold text-2xl text-foreground mt-1">{fmtCurrency(revenueUnlocked)}</div>
              <div className="text-xs text-muted-foreground mt-1">from {fmt(addStudiesYr)} additional studies</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Labor value reclaimed</div>
              <div className="tabular-nums font-bold text-2xl text-foreground mt-1">{fmtCurrency(laborSaved)}</div>
              <div className="text-xs text-muted-foreground mt-1">≈ {equivRads.toFixed(1)} equivalent radiologists</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-aneko-elev/60 px-6 py-5">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Time reclaimed / shift</div>
          <div className="tabular-nums font-bold text-5xl text-foreground leading-none mt-2">{minReclaimed.toFixed(1)}<span className="text-lg text-muted-foreground font-normal ml-1.5">min</span></div>
          <div className="space-y-1.5 mt-5 pt-4 border-t border-border/60 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Capacity ({reinvestPct}%)</span><span className="tabular-nums font-semibold text-foreground">{capMin.toFixed(1)} min</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Labor bank ({100-reinvestPct}%)</span><span className="tabular-nums font-semibold text-foreground">{labMin.toFixed(1)} min</span></div>
          </div>
        </div>
      </div>

      {/* Inputs: drivers + study mix */}
      <div className="grid grid-cols-12 gap-4 shrink-0">
        {/* Drivers */}
        <InputPanel title="Drivers" className="col-span-6">
          <SliderInput label="Efficiency gain" value={efficiencyGain} min={0.5} max={10} step={0.1}
            onChange={(v) => updBoard("efficiencyGain", v)}
            display={`${efficiencyGain.toFixed(1)}%`} />

          <SliderInput label="Reinvest to capacity" value={reinvestPct} min={0} max={100} step={5}
            onChange={(v) => updBoard("reinvestPct", v)}
            display={`${reinvestPct}%`} />

          <div className="pt-3 border-t border-border/40">
            <label className="block text-sm font-semibold text-foreground mb-2">Engagement cost</label>
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={engagementCost}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^-?\d*\.?\d*$/.test(v)) updBoard("engagementCost", v === "" ? 0 : parseFloat(v) || 0);
                  }}
                  onFocus={(e) => e.target.select()}
                  className="w-full bg-aneko-deep rounded-md pl-7 pr-3 py-2 text-right tabular-nums text-base font-semibold text-foreground ring-1 ring-border hover:ring-primary/50 focus:ring-2 focus:ring-primary focus:outline-none transition"
                  placeholder="0"
                />
              </div>
              <div className="text-sm text-muted-foreground">Breakeven</div>
              <div className="text-lg font-bold tabular-nums text-foreground tabular-nums">{breakevenMo !== null ? `${breakevenMo.toFixed(1)} mo` : "—"}</div>
            </div>
          </div>
        </InputPanel>

        {/* Study mix */}
        <InputPanel title="Study mix" className="col-span-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <th className="text-left pb-2 font-semibold">Modality</th>
                <th className="text-right pb-2 font-semibold pr-2">Mix %</th>
                <th className="text-right pb-2 font-semibold pr-2">Rev $</th>
                <th className="text-right pb-2 font-semibold pr-2">Min</th>
              </tr>
            </thead>
            <tbody>
              {modalities.map((m, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-1.5 text-foreground font-medium pr-1">{m.name}</td>
                  <td className="text-right py-1.5"><CellInput value={m.mixPct} onChange={(v) => updateModality(i, "mixPct", v)} /></td>
                  <td className="text-right py-1.5"><CellInput value={m.revenuePerStudy} onChange={(v) => updateModality(i, "revenuePerStudy", v)} wider /></td>
                  <td className="text-right py-1.5"><CellInput value={m.readMinutes} onChange={(v) => updateModality(i, "readMinutes", v)} /></td>
                </tr>
              ))}
              <tr className="border-t-2 border-border/60 text-base font-semibold">
                <td className="py-3 text-muted-foreground uppercase tracking-wide text-xs">Weighted avg</td>
                <td className={`text-right tabular-nums py-3 ${totalMix === 100 ? "text-foreground" : "text-aneko-warning"}`}><span className="inline-block w-20 pr-2">{totalMix}%</span></td>
                <td className="text-right tabular-nums text-foreground py-3"><span className="inline-block w-24 pr-2">{fmtCurrency(wRev)}</span></td>
                <td className="text-right tabular-nums text-foreground py-3"><span className="inline-block w-20 pr-2">{wTime.toFixed(1)}</span></td>
              </tr>
            </tbody>
          </table>
          {totalMix !== 100 && (
            <div className="mt-3 px-3 py-2 rounded-md bg-aneko-warning/10 flex items-start gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-aneko-warning shrink-0 mt-0.5" />
              <span className="text-aneko-warning font-medium">
                Mix totals {totalMix}% — {totalMix > 100 ? `over by ${totalMix - 100}%` : `under by ${100 - totalMix}%`}. Weighted average is normalized; adjust inputs to total 100%.
              </span>
            </div>
          )}
        </InputPanel>
      </div>

      {/* Scenario sensitivity */}
      <div className="shrink-0 w-full rounded-lg bg-aneko-elev/60 px-5 py-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">Scenario sensitivity</h2>
          <p className="text-xs text-muted-foreground">Current gain highlighted</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
              <th className="text-left pb-2 font-semibold">Efficiency</th>
              <th className="text-right pb-2 font-semibold">Min/shift</th>
              <th className="text-right pb-2 font-semibold">Studies/yr</th>
              <th className="text-right pb-2 font-semibold">Revenue</th>
              <th className="text-right pb-2 font-semibold">Labor reclaimed</th>
              <th className="text-right pb-2 font-semibold">Total</th>
              <th className="text-right pb-2 font-semibold">Equiv rads</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const active = Math.abs(s.pct - efficiencyGain) < 0.05;
              return (
                <tr key={s.pct} className={`border-t border-border/40 ${active ? "bg-primary/5" : ""}`}>
                  <td className={`py-2.5 ${active ? "font-semibold text-primary" : "text-foreground"}`}>{s.pct}%</td>
                  <td className="text-right tabular-nums py-2.5 text-foreground">{s.mR.toFixed(1)}</td>
                  <td className="text-right tabular-nums py-2.5 text-foreground">{fmt(s.ast)}</td>
                  <td className="text-right tabular-nums py-2.5 text-foreground">{fmtShort(s.rev)}</td>
                  <td className="text-right tabular-nums py-2.5 text-foreground">{fmtShort(s.lab)}</td>
                  <td className={`text-right tabular-nums py-2.5 font-semibold ${active ? "text-aneko-success" : "text-foreground"}`}>{fmtShort(s.total)}</td>
                  <td className="text-right tabular-nums py-2.5 text-foreground">{s.equiv.toFixed(1)}</td>
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
  const { interruptions } = state.ops;

  const updateRow = (idx, field, value) => {
    const next = [...interruptions];
    next[idx] = { ...next[idx], [field]: parseFloat(value) || 0 };
    updOps("interruptions", next);
  };

  const o = useMemo(() => computeOps(state), [state]);
  const { rows, rankMap, maxAddr, totals, gap, status, corporateTargetPct } = o;

  const toneText = { ok: "text-aneko-success", warn: "text-aneko-warning", bad: "text-aneko-warning" }[status.tone];

  return (
    <div className="h-full flex flex-col gap-6 px-8 py-6 overflow-hidden">
      {/* Top row: outcome tiles */}
      <div className="grid grid-cols-5 gap-4 shrink-0">
        <Tile label="Corporate target" value={`${corporateTargetPct.toFixed(1)}%`} sub="from Corporate tab" />
        <Tile label="Interrupted / shift" value={`${totals.tot.toFixed(1)} min`} sub={`${totals.totPct.toFixed(1)}%`} />
        <HeroTile label="Addressable / shift" value={`${totals.addr.toFixed(1)} min`} sub={`${totals.addrPct.toFixed(1)}%`} />
        <Tile label="Gap vs target" value={`${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`} valueTone={status.tone === "bad" || status.tone === "warn" ? "orange" : "emerald"} />
        <Tile label="Addressable hrs / yr" value={fmt(totals.yearlyHrs)} sub="network-wide" />
      </div>

      {/* Main table */}
      <div className="flex-1 min-h-0 rounded-lg bg-aneko-elev/60 flex flex-col overflow-hidden">
        <div className="px-5 pt-4 pb-3 flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-foreground">Interruption inventory</h2>
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Per rad / shift</div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-base">
            <thead className="sticky top-0 bg-aneko-elev/95 backdrop-blur z-10">
              <tr className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                <th className="text-center px-3 py-3 w-12">#</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-3 py-3">Engine</th>
                <th className="text-center px-3 py-3" colSpan={2}>Public default</th>
                <th className="text-center px-3 py-3 text-primary" colSpan={2}>MI-Calc · editable</th>
                <th className="text-right px-3 py-3">Lost/shift</th>
                <th className="text-right px-3 py-3 text-primary">Addr %</th>
                <th className="px-4 py-3">Addressable</th>
              </tr>
              <tr className="text-xs text-muted-foreground/80 font-medium border-b border-border/60">
                <th></th><th></th><th></th>
                <th className="text-center pb-2">Freq</th><th className="text-center pb-2">Min</th>
                <th className="text-center pb-2 text-primary">Freq</th><th className="text-center pb-2 text-primary">Min</th>
                <th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pctOfMax = (r.addr / maxAddr) * 100;
                return (
                  <tr key={r.id} className="border-t border-border/40 hover:bg-aneko-overlay/40 transition">
                    <td className="text-center align-middle px-3 py-3">
                      <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary/15 text-primary text-sm font-semibold tabular-nums">{rankMap.get(r.id)}</div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="font-medium text-foreground text-base">{r.category}</div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <EngineBadge engine={r.engine} />
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums text-base text-muted-foreground">{r.defaultFreq}</td>
                    <td className="px-3 py-3 text-center tabular-nums text-base text-muted-foreground">{r.defaultMins}</td>
                    <td className="px-3 py-2">
                      <CellInput value={r.idxFreq} onChange={(v) => updateRow(i, "idxFreq", v)} wider />
                    </td>
                    <td className="px-3 py-2">
                      <CellInput value={r.idxMins} onChange={(v) => updateRow(i, "idxMins", v)} wider />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-base text-foreground">{r.timeLost.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">
                      <CellInput value={r.addressablePct} onChange={(v) => updateRow(i, "addressablePct", v)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-aneko-deep/60 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-primary h-full rounded-full" style={{ width: `${pctOfMax}%` }} />
                        </div>
                        <div className="w-12 text-right tabular-nums font-semibold text-foreground text-base">{r.addr.toFixed(1)}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="font-semibold border-t-2 border-border/80 text-lg">
                <td></td>
                <td className="px-4 py-3.5 text-muted-foreground uppercase tracking-wide text-xs" colSpan={2}>Total</td>
                <td></td><td></td>
                <td></td><td></td>
                <td className="px-3 py-3.5 text-right tabular-nums text-foreground">{totals.tot.toFixed(1)}</td>
                <td></td>
                <td className="px-4 py-3.5 text-right tabular-nums text-aneko-success">{totals.addr.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Reconciliation — flat inline strip */}
      <div className="shrink-0 rounded-lg bg-aneko-elev/60 px-5 py-3 flex items-center gap-3">
        <AlertCircle className={`w-5 h-5 shrink-0 ${toneText}`} />
        <div className="flex-1 text-sm text-foreground/90">
          <span className={`font-semibold ${toneText}`}>{status.label}.</span>{" "}
          <span className="text-muted-foreground">Corporate target</span> <strong className="text-foreground tabular-nums">{corporateTargetPct.toFixed(1)}%</strong> <span className="text-muted-foreground/60 mx-1">·</span> <span className="text-muted-foreground">Addressable</span> <strong className="text-foreground tabular-nums">{totals.addrPct.toFixed(1)}%</strong> <span className="text-muted-foreground/60 mx-1">·</span> <span className="text-muted-foreground">Gap</span> <strong className={`tabular-nums ${toneText}`}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}%</strong>
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
    <div className="rounded-lg bg-aneko-elev/60 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold truncate">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mt-2">
        <div className={`text-3xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</div>
        {sub && <div className="text-sm text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    </div>
  );
}

// Hero tile — neutral surface, single bold accent on value only
function HeroTile({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-aneko-elev/60 ring-1 ring-aneko-success/30 px-4 py-3">
      <div className="text-xs uppercase tracking-widest text-aneko-success font-semibold truncate">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mt-2">
        <div className="text-3xl font-bold tabular-nums leading-none text-aneko-success">{value}</div>
        {sub && <div className="text-sm text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    </div>
  );
}

// Input panel — borderless surface, single section heading
function InputPanel({ title, children, className = "" }) {
  return (
    <div className={`rounded-lg bg-aneko-elev/60 flex flex-col overflow-hidden ${className}`}>
      <div className="px-4 pt-3 pb-2 shrink-0">
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">{title}</span>
      </div>
      <div className="px-4 pb-4 space-y-4">{children}</div>
    </div>
  );
}

function SliderInput({ label, value, min, max, step, onChange, display }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <label className="text-sm font-semibold text-foreground">{label}</label>
        <span className="text-lg tabular-nums font-bold text-primary leading-none">{display}</span>
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

