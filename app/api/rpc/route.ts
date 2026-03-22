// Server-side proxy for official Solana RPC.
// The public api.mainnet-beta.solana.com blocks browser fetch (403),
// but server-to-server calls work fine.
// Falls back to Helius if the official RPC returns an error.

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const HELIUS_RPC = "https://mainnet.helius-rpc.com";

export async function POST(req: Request) {
  const body = await req.text();
  const apiKey = new URL(req.url).searchParams.get("api-key");

  const headers = { "Content-Type": "application/json" };

  // Try official Solana RPC first (server-side, no CORS restriction)
  try {
    const res = await fetch(SOLANA_RPC, { method: "POST", headers, body });
    if (res.ok) {
      const json = await res.json();
      if (!json.error) {
        return Response.json(json);
      }
    }
  } catch {}

  // Fall back to Helius
  if (!apiKey) {
    return Response.json({ error: { code: 400, message: "api-key required for fallback" } }, { status: 400 });
  }
  const res = await fetch(`${HELIUS_RPC}/?api-key=${apiKey}`, { method: "POST", headers, body });
  const json = await res.json();
  return Response.json(json, { status: res.ok ? 200 : res.status });
}
