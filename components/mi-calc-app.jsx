"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  TrendingUp, Users, DollarSign, Clock, AlertCircle,
  Download, RotateCcw, Check, Zap, Link2,
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
    <div className="h-screen w-full font-sans flex flex-col overflow-hidden text-sm text-foreground bg-background">
      {/* Top bar — Aneko nav style */}
      <header className="px-6 py-3 flex items-center justify-between gap-4 border-b border-border bg-aneko-deep shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-primary/15 border border-primary/30 text-primary flex items-center justify-center">
            <span className="font-black text-sm leading-none">A</span>
          </div>
          <div className="text-foreground font-bold tracking-[0.18em] text-sm">ANEKO</div>
        </div>

        {/* Tabs — flat with active pill */}
        <div className="flex items-center gap-1">
          <TabButton active={tab === "board"} onClick={() => setTab("board")} icon={<TrendingUp className="w-4 h-4" />}>Corporate</TabButton>
          <TabButton active={tab === "ops"}   onClick={() => setTab("ops")}   icon={<Zap className="w-4 h-4" />}>Operations</TabButton>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <SaveIndicator visible={savedTick} />
          <button onClick={handleCopyLink} className="relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-aneko-elev transition">
            <Link2 className="w-3.5 h-3.5" />
            {copiedTick ? <span className="text-aneko-success">Copied</span> : <span>Share</span>}
          </button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={handleReset} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-aneko-elev transition">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </header>

      {/* Shared inputs */}
      <section className="px-5 pt-3 pb-3 shrink-0 border-b border-border bg-aneko-deep">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Shared assumptions</h2>
          <span className="text-[11px] text-muted-foreground">Edit any field — used by both tabs</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
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
    <div className="h-full flex flex-col gap-3 px-5 py-3 min-h-0 overflow-y-auto">
      {/* Summary cards — labor vs value (above inputs & scenario results) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0">
        <div className="rounded-md bg-aneko-elev/40 border border-primary/30 px-4 py-3 ">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-primary/15 border border-primary/30 text-primary flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-primary font-bold">Labor efficiency</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Time reclaimed and directed to labor bank vs capacity</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div className="text-muted-foreground">Efficiency gain</div>
            <div className="tabular-nums font-bold text-foreground text-right">{efficiencyGain.toFixed(1)}%</div>
            <div className="text-muted-foreground">Reclaimed / shift</div>
            <div className="tabular-nums font-bold text-foreground text-right">{minReclaimed.toFixed(1)} min</div>
            <div className="text-muted-foreground">Capacity (min / shift)</div>
            <div className="tabular-nums font-bold text-foreground text-right">{capMin.toFixed(1)} min</div>
            <div className="text-muted-foreground">Labor bank (min / shift)</div>
            <div className="tabular-nums font-black text-base text-primary/85 text-right">{labMin.toFixed(1)} min</div>
          </div>
          <p className="text-[10px] text-muted-foreground/90 mt-2">Dollar impact of the labor bank is summarized in the Annual value card beside this.</p>
        </div>
        <div className="rounded-md bg-aneko-success/10 border border-aneko-success/40 px-4 py-3 ">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-aneko-success/20 border border-aneko-success/40 text-aneko-success flex items-center justify-center shrink-0">
                <DollarSign className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-widest text-aneko-success font-bold">Annual value & labor reclaimed</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Capacity revenue plus dollar-equivalent of reclaimed clinician time (not a cash reduction unless headcount changes)</p>
              </div>
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-muted-foreground">Revenue unlocked (studies)</span>
              <span className="tabular-nums font-bold text-foreground">{fmtCurrency(revenueUnlocked)}</span>
            </div>
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-muted-foreground">Labor value reclaimed</span>
              <span className="tabular-nums font-bold text-foreground">{fmtCurrency(laborSaved)}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-between items-end gap-3 pt-0.5">
              <span className="text-[10px] uppercase tracking-wider text-aneko-success/90 font-bold">Total annual value</span>
              <span className="tabular-nums font-black text-2xl text-aneko-success leading-none">{fmtCurrency(totalValue)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick context — derived throughput (not the main “results” table) */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        <Tile label="Additional studies / yr" value={fmt(addStudiesYr)} icon={<TrendingUp className="w-4 h-4" />} />
        <Tile label="Equivalent radiologists" value={equivRads.toFixed(1)} icon={<Users className="w-4 h-4" />} />
        <Tile label="Minutes reclaimed / shift" value={minReclaimed.toFixed(1)} icon={<Clock className="w-4 h-4" />} />
      </div>

      {/* Inputs: drivers + study mix — natural height; page scrolls to sensitivity */}
      <div className="grid grid-cols-12 gap-3 shrink-0">
        {/* Drivers */}
        <InputPanel title="Drivers" className="col-span-6">
          <div>
            <SliderInput label="Efficiency gain" value={efficiencyGain} min={0.5} max={10} step={0.1}
              onChange={(v) => updBoard("efficiencyGain", v)}
              display={`${efficiencyGain.toFixed(1)}%`} />
            <div className="mt-2 rounded bg-aneko-deep border border-border px-2.5 py-1.5 flex justify-between text-xs">
              <span className="text-muted-foreground">Reclaimed</span>
              <span className="tabular-nums font-bold text-foreground">{minReclaimed.toFixed(1)} min / shift</span>
            </div>
          </div>

          <div>
            <SliderInput label="Reinvest to capacity" value={reinvestPct} min={0} max={100} step={5}
              onChange={(v) => updBoard("reinvestPct", v)}
              display={`${reinvestPct}%`} />
            <div className="mt-2 space-y-1">
              <div className="rounded bg-aneko-deep border border-border px-2.5 py-1.5 flex justify-between items-baseline text-xs">
                <span className="text-muted-foreground">Capacity <span className="tabular-nums text-foreground/90">{capMin.toFixed(1)}m</span></span>
                <span className="tabular-nums font-bold text-foreground">+{fmt(addStudiesYr)} studies/yr</span>
              </div>
              <div className="rounded bg-aneko-deep border border-border px-2.5 py-1.5 flex justify-between items-baseline text-xs">
                <span className="text-muted-foreground">Labor <span className="tabular-nums text-foreground/90">{labMin.toFixed(1)}m</span></span>
                <span className="tabular-nums font-bold text-foreground">{fmtCurrency(laborSaved)}/yr</span>
              </div>
            </div>
          </div>

          <div className="h-px bg-border my-1" />

          <div>
            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Engagement cost</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <input type="number" value={engagementCost} onChange={(e) => updBoard("engagementCost", parseFloat(e.target.value) || 0)}
                className="w-full bg-background border border-input rounded-md pl-7 pr-3 py-2 text-right tabular-nums text-sm text-foreground focus:border-primary focus:outline-none"
                placeholder="0" />
            </div>
            <div className="mt-2.5 flex items-center justify-between px-3 py-2 rounded-md bg-background border border-border">
              <div className="text-xs font-semibold text-foreground/85">Breakeven</div>
              <div className="text-base font-bold tabular-nums text-foreground">{breakevenMo !== null ? `${breakevenMo.toFixed(1)} mo` : "—"}</div>
            </div>
          </div>
        </InputPanel>

        {/* Study mix */}
        <InputPanel title="Study mix" className="col-span-6">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-foreground/85 border-b-2 border-border">
                <th className="text-left py-2 font-bold">Modality</th>
                <th className="text-right py-2 font-bold">Mix %</th>
                <th className="text-right py-2 font-bold">Rev $</th>
                <th className="text-right py-2 font-bold">Min</th>
              </tr>
            </thead>
            <tbody>
              {modalities.map((m, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-1.5 text-foreground font-medium pr-1">{m.name}</td>
                  <td className="text-right py-1"><CellInput value={m.mixPct} onChange={(v) => updateModality(i, "mixPct", v)} /></td>
                  <td className="text-right py-1"><CellInput value={m.revenuePerStudy} onChange={(v) => updateModality(i, "revenuePerStudy", v)} wider /></td>
                  <td className="text-right py-1"><CellInput value={m.readMinutes} onChange={(v) => updateModality(i, "readMinutes", v)} /></td>
                </tr>
              ))}
              <tr className="font-semibold border-t-2 border-input bg-aneko-deep">
                <td className="py-2 text-foreground/85">Weighted avg</td>
                <td className="text-right tabular-nums text-foreground py-2">{totalMix}%</td>
                <td className="text-right tabular-nums text-foreground py-2">{fmtCurrency(wRev)}</td>
                <td className="text-right tabular-nums text-foreground py-2">{wTime.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
          {totalMix !== 100 && <div className="text-xs text-aneko-warning mt-2 font-semibold">Mix = {totalMix}%</div>}
        </InputPanel>
      </div>

      {/* Scenario results — efficiency sensitivity grid (narrower than full viewport) */}
      <div className="shrink-0 w-full max-w-3xl mx-auto rounded-lg bg-aneko-elev border border-input px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 pb-2 border-b border-input">
          <div>
            <h2 className="text-sm uppercase tracking-wide font-bold text-foreground">Scenario results</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Sensitivity analysis — how totals change at different efficiency assumptions (your current gain is highlighted).</p>
          </div>
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-bold">Outputs</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-foreground/85 border-b-2 border-border">
              <th className="text-left py-2 font-bold">Efficiency</th>
              <th className="text-right py-2 font-bold">Min/shift</th>
              <th className="text-right py-2 font-bold">Studies/yr</th>
              <th className="text-right py-2 font-bold">Revenue</th>
              <th className="text-right py-2 font-bold">Labor reclaimed</th>
              <th className="text-right py-2 font-bold">Total</th>
              <th className="text-right py-2 font-bold">Equiv rads</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const active = Math.abs(s.pct - efficiencyGain) < 0.05;
              return (
                <tr key={s.pct} className={`border-b border-border ${active ? "bg-aneko-elev" : ""}`}>
                  <td className={`py-1.5 ${active ? "font-bold text-primary" : "text-foreground/90"}`}>{s.pct}%</td>
                  <td className={`text-right tabular-nums ${active ? "text-foreground" : "text-foreground/90"}`}>{s.mR.toFixed(1)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-foreground" : "text-foreground/90"}`}>{fmt(s.ast)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-foreground" : "text-foreground/90"}`}>{fmtShort(s.rev)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-foreground" : "text-foreground/90"}`}>{fmtShort(s.lab)}</td>
                  <td className={`text-right tabular-nums font-semibold ${active ? "text-aneko-success" : "text-foreground"}`}>{fmtShort(s.total)}</td>
                  <td className={`text-right tabular-nums ${active ? "text-foreground" : "text-foreground/90"}`}>{s.equiv.toFixed(1)}</td>
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

  const toneClass = {
    ok:   "border-aneko-success bg-aneko-deep",
    warn: "border-aneko-warning bg-aneko-deep",
    bad: "border-aneko-warning bg-aneko-deep",
  }[status.tone];
  const toneText = { ok: "text-aneko-success", warn: "text-aneko-warning", bad: "text-aneko-warning" }[status.tone];

  return (
    <div className="h-full flex flex-col gap-3 px-5 py-3 overflow-hidden">
      {/* Top row: corporate target (read-only) + 4 outcome tiles */}
      <div className="grid grid-cols-5 gap-3 shrink-0">
        <Tile label="Corporate target (from Corporate tab)" value={`${corporateTargetPct.toFixed(1)}%`} sub="Efficiency gain assumption" />
        <Tile label="Interrupted min / shift"  value={totals.tot.toFixed(1)}  sub={`${totals.totPct.toFixed(1)}% of shift`} />
        <HeroTile label="Addressable min / shift" value={totals.addr.toFixed(1)} sub={`${totals.addrPct.toFixed(1)}% of shift`} />
        <Tile label={`vs ${corporateTargetPct.toFixed(1)}% target`} value={`${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`} valueTone={status.tone === "bad" ? "orange" : status.tone === "warn" ? "orange" : "emerald"} />
        <Tile label="Addressable hrs / yr"   value={fmt(totals.yearlyHrs)} />
      </div>

      {/* Main table */}
      <div className="flex-1 min-h-0 rounded-md bg-aneko-deep border border-border flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-sm uppercase tracking-wide text-foreground font-bold">Interruption inventory</h2>
          <div className="text-xs text-muted-foreground">Per rad / shift · highlighted columns are editable</div>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-aneko-deep z-10">
              <tr className="text-xs uppercase tracking-wide text-foreground/85 border-b-2 border-border">
                <th className="text-center px-2 py-2.5 w-10 font-bold">#</th>
                <th className="text-left px-3 py-2.5 font-bold">Category</th>
                <th className="text-left px-2 py-2.5 font-bold">Engine</th>
                <th className="text-center px-2 py-2.5 border-l border-border font-bold text-muted-foreground" colSpan={2}>Public default</th>
                <th className="text-center px-2 py-2.5 border-l-2 border-primary font-bold text-primary bg-primary/10" colSpan={2}>MI-Calc actual · editable</th>
                <th className="text-right px-2 py-2.5 border-l border-border font-bold">Lost/shift</th>
                <th className="text-right px-2 py-2.5 font-bold text-primary bg-primary/10">Addr % · editable</th>
                <th className="px-3 py-2.5 border-l border-border font-bold">Addressable</th>
              </tr>
              <tr className="text-[11px] text-muted-foreground bg-aneko-deep border-b border-border font-semibold">
                <th></th><th></th><th></th>
                <th className="text-center border-l border-border py-1">Freq</th><th className="text-center py-1">Min</th>
                <th className="text-center border-l-2 border-primary bg-primary/10 py-1 text-primary">Freq</th><th className="text-center bg-primary/10 py-1 text-primary">Min</th>
                <th className="border-l border-border"></th><th className="bg-primary/10"></th>
                <th className="border-l border-border"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pctOfMax = (r.addr / maxAddr) * 100;
                return (
                  <tr key={r.id} className="border-b border-border hover:bg-aneko-elev/50">
                    <td className="text-center align-middle px-2">
                      <div className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold tabular-nums">{rankMap.get(r.id)}</div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="font-semibold text-foreground">{r.category}</div>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <EngineBadge engine={r.engine} />
                    </td>
                    <td className="px-2 py-2 text-center tabular-nums text-muted-foreground border-l border-border">{r.defaultFreq}</td>
                    <td className="px-2 py-2 text-center tabular-nums text-muted-foreground">{r.defaultMins}</td>
                    <td className="px-1.5 py-1 border-l-2 border-primary bg-primary/10">
                      <CellInput value={r.idxFreq} step={0.1} onChange={(v) => updateRow(i, "idxFreq", v)} wider />
                    </td>
                    <td className="px-1.5 py-1 bg-primary/10">
                      <CellInput value={r.idxMins} step={0.1} onChange={(v) => updateRow(i, "idxMins", v)} wider />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-foreground border-l border-border">{r.timeLost.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right bg-primary/10">
                      <CellInput value={r.addressablePct} onChange={(v) => updateRow(i, "addressablePct", v)} />
                    </td>
                    <td className="px-3 py-2 border-l border-border">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-aneko-elev rounded-sm h-2 overflow-hidden">
                          <div className="bg-primary h-full" style={{ width: `${pctOfMax}%` }} />
                        </div>
                        <div className="w-12 text-right tabular-nums font-bold text-foreground text-xs">{r.addr.toFixed(1)}</div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr className="font-bold border-t-2 border-input bg-aneko-deep">
                <td></td>
                <td className="px-3 py-2 text-foreground" colSpan={2}>Total</td>
                <td className="border-l border-border"></td><td></td>
                <td className="border-l-2 border-primary bg-primary/10"></td><td className="bg-primary/10"></td>
                <td className="px-2 py-2 text-right tabular-nums text-foreground border-l border-border">{totals.tot.toFixed(1)}</td>
                <td className="bg-primary/10"></td>
                <td className="px-3 py-2 text-right tabular-nums text-aneko-success border-l border-border">{totals.addr.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Reconciliation */}
      <div className={`shrink-0 rounded-md border-l-4 px-3 py-2 ${toneClass} border-t border-r border-b border-border`}>
        <div className="flex items-center gap-2">
          <AlertCircle className={`w-4 h-4 shrink-0 ${toneText}`} />
          <div className="flex-1 text-xs text-foreground/90">
            <span className={`font-bold ${toneText}`}>{status.label}.</span>{" "}
            Corporate target <strong className="text-foreground">{corporateTargetPct.toFixed(1)}%</strong> · Addressable interruptions <strong className="text-foreground">{totals.addrPct.toFixed(1)}%</strong> · Gap <strong className={toneText}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SHARED COMPONENTS
// =============================================================================
// Aneko-style engine tag: colored pill matching the visual language of modality/status badges
function EngineBadge({ engine }) {
  const map = {
    Comms:      "bg-violet-500/15 text-violet-300 border-violet-500/30",
    Intake:     "bg-primary/15 text-primary border-primary/30",
    Preference: "bg-aneko-warning/15 text-aneko-warning border-aneko-warning/30",
    General:    "bg-slate-500/15 text-slate-300 border-slate-500/30",
  };
  const cls = map[engine] || "bg-slate-500/15 text-slate-300 border-slate-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold tracking-wide ${cls}`}>
      {engine}
    </span>
  );
}

function TabButton({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition ${
        active
          ? "bg-primary/15 text-primary border border-primary/40"
          : "text-muted-foreground hover:text-foreground hover:bg-aneko-elev border border-transparent"
      }`}>
      {icon} {children}
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

// Input field — Aneko card style with primary tint to signal editability
function InputCard({ label, value, onChange, prefix, step = 1 }) {
  return (
    <div className="rounded-md bg-primary/5 border border-primary/30 p-3">
      <label className="text-[10px] uppercase tracking-widest text-primary font-bold block mb-2">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-base">{prefix}</span>}
        <input type="number" step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full bg-aneko-deep border border-primary/40 rounded-md ${prefix ? "pl-7" : "pl-3"} pr-3 py-2 text-base font-bold tabular-nums text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none transition`} />
      </div>
    </div>
  );
}

// Output tile — Aneko stat pattern: icon-tinted square + big number + label
function Tile({ label, value, sub, icon, valueTone }) {
  const valueClass =
    valueTone === "emerald" ? "text-aneko-success"
    : valueTone === "orange" ? "text-aneko-warning"
    : "text-foreground";
  const iconBoxClass =
    valueTone === "emerald" ? "bg-aneko-success/15 text-aneko-success border-aneko-success/30"
    : valueTone === "orange" ? "bg-aneko-warning/15 text-aneko-warning border-aneko-warning/30"
    : "bg-aneko-elev text-muted-foreground border-border";
  return (
    <div className="rounded-md bg-aneko-elev/40 border border-border px-4 py-3 flex items-center gap-3">
      {icon && (
        <div className={`shrink-0 w-10 h-10 rounded-md border flex items-center justify-center ${iconBoxClass}`}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-2xl font-black tabular-nums leading-none ${valueClass}`}>{value}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-1.5 leading-tight">{label}</div>
        {sub && <div className="text-[11px] text-muted-foreground/80 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// Hero tile — the ONE number that matters most
function HeroTile({ label, value, sub, icon }) {
  return (
    <div className="rounded-md bg-aneko-success/10 border border-aneko-success/40 px-4 py-3 flex items-center gap-3">
      <div className="shrink-0 w-10 h-10 rounded-md bg-aneko-success/20 border border-aneko-success/40 text-aneko-success flex items-center justify-center">
        {icon || <span className="text-sm font-black">★</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-2xl font-black tabular-nums leading-none text-aneko-success">{value}</div>
        <div className="text-[10px] uppercase tracking-widest text-aneko-success font-bold mt-1.5 leading-tight">{label}</div>
        {sub && <div className="text-[11px] text-foreground/85 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// Panel styles — Input vs Output clearly differentiated
function InputPanel({ title, children, className = "" }) {
  return (
    <div className={`rounded-md bg-aneko-elev/40 border border-primary/25 flex flex-col overflow-hidden ${className}`}>
      <div className="px-4 py-2.5 border-b border-primary/20 shrink-0 bg-primary/10 flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-primary font-bold">{title}</span>
        <span className="text-[10px] uppercase tracking-widest text-primary/70 font-bold">Inputs</span>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function SliderInput({ label, value, min, max, step, onChange, display, minL, maxL }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-xs font-semibold text-foreground">{label}</label>
        <span className="text-sm tabular-nums font-bold text-primary">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary" />
      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
        <span>{minL}</span><span>{maxL}</span>
      </div>
    </div>
  );
}

function CellInput({ value, onChange, step = 1, wider = false }) {
  return (
    <input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)}
      className={`${wider ? "w-16" : "w-14"} text-right bg-aneko-deep border border-primary/40 rounded px-1.5 py-1 tabular-nums text-xs font-bold text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none transition`} />
  );
}

