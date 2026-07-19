import { runForever } from "./revealWatcher.js";

runForever().catch((err) => {
  console.error("[keeper] fatal error:", err);
  process.exit(1);
});
