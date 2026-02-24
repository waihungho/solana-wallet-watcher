# Multi-Wallet Support Design

## Summary

Allow users to input up to 3 wallet addresses and analyze them simultaneously. Results are displayed in a tabbed interface, one wallet per tab. URL query parameters support sharing multi-wallet views.

## Decisions

- **Display:** Tabbed per wallet (full-width dashboard per tab)
- **Input UI:** Always show 3 input fields (wallet 2 & 3 optional)
- **URL format:** Separate params (`?wallet1=ABC&wallet2=DEF&wallet3=GHI`)
- **State model:** Array-based (3-slot arrays for wallets, results, holdings, errors)
- **Backward compatible:** Existing `?wallet=ABC` links treated as `wallet1`

## State Model

Replace single-value state with 3-slot arrays:

```
wallets: [string, string, string]          // input values, empty = unused
results: [object|null, object|null, object|null]  // analyzed tx data per slot
holdings: [object|null, ...]               // holdings per slot
errors: [string, string, string]           // per-wallet errors
activeTab: number (0|1|2)                  // which wallet dashboard to show
loading: bool                              // single global loading flag
progress: string                           // single progress message
```

Shared state unchanged: `apiKey`, `isDemo`, `tab` (flow/net/freq), `showKey`, `copied`.

## Header UI

3 wallet inputs always visible, stacked:

```
Wallet 1: [Solana wallet address...              ]
Wallet 2: [Wallet address (optional)...          ]
Wallet 3: [Wallet address (optional)...          ]
           [Analyze]  [Demo]  [Share Link]
```

- Each input has a dim label prefix
- "Analyze" requires at least wallet 1; fetches all non-empty wallets in parallel
- Enter key on any input triggers analyze

## Wallet Tab Bar

Appears between header and dashboard content when 2+ wallets have results:

```
[Wallet 1: 7xKX...AsU] [Wallet 2: 3Kat...p8X] [Wallet 3: 9WzD...WWM]
```

- Shows `short(address)` per tab
- Active tab highlighted with accent color
- Hidden when only 1 wallet analyzed (identical to current behavior)
- Switching tabs swaps which slot feeds the dashboard components

## Data Fetching

`handleAnalyze` flow:
1. Collect non-empty wallet strings from `wallets[]`
2. For each wallet, run `fetchTxs()` + `fetchHoldings()` in parallel
3. All wallets fetched concurrently via `Promise.allSettled`
4. Per-wallet errors stored in `errors[i]`, don't block other wallets
5. Progress message shows multi-wallet status
6. After fetch, `activeTab` auto-selects first wallet with results

## URL Params & localStorage

**URL:** `?wallet1=ABC&wallet2=DEF&wallet3=GHI&key=...`
- Backward compatible: `?wallet=ABC` maps to `wallet1`
- Only non-empty wallets written to URL
- Share link includes all wallet addresses, no API key

**localStorage:** `sol-dash-wallet1`, `sol-dash-wallet2`, `sol-dash-wallet3` (replaces `sol-dash-wallet`), `sol-dash-apikey` unchanged.

**Auto-run:** If `wallet1` in URL and API key available, auto-analyze on load.

## Demo Mode

Generates 3 independent demo datasets:
- Wallet 1: `"DemoWallet1..."` with `genDemo()` + `genDemoHoldings()`
- Wallet 2: `"DemoWallet2..."` with separate `genDemo()` + `genDemoHoldings()`
- Wallet 3: `"DemoWallet3..."` with separate `genDemo()` + `genDemoHoldings()`

All 3 populated so tab switching is demo-able.

## Derived Data

Existing `useMemo` hooks (h1, h6, h24, d3Trend, netFlow, topByDays) derive from `results[activeTab]` instead of single `data`. They recompute when `activeTab` changes.
