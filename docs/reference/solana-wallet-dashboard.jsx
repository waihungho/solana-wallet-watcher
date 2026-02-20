import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Area, AreaChart, Cell
} from "recharts";

const LAMPORTS = 1_000_000_000;
const HELIUS = "https://api.helius.xyz/v0/addresses";

// ─── Utility ────────────────────────────────────────────────────────────────

const short = (a) => a ? a.slice(0, 4) + "…" + a.slice(-4) : "";
const fmtD = (d) => { const x = new Date(d); return `${x.getMonth() + 1}/${x.getDate()}`; };
const fmtT = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ─── Storage: URL params > localStorage ─────────────────────────────────────

function getInitial(paramKey, storageKey) {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get(paramKey);
    if (v) return v;
  } catch {}
  try { return localStorage.getItem(storageKey) || ""; }
  catch { return ""; }
}

function persist(storageKey, value) {
  try { localStorage.setItem(storageKey, value); } catch {}
}

function updateUrlParam(key, value) {
  try {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    window.history.replaceState({}, "", url.toString());
  } catch {}
}

// ─── Helius Fetch ───────────────────────────────────────────────────────────

async function fetchTxs(wallet, apiKey, onProgress) {
  const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
  const all = [];
  let before = null, page = 0;
  while (true) {
    page++;
    onProgress?.(`Fetching page ${page}…`);
    let url = `${HELIUS}/${wallet}/transactions?api-key=${apiKey}&limit=100`;
    if (before) url += `&before=${before}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error("Invalid Helius API key");
      throw new Error(`Helius error ${res.status}`);
    }
    const txs = await res.json();
    if (!txs?.length) break;
    let done = false;
    for (const tx of txs) {
      if (tx.timestamp * 1000 < cutoff) { done = true; break; }
      all.push(tx);
    }
    if (done || txs.length < 100) break;
    before = txs[txs.length - 1].signature;
    await new Promise(r => setTimeout(r, 200));
    if (page > 20) break;
  }
  onProgress?.(`${all.length} transactions loaded.`);
  return all;
}

// ─── Analysis ───────────────────────────────────────────────────────────────

function analyze(wallet, txs) {
  const dMap = {}, cpMap = {}, raw = [];

  // Initialize 15 daily buckets
  for (let i = 14; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    dMap[k] = { date: k, incoming: 0, outgoing: 0, txCount: 0 };
  }

  for (const tx of txs) {
    const ts = tx.timestamp * 1000;
    const dk = new Date(ts).toISOString().slice(0, 10);
    if (dMap[dk]) dMap[dk].txCount++;

    // Native SOL transfers → daily chart + counterparty
    for (const nt of tx.nativeTransfers || []) {
      const sol = nt.amount / LAMPORTS;
      if (sol < 1e-6) continue;
      const isIn = nt.toUserAccount === wallet;
      const isOut = nt.fromUserAccount === wallet;
      const cp = isIn ? nt.fromUserAccount : isOut ? nt.toUserAccount : null;
      if (dMap[dk]) {
        if (isIn) dMap[dk].incoming += sol;
        else if (isOut) dMap[dk].outgoing += sol;
      }
      if (cp && cp !== wallet) {
        trkCp(cpMap, cp, dk, isIn ? sol : 0, isOut ? sol : 0, "SOL");
        raw.push({ ts, incoming: isIn ? sol : 0, outgoing: isOut ? sol : 0, counterparty: cp });
      }
    }

    // Token transfers → counterparty only (not daily SOL chart)
    for (const tt of tx.tokenTransfers || []) {
      const amt = tt.tokenAmount || 0;
      if (amt < 1e-6) continue;
      const isIn = tt.toUserAccount === wallet;
      const isOut = tt.fromUserAccount === wallet;
      const cp = isIn ? tt.fromUserAccount : isOut ? tt.toUserAccount : null;
      if (cp && cp !== wallet) {
        trkCp(cpMap, cp, dk, 0, 0, tt.mint ? short(tt.mint) : "Token");
        // Track token activity as raw event for 1h/24h panels (SOL value = 0, but count matters)
        raw.push({ ts, incoming: 0, outgoing: 0, counterparty: cp, tokenOnly: true });
      }
    }
  }

  const dates = Object.keys(dMap).sort();
  const daily = Object.values(dMap).sort((a, b) => new Date(a.date) - new Date(b.date));

  const cps = Object.values(cpMap).map(c => ({
    address: c.address, count: c.count,
    totalSol: c.totalSol, incomingSol: c.incomingSol, outgoingSol: c.outgoingSol,
    activeDays: c.days.size,
    tokens: Object.entries(c.tokens).map(([n, v]) => ({ name: n, volume: v })).sort((a, b) => b.volume - a.volume),
    daily: dates.map(d => ({
      date: d,
      incoming: c.dd[d]?.incoming || 0,
      outgoing: c.dd[d]?.outgoing || 0,
    })),
  })).sort((a, b) => b.count - a.count).slice(0, 30);

  // Recurrence distribution: how many wallets active on exactly N days
  const dcm = {};
  Object.values(cpMap).forEach(c => {
    const d = c.days.size;
    dcm[d] = (dcm[d] || 0) + 1;
  });
  const rec = Array.from({ length: 15 }, (_, i) => ({
    days: i + 1,
    label: `${i + 1}d`,
    wallets: dcm[i + 1] || 0,
  }));

  const tIn = daily.reduce((s, d) => s + d.incoming, 0);
  const tOut = daily.reduce((s, d) => s + d.outgoing, 0);
  const tTx = daily.reduce((s, d) => s + d.txCount, 0);
  const uW = Object.keys(cpMap).length;
  const toks = new Set();
  Object.values(cpMap).forEach(c => Object.keys(c.tokens).forEach(t => toks.add(t)));

  return {
    dailyData: daily, counterparties: cps, recurrence: rec,
    totalIn: tIn, totalOut: tOut, totalTx: tTx,
    uniqueWallets: uW, totalTokens: toks.size, rawEvents: raw,
  };
}

function trkCp(m, addr, dk, iA, oA, tok) {
  if (!m[addr]) {
    m[addr] = {
      address: addr, count: 0, totalSol: 0, incomingSol: 0, outgoingSol: 0,
      days: new Set(), dd: {}, tokens: {},
    };
  }
  const c = m[addr];
  c.count++;
  c.totalSol += iA + oA;
  c.incomingSol += iA;
  c.outgoingSol += oA;
  c.days.add(dk);
  if (!c.dd[dk]) c.dd[dk] = { incoming: 0, outgoing: 0 };
  c.dd[dk].incoming += iA;
  c.dd[dk].outgoing += oA;
  if (tok) c.tokens[tok] = (c.tokens[tok] || 0) + iA + oA;
}

// ─── Time Window ────────────────────────────────────────────────────────────

function compWin(raw, ms) {
  const cut = Date.now() - ms;
  const ev = raw.filter(e => e.ts >= cut);
  let inc = 0, out = 0;
  const cc = {};
  for (const e of ev) {
    inc += e.incoming;
    out += e.outgoing;
    cc[e.counterparty] = (cc[e.counterparty] || 0) + 1;
  }
  const top = Object.entries(cc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([addr]) => {
      const w = ev.filter(e => e.counterparty === addr);
      return {
        address: addr,
        incoming: w.reduce((s, e) => s + e.incoming, 0),
        outgoing: w.reduce((s, e) => s + e.outgoing, 0),
        count: w.length,
      };
    });
  const bMs = ms <= 3600000 ? 300000 : 3600000;
  const bN = Math.ceil(ms / bMs);
  const bS = Date.now() - ms;
  const bk = Array.from({ length: bN }, (_, i) => ({
    time: bS + i * bMs, incoming: 0, outgoing: 0,
  }));
  for (const e of ev) {
    const i = Math.min(Math.floor((e.ts - bS) / bMs), bN - 1);
    if (i >= 0) {
      bk[i].incoming += e.incoming;
      bk[i].outgoing += e.outgoing;
    }
  }
  return {
    incoming: inc, outgoing: out, net: inc - out,
    txCount: ev.length, walletCount: Object.keys(cc).length,
    topWallets: top, buckets: bk,
  };
}

// ─── Demo ───────────────────────────────────────────────────────────────────

function genDemo() {
  const dd = [];
  for (let i = 14; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dd.push({
      date: d.toISOString().slice(0, 10),
      incoming: +(Math.random() * 50 + 2).toFixed(4),
      outgoing: +(Math.random() * 30 + 1).toFixed(4),
      txCount: Math.floor(Math.random() * 20 + 1),
    });
  }

  const A = [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "3Katmm9dhvLQijAvomteYGQ5RWrMkzRMnNEipMoV3p8X",
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "DfMxnfZzWqLBqGAm2x3Mh9Rz8vQy5UphJ7F4kLNa3V57",
    "HN7cABqLq46Es1jh92dQQisAi5YqpLGj7RZFfFRTfYnk",
    "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1K",
    "CuieVDEDtLo7FypA9SbLM9saXFdb1dsshEkySnMrnzDG",
    "3xxDCjN8s6MgNHwdRWGSmTtSQMoS4aQh6sBJJBkEdWfQ",
  ];
  const aD = dd.map(d => d.date);
  const TK = ["SOL", "USDC", "JUP", "BONK", "WIF"];

  const cps = A.map(addr => {
    const inc = +(Math.random() * 60 + 5).toFixed(4);
    const out = +(Math.random() * 40 + 2).toFixed(4);
    const ad = Math.floor(Math.random() * 12 + 1);
    const act = new Set();
    while (act.size < Math.min(ad, 15)) act.add(Math.floor(Math.random() * 15));
    return {
      address: addr,
      count: Math.floor(Math.random() * 25 + 1),
      totalSol: +(inc + out).toFixed(4),
      incomingSol: inc, outgoingSol: out,
      activeDays: ad,
      tokens: TK.slice(0, Math.floor(Math.random() * 3 + 1)).map(t => ({
        name: t, volume: +(Math.random() * 50).toFixed(2),
      })),
      daily: aD.map((date, idx) => ({
        date,
        incoming: act.has(idx) ? +(Math.random() * inc / ad).toFixed(4) : 0,
        outgoing: act.has(idx) ? +(Math.random() * out / ad).toFixed(4) : 0,
      })),
    };
  }).sort((a, b) => b.activeDays - a.activeDays);

  // FIX #5: Derive recurrence from actual demo counterparties
  const dcm = {};
  cps.forEach(c => { dcm[c.activeDays] = (dcm[c.activeDays] || 0) + 1; });
  // Add extra simulated wallets for realistic distribution
  const extraCounts = { 1: 80, 2: 28, 3: 15, 4: 10, 5: 7, 6: 5, 7: 3, 8: 2, 9: 1, 10: 1 };
  Object.entries(extraCounts).forEach(([d, n]) => {
    dcm[+d] = (dcm[+d] || 0) + n + Math.floor(Math.random() * 5);
  });
  const rec = Array.from({ length: 15 }, (_, i) => ({
    days: i + 1, label: `${i + 1}d`, wallets: dcm[i + 1] || 0,
  }));

  // Raw events for 1h/24h windows
  const raw = [], now = Date.now();
  for (let k = 0; k < 15; k++) {
    raw.push({ ts: now - Math.random() * 3600000, incoming: +(Math.random() * 3).toFixed(4) * 1, outgoing: 0, counterparty: A[Math.floor(Math.random() * A.length)] });
    raw.push({ ts: now - Math.random() * 3600000, incoming: 0, outgoing: +(Math.random() * 2).toFixed(4) * 1, counterparty: A[Math.floor(Math.random() * A.length)] });
  }
  for (let m = 0; m < 50; m++) {
    raw.push({ ts: now - Math.random() * 86400000, incoming: +(Math.random() * 5).toFixed(4) * 1, outgoing: 0, counterparty: A[Math.floor(Math.random() * A.length)] });
    raw.push({ ts: now - Math.random() * 86400000, incoming: 0, outgoing: +(Math.random() * 4).toFixed(4) * 1, counterparty: A[Math.floor(Math.random() * A.length)] });
  }

  return {
    dailyData: dd, counterparties: cps, recurrence: rec, rawEvents: raw,
    totalIn: dd.reduce((s, d) => s + d.incoming, 0),
    totalOut: dd.reduce((s, d) => s + d.outgoing, 0),
    totalTx: dd.reduce((s, d) => s + d.txCount, 0),
    uniqueWallets: rec.reduce((s, d) => s + d.wallets, 0),
    totalTokens: 5,
  };
}

// ─── Colors ─────────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0a0f", surface: "#12121a", surfaceHover: "#1a1a26",
  border: "#1e1e2e", borderLight: "#2a2a3e",
  accent: "#00ffa3", accentDim: "rgba(0,255,163,0.15)",
  red: "#ff4466", redDim: "rgba(255,68,102,0.15)",
  purple: "#9945ff", purpleDim: "rgba(153,69,255,0.15)",
  cyan: "#00d4ff", text: "#e8e8f0", textDim: "#6b6b80", textMuted: "#44445a",
  yellow: "#ffb347", gradient: "linear-gradient(135deg,#00ffa3,#00d4ff)",
};
const FC = ["#00ffa3", "#00d4ff", "#9945ff", "#ff4466", "#ffb347", "#ff6bcc", "#47ff9e", "#478aff"];

// Day-level colors for 1-10 breakdown
const DAY_COLORS = [
  "#6b6b80", // 1d - dim (one-time)
  "#478aff", // 2d
  "#47ff9e", // 3d
  "#00d4ff", // 4d
  "#00ffa3", // 5d
  "#9945ff", // 6d
  "#ffb347", // 7d
  "#ff6bcc", // 8d
  "#ff4466", // 9d
  "#ff4466", // 10d
];

// ═════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [wallet, setWallet] = useState(() => getInitial("wallet", "sol-dash-wallet"));
  const [apiKey, setApiKey] = useState(() => getInitial("key", "sol-dash-apikey"));
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [isDemo, setIsDemo] = useState(false);
  const [tab, setTab] = useState("flow");
  const didAutoRun = useRef(false);

  // FIX #1: Only persist non-empty values to localStorage
  useEffect(() => {
    if (apiKey.trim()) persist("sol-dash-apikey", apiKey.trim());
  }, [apiKey]);

  useEffect(() => {
    if (wallet.trim() && !wallet.startsWith("Demo")) {
      persist("sol-dash-wallet", wallet.trim());
    }
  }, [wallet]);

  // FIX #2: URL updated only on Analyze, not on every keystroke
  // (moved updateUrlParam call into handleAnalyze)

  const handleAnalyze = useCallback(async () => {
    if (!wallet.trim() || !apiKey.trim()) {
      setError("Enter wallet address + Helius API key");
      return;
    }
    setLoading(true); setError(""); setData(null); setIsDemo(false);
    try {
      const txs = await fetchTxs(wallet.trim(), apiKey.trim(), setProgress);
      if (!txs.length) {
        setError("No transactions in last 15 days.");
        setLoading(false);
        setProgress(""); // FIX #4: Clear progress on early return
        return;
      }
      setData(analyze(wallet.trim(), txs));
      // FIX #2: Update URL only after successful analysis
      updateUrlParam("wallet", wallet.trim());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
    setProgress("");
  }, [wallet, apiKey]);

  // FIX #3: Auto-run with proper deps
  useEffect(() => {
    if (didAutoRun.current) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("wallet") && (url.searchParams.get("key") || apiKey)) {
        didAutoRun.current = true;
        // Small delay to ensure state is settled
        setTimeout(() => handleAnalyze(), 100);
      }
    } catch {}
  }, [handleAnalyze, apiKey]);

  const handleDemo = useCallback(() => {
    setData(genDemo()); setIsDemo(true); setError(""); setWallet("DemoWallet...");
  }, []);

  const shareUrl = useMemo(() => {
    if (!wallet || wallet.startsWith("Demo")) return "";
    try {
      const u = new URL(window.location.origin + window.location.pathname);
      u.searchParams.set("wallet", wallet);
      return u.toString();
    } catch { return ""; }
  }, [wallet]);

  const h1 = useMemo(() => data ? compWin(data.rawEvents, 3600000) : null, [data]);
  const h24 = useMemo(() => data ? compWin(data.rawEvents, 86400000) : null, [data]);
  const netFlow = useMemo(() => data ? data.dailyData.map(d => ({ ...d, net: +(d.incoming - d.outgoing).toFixed(4) })) : [], [data]);

  // FIX #6: Pre-sort counterparties once for recurrence tab
  const topByDays = useMemo(() => {
    if (!data) return [];
    return data.counterparties.slice().sort((a, b) => b.activeDays - a.activeDays).slice(0, 10);
  }, [data]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'JetBrains Mono','Fira Code','SF Mono',monospace", margin: 0 }}>

      {/* ═══ HEADER ═══ */}
      <header style={{ padding: "28px 24px 20px", borderBottom: `1px solid ${C.border}`, background: "linear-gradient(180deg,rgba(0,255,163,0.03) 0%,transparent 100%)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, boxShadow: `0 0 10px ${C.accent}` }} />
            <span style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", color: C.accent, fontWeight: 600 }}>Solana Wallet Analytics</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 16px", background: C.gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Transaction Flow Dashboard
          </h1>

          {/* API Key */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
              <input type={showKey ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="Helius API key"
                style={{ width: "100%", padding: "9px 12px", paddingRight: 50, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "inherit", outline: "none" }}
                onFocus={e => e.target.style.borderColor = C.purple}
                onBlur={e => e.target.style.borderColor = C.border} />
              <button onClick={() => setShowKey(!showKey)}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "transparent", border: "none", color: C.textDim, fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                {showKey ? "Hide" : "Show"}</button>
            </div>
            <a href="https://dev.helius.xyz/dashboard/app" target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 10, color: C.purple, textDecoration: "none" }}>Get free key</a>
            {apiKey.trim() && (
              <span style={{ fontSize: 9, color: C.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: C.accent, display: "inline-block" }} />saved
              </span>
            )}
          </div>

          {/* Wallet + buttons */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" value={wallet} onChange={e => setWallet(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAnalyze()}
              placeholder="Solana wallet address…"
              style={{ flex: 1, minWidth: 260, padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 12, fontFamily: "inherit", outline: "none" }}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border} />
            <button onClick={handleAnalyze} disabled={loading}
              style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: loading ? C.surface : C.gradient, color: loading ? C.textDim : C.bg, fontWeight: 700, fontSize: 12, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", opacity: (!wallet.trim() || !apiKey.trim()) ? 0.4 : 1 }}>
              {loading ? "Analyzing…" : "Analyze"}</button>
            <button onClick={handleDemo} disabled={loading}
              style={{ padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.borderLight}`, background: "transparent", color: C.textDim, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Demo</button>
            {shareUrl && (
              <button onClick={() => { navigator.clipboard?.writeText(shareUrl); }}
                title="Copy shareable link (wallet only, no API key)"
                style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.borderLight}`, background: "transparent", color: C.textDim, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                Share Link</button>
            )}
          </div>

          {progress && <div style={{ marginTop: 10, fontSize: 11, color: C.accent }}>{progress}</div>}
          {error && <div style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, background: C.redDim, color: C.red, fontSize: 11 }}>{error}</div>}
        </div>
      </header>

      {/* ═══ DASHBOARD ═══ */}
      {data && (
        <main style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 40px" }}>
          {isDemo && <div style={{ padding: "8px 14px", borderRadius: 8, marginBottom: 16, background: C.purpleDim, fontSize: 11, color: C.purple }}>Demo data. Paste a real wallet + API key for live results.</div>}

          {/* 1 HOUR */}
          <SL icon="⚡" label="Last 1 Hour" color={C.yellow} />
          {h1 && <TWP win={h1} bucketLabel={fmtT} />}

          {/* 24 HOURS */}
          <SL icon="◐" label="Last 24 Hours" color={C.cyan} />
          {h24 && <TWP win={h24} bucketLabel={fmtT} />}

          {/* 15-DAY TREND */}
          <SL icon="◇" label="15-Day Trend" color={C.accent} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 14 }}>
            <MS label="Total In" value={`${data.totalIn.toFixed(2)} SOL`} color={C.accent} />
            <MS label="Total Out" value={`${data.totalOut.toFixed(2)} SOL`} color={C.red} />
            <MS label="Transactions" value={data.totalTx} color={C.cyan} />
            <MS label="Unique Wallets" value={data.uniqueWallets} color={C.purple} />
            {data.totalTokens > 0 && <MS label="Token Types" value={data.totalTokens} color={C.yellow} />}
          </div>

          {/* Trend tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 16, background: C.surface, borderRadius: 8, padding: 3, border: `1px solid ${C.border}` }}>
            {[{ k: "flow", l: "In vs Out" }, { k: "net", l: "Net Flow" }, { k: "freq", l: "Wallet Recurrence" }].map(t => (
              <button key={t.k} onClick={() => setTab(t.k)}
                style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: tab === t.k ? C.borderLight : "transparent", color: tab === t.k ? C.text : C.textDim, fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
                {t.l}</button>
            ))}
          </div>

          {tab === "flow" && (
            <Crd title="Daily Incoming vs Outgoing (SOL)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.dailyData} barGap={2} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="date" tickFormatter={fmtD} tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="incoming" name="Incoming" fill={C.accent} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="outgoing" name="Outgoing" fill={C.red} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Crd>
          )}

          {tab === "net" && (
            <Crd title="Net Flow Trend (SOL)">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={netFlow}>
                  <defs>
                    <linearGradient id="ng" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.cyan} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.cyan} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="date" tickFormatter={fmtD} tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} />
                  <YAxis tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} />
                  <Tooltip content={<TT />} />
                  <Area type="monotone" dataKey="net" name="Net" stroke={C.cyan} fill="url(#ng)" strokeWidth={2} dot={{ fill: C.cyan, r: 2.5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </Crd>
          )}

          {tab === "freq" && (
            <>
              {/* Recurrence bar chart */}
              <Crd title="Wallet Recurrence Distribution" sub="How many wallets were active on exactly N days out of 15">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.recurrence} barCategoryGap="15%">
                    <defs>
                      <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={C.purple} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={C.cyan} stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="label" tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} />
                    <YAxis tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} allowDecimals={false} />
                    <Tooltip content={<RecTT />} />
                    <Bar dataKey="wallets" fill="url(#rg)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Crd>

              {/* 1-10 day individual breakdown */}
              <RecurrenceBreakdown recurrence={data.recurrence} uniqueWallets={data.uniqueWallets} />

              {/* Top returning wallets - FIX #6: use pre-sorted array */}
              <Crd title="Top Returning Wallets">
                <ResponsiveContainer width="100%" height={Math.max(200, topByDays.length * 32)}>
                  <BarChart data={topByDays} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                    <XAxis type="number" tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} allowDecimals={false} />
                    <YAxis type="category" dataKey="address" tickFormatter={short} tick={{ fill: C.textDim, fontSize: 10 }} stroke={C.border} width={75} />
                    <Tooltip content={<FreqTT />} />
                    <Bar dataKey="activeDays" name="Active Days" radius={[0, 5, 5, 0]}>
                      {topByDays.map((_, i) => (
                        <Cell key={i} fill={FC[i % FC.length]} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Crd>

              <WalletTbl cps={data.counterparties} />
            </>
          )}

          <div style={{ marginTop: 32, padding: "16px 0", borderTop: `1px solid ${C.border}`, textAlign: "center", fontSize: 10, color: C.textMuted }}>
            Powered by Helius Enhanced Transactions API
          </div>
        </main>
      )}

      {/* ═══ EMPTY STATE ═══ */}
      {!data && !loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "70px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 14, opacity: 0.12 }}>◈</div>
          <div style={{ fontSize: 13, color: C.textDim, maxWidth: 420, lineHeight: 1.7 }}>
            Enter a Solana wallet to see 1-hour, 24-hour, and 15-day transaction analytics.
            <br /><span style={{ fontSize: 10, color: C.textMuted }}>Supports URL params: <code style={{ color: C.accent, fontSize: 10 }}>?wallet=...&key=...</code></span>
          </div>
          <button onClick={handleDemo}
            style={{ marginTop: 20, padding: "9px 22px", borderRadius: 8, border: `1px solid ${C.borderLight}`, background: "transparent", color: C.textDim, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.color = C.textDim; }}>
            Try demo data
          </button>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:${C.bg}}
        ::-webkit-scrollbar-thumb{background:${C.borderLight};border-radius:3px}
      `}</style>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function SL({ icon, label, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "24px 0 12px" }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: `${color}15`, color, fontSize: 14 }}>{icon}</div>
      <span style={{ fontSize: 14, fontWeight: 700, color }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function TWP({ win, bucketLabel }) {
  const metrics = [
    { label: "INCOMING", val: win.incoming.toFixed(4), unit: "SOL", col: C.accent },
    { label: "OUTGOING", val: win.outgoing.toFixed(4), unit: "SOL", col: C.red },
    { label: "NET FLOW", val: `${win.net >= 0 ? "+" : ""}${win.net.toFixed(4)}`, unit: "SOL", col: win.net >= 0 ? C.accent : C.red },
    { label: "ACTIVITY", val: win.txCount, unit: `tx · ${win.walletCount} wallets`, col: C.cyan },
  ];
  return (
    <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)" }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ padding: "14px 16px", borderRight: i < 3 ? `1px solid ${C.border}` : "none" }}>
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 5, letterSpacing: 0.8 }}>{m.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: m.col }}>{m.val}</div>
            <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{m.unit}</div>
          </div>
        ))}
      </div>
      {win.buckets.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 12px 6px" }}>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={win.buckets} barGap={0} barCategoryGap="10%">
              <XAxis dataKey="time" tickFormatter={bucketLabel} tick={{ fill: C.textDim, fontSize: 8 }} stroke={C.border} interval="preserveStartEnd" />
              <Tooltip content={<BktTT fmt={bucketLabel} />} />
              <Bar dataKey="incoming" stackId="a" fill={C.accent} fillOpacity={0.7} />
              <Bar dataKey="outgoing" stackId="a" fill={C.red} fillOpacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {win.topWallets.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px" }}>
          <div style={{ fontSize: 9, color: C.textDim, marginBottom: 6, letterSpacing: 0.5 }}>TOP COUNTERPARTIES</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {win.topWallets.map(w => {
              const mx = Math.max(...win.topWallets.map(x => x.incoming + x.outgoing), 0.0001);
              const pct = ((w.incoming + w.outgoing) / mx) * 100;
              const inP = (w.incoming + w.outgoing) > 0 ? (w.incoming / (w.incoming + w.outgoing)) * pct : 0;
              return (
                <div key={w.address} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 6, background: C.bg, fontSize: 10 }}>
                  <code style={{ color: C.text, fontSize: 9, minWidth: 65 }}>{short(w.address)}</code>
                  <span style={{ color: C.textDim, minWidth: 20 }}>{w.count}x</span>
                  {w.incoming > 0 && <span style={{ color: C.accent, fontWeight: 600 }}>↓{w.incoming.toFixed(3)}</span>}
                  {w.outgoing > 0 && <span style={{ color: C.red, fontWeight: 600 }}>↑{w.outgoing.toFixed(3)}</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 3, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                      <div style={{ display: "flex", height: "100%" }}>
                        <div style={{ width: `${inP}%`, background: C.accent }} />
                        <div style={{ width: `${pct - inP}%`, background: C.red }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {win.txCount === 0 && <div style={{ padding: "16px", textAlign: "center", fontSize: 11, color: C.textMuted, borderTop: `1px solid ${C.border}` }}>No activity</div>}
    </div>
  );
}

// ─── Recurrence Breakdown (1-10 days) ───────────────────────────────────────

function RecurrenceBreakdown({ recurrence, uniqueWallets }) {
  const total = uniqueWallets || 1;
  // Show days 1 through 10, then "11-15d" grouped
  const rows = [];
  for (let d = 1; d <= 10; d++) {
    const w = recurrence[d - 1]?.wallets || 0;
    rows.push({ day: d, label: `${d}-day`, wallets: w, pct: (w / total * 100).toFixed(1), color: DAY_COLORS[d - 1] });
  }
  const rest = recurrence.slice(10).reduce((s, r) => s + r.wallets, 0);
  rows.push({ day: 11, label: "11-15d", wallets: rest, pct: (rest / total * 100).toFixed(1), color: C.accent });

  const maxW = Math.max(...rows.map(r => r.wallets), 1);

  return (
    <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "16px", marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Recurrence Breakdown</div>
      <div style={{ fontSize: 10, color: C.textDim, marginBottom: 14 }}>Wallet count by exact active days (out of {uniqueWallets} total)</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(r => (
          <div key={r.day} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 10, color: C.textDim, minWidth: 44, textAlign: "right" }}>{r.label}</span>
            <div style={{ flex: 1, height: 20, background: C.bg, borderRadius: 4, overflow: "hidden", position: "relative" }}>
              <div style={{
                height: "100%", borderRadius: 4,
                background: r.color, opacity: 0.75,
                width: `${Math.max((r.wallets / maxW) * 100, r.wallets > 0 ? 2 : 0)}%`,
                transition: "width 0.3s ease",
              }} />
              {r.wallets > 0 && (
                <span style={{
                  position: "absolute", left: Math.max((r.wallets / maxW) * 100, 2) + 1 + "%",
                  top: "50%", transform: "translateY(-50%)",
                  fontSize: 9, color: C.text, fontWeight: 600,
                }}>{r.wallets}</span>
              )}
            </div>
            <span style={{ fontSize: 9, color: C.textMuted, minWidth: 38, textAlign: "right" }}>{r.pct}%</span>
          </div>
        ))}
      </div>

      {/* Summary line */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: "flex", gap: 16, flexWrap: "wrap" }}>
        {(() => {
          const one = recurrence[0]?.wallets || 0;
          const ret = recurrence.slice(1, 4).reduce((s, d) => s + d.wallets, 0);
          const freq = recurrence.slice(4).reduce((s, d) => s + d.wallets, 0);
          return (
            <>
              <span style={{ fontSize: 10 }}>
                <span style={{ color: C.textDim }}>One-time: </span>
                <span style={{ color: DAY_COLORS[0], fontWeight: 600 }}>{one}</span>
                <span style={{ color: C.textMuted, fontSize: 9 }}> ({(one / total * 100).toFixed(0)}%)</span>
              </span>
              <span style={{ fontSize: 10 }}>
                <span style={{ color: C.textDim }}>2-4 days: </span>
                <span style={{ color: C.cyan, fontWeight: 600 }}>{ret}</span>
                <span style={{ color: C.textMuted, fontSize: 9 }}> ({(ret / total * 100).toFixed(0)}%)</span>
              </span>
              <span style={{ fontSize: 10 }}>
                <span style={{ color: C.textDim }}>5+ days: </span>
                <span style={{ color: C.accent, fontWeight: 600 }}>{freq}</span>
                <span style={{ color: C.textMuted, fontSize: 9 }}> ({(freq / total * 100).toFixed(0)}%)</span>
              </span>
            </>
          );
        })()}
      </div>
    </div>
  );
}

function Crd({ title, sub, children }) {
  return (
    <div style={{ background: C.surface, borderRadius: 12, padding: "16px 14px 10px", border: `1px solid ${C.border}`, marginBottom: 12 }}>
      {title && (
        <div style={{ padding: "0 6px", marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          {sub && <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{sub}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function MS({ label, value, sub, color }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, background: C.surface, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 5, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function WalletTbl({ cps }) {
  const sorted = cps.slice().sort((a, b) => b.activeDays - a.activeDays || b.count - a.count).slice(0, 20);
  return (
    <div style={{ marginTop: 12, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
        <span>Wallet Details</span>
        <span style={{ fontSize: 9, color: C.textDim }}>
          <span style={{ color: C.accent }}>■</span> In (SOL)
          {" "}<span style={{ color: C.red }}>■</span> Out (SOL)
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["#", "Wallet", "Days", "In (SOL)", "Out (SOL)", "15-Day", "Label"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: C.textDim, fontWeight: 500, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((cp, i) => {
              const lbl = cp.activeDays >= 10 ? "Daily" : cp.activeDays >= 5 ? "Frequent" : cp.activeDays >= 2 ? "Returning" : "One-time";
              const lc = cp.activeDays >= 10 ? C.accent : cp.activeDays >= 5 ? C.cyan : cp.activeDays >= 2 ? C.purple : C.textDim;
              const mx = Math.max(...cp.daily.map(d => Math.max(d.incoming, d.outgoing)), 0.0001);
              return (
                <tr key={cp.address} style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "8px 12px", color: C.textDim }}>{i + 1}</td>
                  <td style={{ padding: "8px 12px" }}><code style={{ fontSize: 9, background: C.bg, padding: "2px 5px", borderRadius: 4 }}>{short(cp.address)}</code></td>
                  <td style={{ padding: "8px 12px" }}><span style={{ fontWeight: 700, color: lc }}>{cp.activeDays}</span><span style={{ color: C.textMuted, fontSize: 8 }}>/15</span></td>
                  <td style={{ padding: "8px 12px", color: C.accent, fontWeight: 600 }}>{cp.incomingSol.toFixed(3)}</td>
                  <td style={{ padding: "8px 12px", color: C.red, fontWeight: 600 }}>{cp.outgoingSol.toFixed(3)}</td>
                  <td style={{ padding: "8px 12px" }}><Spk daily={cp.daily} mx={mx} /></td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 9, fontWeight: 600, color: lc, background: `${lc}18`, border: `1px solid ${lc}30` }}>{lbl}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Spk({ daily, mx }) {
  const w = 9, gap = 1.5, h = 26;
  const total = daily.length * (w + gap);
  return (
    <svg width={total} height={h} style={{ display: "block" }}>
      {daily.map((d, i) => {
        const x = i * (w + gap);
        const iH = mx > 0 ? (d.incoming / mx) * (h / 2 - 1) : 0;
        const oH = mx > 0 ? (d.outgoing / mx) * (h / 2 - 1) : 0;
        return (
          <g key={i}>
            {d.incoming > 0 && <rect x={x} y={h / 2 - iH} width={w} height={Math.max(iH, 0.5)} rx={1} fill={C.accent} opacity={0.8} />}
            {d.outgoing > 0 && <rect x={x} y={h / 2 + 1} width={w} height={Math.max(oH, 0.5)} rx={1} fill={C.red} opacity={0.8} />}
            {d.incoming <= 0 && d.outgoing <= 0 && <rect x={x} y={h / 2 - 0.3} width={w} height={0.6} fill={C.border} />}
          </g>
        );
      })}
      <line x1={0} y1={h / 2} x2={total} y2={h / 2} stroke={C.border} strokeWidth={0.4} strokeDasharray="2 2" />
    </svg>
  );
}

// ─── Tooltips ───────────────────────────────────────────────────────────────

function TT({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "10px 14px", fontSize: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
      <div style={{ color: C.textDim, marginBottom: 4 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
          <div style={{ width: 6, height: 6, borderRadius: 1, background: p.color }} />
          <span style={{ color: C.textDim }}>{p.name}:</span>
          <span style={{ fontWeight: 600, color: p.color }}>{typeof p.value === "number" ? p.value.toFixed(4) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

function BktTT({ active, payload, fmt }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "10px 14px", fontSize: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
      <div style={{ color: C.textDim, marginBottom: 4 }}>{fmt?.(d?.time)}</div>
      <div style={{ color: C.accent }}>In: {(d?.incoming || 0).toFixed(4)}</div>
      <div style={{ color: C.red }}>Out: {(d?.outgoing || 0).toFixed(4)}</div>
    </div>
  );
}

function FreqTT({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "10px 14px", fontSize: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.5)", maxWidth: 300 }}>
      <div style={{ color: C.text, fontWeight: 600, marginBottom: 4, wordBreak: "break-all" }}>{d.address}</div>
      <div style={{ color: C.textDim }}>Active: <span style={{ color: C.accent, fontWeight: 600 }}>{d.activeDays}/15 days</span></div>
      <div style={{ color: C.textDim }}>In: <span style={{ color: C.accent }}>{d.incomingSol?.toFixed(4) || 0}</span> Out: <span style={{ color: C.red }}>{d.outgoingSol?.toFixed(4) || 0}</span></div>
      {d.tokens?.length > 0 && <div style={{ color: C.textDim, marginTop: 2 }}>Tokens: <span style={{ color: C.yellow }}>{d.tokens.map(t => t.name).join(", ")}</span></div>}
    </div>
  );
}

function RecTT({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "10px 14px", fontSize: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.5)" }}>
      <div style={{ color: C.text, fontWeight: 600 }}>Active {d.days} day{d.days > 1 ? "s" : ""}</div>
      <div style={{ color: C.textDim }}><span style={{ color: C.cyan, fontWeight: 600 }}>{d.wallets}</span> wallet{d.wallets !== 1 ? "s" : ""}</div>
    </div>
  );
}
