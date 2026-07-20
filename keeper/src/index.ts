import { runForever } from "./revealWatcher.js";
import { runDashboardCacheLoop } from "./dashboardCache.js";
import { startServer } from "./server.js";

startServer();

runDashboardCacheLoop().catch((err) => {
  console.error("[dashboard-cache] fatal error:", err);
});

runForever().catch((err) => {
  console.error("[keeper] fatal error:", err);
  process.exit(1);
});
