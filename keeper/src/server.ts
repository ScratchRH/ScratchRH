import { createServer } from "node:http";
import { config } from "./config.js";
import { getLeaderboardSnapshot, getScoreboardSnapshot } from "./dashboardCache.js";
import { getPortfolio } from "./portfolio.js";

// Plain Node http server, no framework — read-only GET endpoints serving
// the dashboard cache as JSON. Public and unauthenticated deliberately:
// everything served here is already public on-chain data, same as anyone
// could read themselves via an RPC call or a block explorer. This never
// touches KEEPER_PRIVATE_KEY or anything that could move funds — it's a
// read-only cache, not an admin surface.
const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN ?? "*";
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

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
        "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    sendJson(res, 404, { error: "not found" });
  });

  server.listen(config.port, () => {
    console.log(`[server] listening on :${config.port}`);
  });
}
