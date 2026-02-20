# Current Token Holdings — Design

## Overview

Add a "Current Holdings" panel to the Solana wallet analytics dashboard that displays the wallet's current SOL balance and all SPL token holdings. Appears as a standalone panel at the top of the dashboard, above the time-window panels.

## Data Source

**Approach: Helius DAS `getAssetsByOwner` + `getBalance` RPC**

Two API calls made concurrently with the existing `fetchTxs` call:

1. **SOL balance** — Standard RPC `getBalance` to `https://mainnet.helius-rpc.com/?api-key={KEY}`. Returns lamports (divide by 1e9 for SOL).
2. **SPL tokens** — DAS `getAssetsByOwner` with `displayOptions: { showFungible: true }`. Filter to `interface === "FungibleToken"` or `"FungibleAsset"`. Each item provides:
   - `content.metadata.name` — token name
   - `content.metadata.symbol` — token symbol
   - `token_info.balance` — raw balance
   - `token_info.decimals` — decimal places
   - `id` — mint address

## Data Shape

```js
{
  sol: number,           // SOL balance
  tokens: [{
    mint: string,        // mint address
    name: string,        // e.g. "USD Coin"
    symbol: string,      // e.g. "USDC"
    balance: number,     // raw balance
    decimals: number,    // decimal places
    displayBalance: number // balance / 10^decimals
  }]
}
```

- Tokens with zero balance are filtered out
- Sorted by `displayBalance` descending

## State Management

New state variable `holdings` stored alongside existing `data`. Set to `null` when no data loaded, populated after fetch completes.

## UI Layout

- **Position:** Between header and "Last 1 Hour" panel
- **Section label:** "Current Holdings" using existing `SL` component
- **Metric cards:** SOL balance (green accent) + token count (cyan) using existing `MS` component
- **Token table:** Scrollable table with columns: Symbol, Name, Balance, Mint (abbreviated)
- **Styling:** Matches existing dark theme, monospace font, color scheme

## Demo Mode

`genDemo()` produces fake holdings: SOL balance + ~5 tokens (USDC, JUP, BONK, WIF, PYTH) with random balances.

## Error Handling

Holdings fetch failure does not block transaction data display. Panel shows a subtle inline error message if the holdings API call fails.

## Fetching Strategy

Holdings fetch runs **in parallel** with `fetchTxs` inside `handleAnalyze`, adding no extra latency to the existing flow.
