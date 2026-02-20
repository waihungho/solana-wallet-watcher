# Vercel Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap the existing Solana wallet dashboard reference component in a minimal Next.js 15 App Router shell and deploy to Vercel.

**Architecture:** Single-page Next.js app with one client component. The 938-line reference component at `docs/reference/solana-wallet-dashboard.jsx` is copied to `components/SolanaWalletDashboard.jsx` with minimal adaptations (`"use client"` directive added). Thin `app/layout.tsx` and `app/page.tsx` files wrap it.

**Tech Stack:** Next.js 15, React 19, Recharts 2, Vercel

---

### Task 1: Initialize Next.js project

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "solana-wallet-watcher",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "recharts": "^2"
  }
}
```

**Step 2: Create next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
.next/
out/
.env*.local
```

**Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

**Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json .gitignore
git commit -m "feat: initialize Next.js 15 project with recharts"
```

---

### Task 2: Create the app shell (layout + globals)

**Files:**
- Create: `app/layout.tsx`
- Create: `app/globals.css`

**Step 1: Create app/globals.css**

Minimal reset + dark background to match the component's theme:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  background: #0a0a0f;
  color: #e8e8f0;
  min-height: 100vh;
}
```

**Step 2: Create app/layout.tsx**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Wallet Analytics — Transaction Flow Dashboard",
  description:
    "Analyze Solana wallet transactions: 1-hour, 24-hour, and 15-day flow analytics with counterparty tracking and recurrence patterns.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

**Step 3: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: add Next.js app shell with dark theme layout"
```

---

### Task 3: Adapt the dashboard component

**Files:**
- Create: `components/SolanaWalletDashboard.jsx` (copied from `docs/reference/solana-wallet-dashboard.jsx`)

**Step 1: Copy the reference component**

```bash
mkdir -p components
cp docs/reference/solana-wallet-dashboard.jsx components/SolanaWalletDashboard.jsx
```

**Step 2: Add `"use client"` directive**

Add this as the very first line of `components/SolanaWalletDashboard.jsx`:

```javascript
"use client";
```

This is required because the component uses:
- `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`
- `window.location`, `localStorage`, `navigator.clipboard`
- Browser-only APIs

No other changes needed. The existing imports (React hooks, Recharts) and default export are already correct.

**Step 3: Verify the file starts with:**

```javascript
"use client";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Area, AreaChart, Cell
} from "recharts";
// ... rest unchanged
```

**Step 4: Commit**

```bash
git add components/SolanaWalletDashboard.jsx
git commit -m "feat: adapt dashboard component with use client directive"
```

---

### Task 4: Create the page that renders the dashboard

**Files:**
- Create: `app/page.tsx`

**Step 1: Create app/page.tsx**

```tsx
import SolanaWalletDashboard from "@/components/SolanaWalletDashboard";

export default function Home() {
  return <SolanaWalletDashboard />;
}
```

**Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add root page rendering dashboard component"
```

---

### Task 5: Verify the build works locally

**Step 1: Run the dev server**

Run: `npm run dev`
Expected: Next.js starts on http://localhost:3000, no compilation errors

**Step 2: Run the production build**

Run: `npm run build`
Expected: Build succeeds with output like:
```
Route (app)                              Size
┌ ○ /                                    xxx kB
└ ...
✓ Generating static pages
```

The page should be rendered as a client-side component (marked with `ƒ` or similar indicator).

**Step 3: Commit any auto-generated files**

Next.js may generate `next-env.d.ts`. If so:

```bash
git add next-env.d.ts
git commit -m "chore: add next-env.d.ts"
```

---

### Task 6: Deploy to Vercel

**Step 1: Ensure Vercel CLI is available**

Run: `vercel --version`
If not installed: `npm i -g vercel`

**Step 2: Deploy**

Run: `vercel --yes`
Expected: Vercel detects Next.js, builds, and deploys. Outputs a `.vercel.app` URL.

**Step 3: Verify the deployment**

Open the URL in a browser. Verify:
- Dashboard loads with the dark theme
- "Demo" button works and shows charts
- Can enter a wallet address and API key
- Charts render correctly

**Step 4: Commit Vercel project link (if created)**

Vercel may create a `.vercel/` directory with project config. Add it to `.gitignore`:

```bash
echo ".vercel/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore .vercel directory"
```
