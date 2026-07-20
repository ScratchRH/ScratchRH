import { createServer } from "node:http";
import { config } from "./config.js";
import { getLeaderboardSnapshot, getScoreboardSnapshot } from "./dashboardCache.js";
import { getPortfolio } from "./portfolio.js";
import { ClaimError, claimDailyFree, getClaimStatus } from "./dailyClaim.js";

// Plain Node http server, no framework. Most of this is read-only GET
// endpoints serving already-public on-chain data — same as anyone could
// read themselves via an RPC call or a block explorer, no auth needed.
// The one exception is POST /api/daily-claim, which does send real ETH
// from the keeper's wallet (see dailyClaim.ts) — eligibility and the
// once-per-UTC-day limit are both re-verified server-side there, never
// trusted from the request.
const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN ?? "*";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export function startServer(): void {
  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ALLOW_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/scoreboard") {
      sendJson(res, 200, getScoreboardSnapshot());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/leaderboard") {
      sendJson(res, 200, getLeaderboardSnapshot());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/portfolio") {
      const address = url.searchParams.get("address") ?? "";
      if (!ADDRESS_RE.test(address)) {
        sendJson(res, 400, { error: "invalid or missing ?address=" });
        return;
      }
      getPortfolio(address as `0x${string}`)
        .then((snapshot) => sendJson(res, 200, snapshot))
        .catch((err) => {
          console.error("[server] /api/portfolio failed:", err);
          sendJson(res, 502, { error: "upstream RPC error" });
        });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/daily-claim/status") {
      const address = url.searchParams.get("address") ?? "";
      if (!ADDRESS_RE.test(address)) {
        sendJson(res, 400, { error: "invalid or missing ?address=" });
        return;
      }
      getClaimStatus(address as `0x${string}`)
        .then((status) => sendJson(res, 200, status))
        .catch((err) => {
          console.error("[server] /api/daily-claim/status failed:", err);
          sendJson(res, 502, { error: "upstream RPC error" });
        });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/daily-claim") {
      readJsonBody(req)
        .then((body) => {
          const address = (body as { address?: string }).address ?? "";
          if (!ADDRESS_RE.test(address)) {
            sendJson(res, 400, { error: "invalid or missing address" });
            return;
          }
          return claimDailyFree(address as `0x${string}`).then((result) => sendJson(res, 200, result));
        })
        .catch((err) => {
          if (err instanceof ClaimError) {
            sendJson(res, 400, { error: err.message });
            return;
          }
          console.error("[server] /api/daily-claim failed:", err);
          sendJson(res, 502, { error: "claim failed — try again" });
        });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  server.listen(config.port, () => {
    console.log(`[server] listening on :${config.port}`);
  });
}
