# Vercel Deployment Design — Solana Wallet Dashboard Watcher

**Date:** 2026-02-20
**Status:** Approved

## Goal

Deploy the existing Solana wallet transaction analytics dashboard to Vercel as a Next.js app. Minimal scaffolding — wrap the reference component in a thin Next.js shell and deploy.

## Decisions

- **Framework:** Next.js 15 with App Router
- **Approach:** Minimal shell — keep the 938-line reference component mostly intact
- **API key handling:** Client-side only. Users enter their own Helius API key in the UI. No server-side proxy.
- **Pages:** Single page at root URL. No additional pages.
- **Domain:** Default `.vercel.app` subdomain
- **TypeScript:** Only for the thin Next.js shell files (`layout.tsx`, `page.tsx`). The dashboard component stays as JSX to avoid introducing type errors.

## Architecture

```
solana-wallet-watcher/
├── app/
│   ├── layout.tsx              # Root layout (html, body, metadata, dark bg)
│   ├── page.tsx                # Thin wrapper — imports and renders dashboard
│   └── globals.css             # Minimal global styles (dark theme base)
├── components/
│   └── SolanaWalletDashboard.jsx  # Adapted from docs/reference/ (938 lines)
├── public/                     # Favicon
├── docs/                       # Existing reference files (untouched)
├── package.json                # next, react, react-dom, recharts
├── next.config.ts
├── tsconfig.json
└── .gitignore
```

### Component Adaptation

The reference component at `docs/reference/solana-wallet-dashboard.jsx` needs minimal changes:

1. Add `"use client"` directive at top (uses useState, useEffect, localStorage)
2. Add proper React/Recharts imports (reference assumes they're available)
3. Export the `App` component as default
4. No logic changes — preserve all 938 lines of functionality as-is

### Data Flow

```
User enters wallet address + Helius API key in UI
  → Component fetches from Helius API directly (client-side fetch)
  → Data processed in-browser (analyze/compWin functions)
  → Rendered via Recharts charts + custom dark-mode UI
  → Wallet/key persisted in localStorage + URL params
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `next` | Framework, routing, build |
| `react` | UI rendering |
| `react-dom` | DOM rendering |
| `recharts` | Charts (Bar, Area, responsive containers) |

No other dependencies needed.

### Error Handling

Unchanged from the reference component:
- API errors displayed as user-facing error messages
- Loading states with spinner
- Demo mode fallback when no wallet address is provided

### Deployment

1. Push to GitHub
2. Connect repo to Vercel (auto-detects Next.js)
3. No environment variables needed
4. Auto-deploys on push to main
5. Available at `<project-name>.vercel.app`

## What We're NOT Doing

- No server-side API proxy
- No TypeScript conversion of the dashboard component
- No component refactoring/splitting
- No custom domain setup
- No authentication or rate limiting
- No database or persistent storage
