import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "scratch:twitterTrackerMinimized";
const X_HANDLE = "Scratch_RH";

declare global {
  interface Window {
    twttr?: { widgets?: { load: (el?: HTMLElement) => void } };
  }
}

function loadWidgetsScript(): void {
  if (document.getElementById("twitter-wjs")) {
    window.twttr?.widgets?.load();
    return;
  }
  const script = document.createElement("script");
  script.id = "twitter-wjs";
  script.src = "https://platform.twitter.com/widgets.js";
  script.async = true;
  document.body.appendChild(script);
}

function readMinimized(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeMinimized(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.) - just skip persisting.
  }
}

/// Small floating widget showing the latest tweet from @Scratch_RH via X's
/// own official embed (platform.twitter.com/widgets.js) — no API keys, no
/// backend, X keeps it live-updating on its own. Only actually loads the
/// embed script once expanded, not on every page load, since it's a
/// nice-to-have, not anything on the critical path.
export function TwitterTracker() {
  const [minimized, setMinimized] = useState(() => readMinimized());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (minimized) return;
    loadWidgetsScript();
    // widgets.js scans the DOM for un-rendered <a class="twitter-timeline">
    // tags on load, but a tag that appears later (e.g. re-expanding) needs
    // an explicit re-scan — harmless no-op if the script hasn't loaded yet.
    const timer = window.setTimeout(() => window.twttr?.widgets?.load(containerRef.current ?? undefined), 50);
    return () => window.clearTimeout(timer);
  }, [minimized]);

  function toggle() {
    setMinimized((prev) => {
      storeMinimized(!prev);
      return !prev;
    });
  }

  return (
    <div className={`twitter-tracker${minimized ? " minimized" : ""}`}>
      <button type="button" className="twitter-tracker-header" onClick={toggle}>
        <span>Latest from @{X_HANDLE}</span>
        <span className="twitter-tracker-toggle">{minimized ? "+" : "−"}</span>
      </button>
      {!minimized && (
        <div className="twitter-tracker-body" ref={containerRef}>
          <a
            className="twitter-timeline"
            data-theme="dark"
            data-tweet-limit="1"
            data-chrome="noheader nofooter noborders transparent"
            href={`https://twitter.com/${X_HANDLE}?ref_src=twsrc%5Etfw`}
          >
            Tweets by {X_HANDLE}
          </a>
        </div>
      )}
    </div>
  );
}
