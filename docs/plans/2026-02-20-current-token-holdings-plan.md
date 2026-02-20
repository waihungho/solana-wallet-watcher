# Current Token Holdings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Current Holdings" panel showing SOL balance and SPL token holdings at the top of the dashboard.

**Architecture:** Two new API calls (`getBalance` + DAS `getAssetsByOwner`) run in parallel with existing `fetchTxs`. A new `holdings` state variable drives a standalone panel rendered above the time-window panels. Uses existing `SL`, `MS`, `Crd` components.

**Tech Stack:** React 19, Helius RPC + DAS API, existing inline-style patterns

---

### Task 1: Add `fetchHoldings` function

**Files:**
- Modify: `docs/reference/solana-wallet-dashboard.jsx:42-72` (after `fetchTxs`)

**Step 1: Add the HELIUS_RPC constant and fetchHoldings function**

Insert after line 9 (`const HELIUS = ...`):

```js
const HELIUS_RPC = "https://mainnet.helius-rpc.com";
```

Insert after `fetchTxs` function (after line 72):

```js
async function fetchHoldings(wallet, apiKey) {
  const rpcUrl = `${HELIUS_RPC}/?api-key=${apiKey}`;

  // Fetch SOL balance and token assets in parallel
  const [balRes, assetsRes] = await Promise.all([
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "sol-bal",
        method: "getBalance",
        params: [wallet],
      }),
    }),
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "das-assets",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: wallet,
          displayOptions: { showFungible: true, showNativeBalance: false },
          page: 1,
          limit: 1000,
        },
      }),
    }),
  ]);

  if (!balRes.ok) throw new Error(`Balance fetch failed: ${balRes.status}`);
  if (!assetsRes.ok) throw new Error(`Assets fetch failed: ${assetsRes.status}`);

  const balJson = await balRes.json();
  const assetsJson = await assetsRes.json();

  const sol = (balJson.result?.value ?? 0) / LAMPORTS;

  const tokens = (assetsJson.result?.items || [])
    .filter(a =>
      (a.interface === "FungibleToken" || a.interface === "FungibleAsset") &&
      a.token_info?.balance > 0
    )
    .map(a => ({
      mint: a.id,
      name: a.content?.metadata?.name || "Unknown",
      symbol: a.content?.metadata?.symbol || short(a.id),
      balance: a.token_info.balance,
      decimals: a.token_info.decimals ?? 0,
      displayBalance: a.token_info.balance / Math.pow(10, a.token_info.decimals ?? 0),
    }))
    .sort((a, b) => b.displayBalance - a.displayBalance);

  return { sol, tokens };
}
```

**Step 2: Verify no syntax errors**

Run: `cd /Users/vfire/wisers/side/solana-wallet-watcher && npx next build 2>&1 | head -30`
Expected: Build succeeds (function is defined but not yet called)

**Step 3: Commit**

```bash
git add docs/reference/solana-wallet-dashboard.jsx
git commit -m "feat: add fetchHoldings function for SOL balance and SPL tokens"
```

---

### Task 2: Add holdings state and wire into handleAnalyze

**Files:**
- Modify: `docs/reference/solana-wallet-dashboard.jsx` (App component state + handleAnalyze)

**Step 1: Add holdings state**

After line 353 (`const [data, setData] = useState(null);`), add:

```js
const [holdings, setHoldings] = useState(null);
const [holdingsError, setHoldingsError] = useState("");
```

**Step 2: Update handleAnalyze to fetch holdings in parallel**

Replace the `handleAnalyze` callback (lines 372-394) with:

```js
const handleAnalyze = useCallback(async () => {
  if (!wallet.trim() || !apiKey.trim()) {
    setError("Enter wallet address + Helius API key");
    return;
  }
  setLoading(true); setError(""); setData(null); setIsDemo(false);
  setHoldings(null); setHoldingsError("");
  try {
    // Fetch transactions and holdings in parallel
    const [txs, holdingsResult] = await Promise.allSettled([
      fetchTxs(wallet.trim(), apiKey.trim(), setProgress),
      fetchHoldings(wallet.trim(), apiKey.trim()),
    ]);

    // Handle holdings result (non-blocking)
    if (holdingsResult.status === "fulfilled") {
      setHoldings(holdingsResult.value);
    } else {
      setHoldingsError("Could not load token holdings");
    }

    // Handle transactions result
    if (txs.status === "rejected") throw txs.reason;
    const txData = txs.value;
    if (!txData.length) {
      setError("No transactions in last 15 days.");
      setLoading(false);
      setProgress("");
      return;
    }
    setData(analyze(wallet.trim(), txData));
    updateUrlParam("wallet", wallet.trim());
  } catch (e) {
    setError(e.message);
  }
  setLoading(false);
  setProgress("");
}, [wallet, apiKey]);
```

**Step 3: Update handleDemo to clear holdings**

In `handleDemo` (line 409), add holdings reset:

```js
const handleDemo = useCallback(() => {
  setData(genDemo()); setIsDemo(true); setError("");
  setWallet("DemoWallet...");
  setHoldings(genDemoHoldings()); setHoldingsError("");
}, []);
```

(We'll add `genDemoHoldings` in Task 4.)

**Step 4: Commit**

```bash
git add docs/reference/solana-wallet-dashboard.jsx
git commit -m "feat: wire holdings fetch into handleAnalyze with parallel loading"
```

---

### Task 3: Add Holdings UI panel

**Files:**
- Modify: `docs/reference/solana-wallet-dashboard.jsx` (dashboard section, after `isDemo` banner)

**Step 1: Add the HoldingsPanel component**

Add before the `SL` component definition (before line 671):

```js
function HoldingsPanel({ holdings, holdingsError }) {
  if (holdingsError) {
    return (
      <>
        <SL icon="◆" label="Current Holdings" color={C.accent} />
        <div style={{ padding: "12px 16px", borderRadius: 10, background: C.redDim, fontSize: 11, color: C.red, marginBottom: 8 }}>
          {holdingsError}
        </div>
      </>
    );
  }
  if (!holdings) return null;

  const fmtBal = (val, decimals) => {
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(2) + "M";
    if (val >= 1_000) return (val / 1_000).toFixed(2) + "K";
    return val < 0.01 && val > 0
      ? val.toFixed(Math.min(decimals, 8))
      : val.toFixed(Math.min(decimals, 4));
  };

  return (
    <>
      <SL icon="◆" label="Current Holdings" color={C.accent} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 14 }}>
        <MS label="SOL Balance" value={`${holdings.sol.toFixed(4)} SOL`} color={C.accent} />
        <MS label="Token Types" value={holdings.tokens.length} color={C.cyan} />
      </div>
      {holdings.tokens.length > 0 && (
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600 }}>
            SPL Token Holdings
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {["Symbol", "Name", "Balance", "Mint"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: C.textDim, fontWeight: 500, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.tokens.map(t => (
                  <tr key={t.mint} style={{ borderBottom: `1px solid ${C.border}` }}
                    onMouseEnter={e => e.currentTarget.style.background = C.surfaceHover}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "8px 12px", fontWeight: 700, color: C.yellow }}>{t.symbol}</td>
                    <td style={{ padding: "8px 12px", color: C.textDim }}>{t.name}</td>
                    <td style={{ padding: "8px 12px", fontWeight: 600, color: C.text }}>{fmtBal(t.displayBalance, t.decimals)}</td>
                    <td style={{ padding: "8px 12px" }}><code style={{ fontSize: 9, background: C.bg, padding: "2px 5px", borderRadius: 4, color: C.textDim }}>{short(t.mint)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
```

**Step 2: Render HoldingsPanel in the dashboard**

In the App return JSX, after the `isDemo` banner (line 517) and before the "1 HOUR" section label (line 519), insert:

```jsx
<HoldingsPanel holdings={holdings} holdingsError={holdingsError} />
```

**Step 3: Commit**

```bash
git add docs/reference/solana-wallet-dashboard.jsx
git commit -m "feat: add HoldingsPanel component with SOL balance and token table"
```

---

### Task 4: Add demo holdings data

**Files:**
- Modify: `docs/reference/solana-wallet-dashboard.jsx` (after `genDemo` function)

**Step 1: Add genDemoHoldings function**

Insert after the `genDemo` function (after line 312):

```js
function genDemoHoldings() {
  return {
    sol: +(Math.random() * 100 + 5).toFixed(4),
    tokens: [
      { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USD Coin", symbol: "USDC", balance: 1500000000, decimals: 6, displayBalance: 1500 },
      { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", name: "Jupiter", symbol: "JUP", balance: 8250000000, decimals: 6, displayBalance: 8250 },
      { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", name: "Bonk", symbol: "BONK", balance: 150000000000, decimals: 5, displayBalance: 1500000 },
      { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", name: "dogwifhat", symbol: "WIF", balance: 345000000000, decimals: 9, displayBalance: 345 },
      { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", name: "Pyth Network", symbol: "PYTH", balance: 12000000000, decimals: 6, displayBalance: 12000 },
    ],
  };
}
```

**Step 2: Verify demo button works**

Run: `cd /Users/vfire/wisers/side/solana-wallet-watcher && npx next build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add docs/reference/solana-wallet-dashboard.jsx
git commit -m "feat: add demo holdings data for demo mode"
```

---

### Task 5: Final build verification

**Step 1: Run build**

Run: `cd /Users/vfire/wisers/side/solana-wallet-watcher && npx next build`
Expected: Build succeeds with no errors

**Step 2: Run dev server and verify manually**

Run: `cd /Users/vfire/wisers/side/solana-wallet-watcher && npx next dev`
Expected: Page loads, clicking "Demo" shows holdings panel at top with SOL balance + 5 token rows
