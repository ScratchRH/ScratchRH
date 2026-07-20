import { Route, Routes, useLocation } from "react-router-dom";
import { AmbientGlow } from "./components/AmbientGlow";
import { NavBar } from "./components/NavBar";
import { TwitterTracker } from "./components/TwitterTracker";
import { Splash } from "./pages/Splash";
import { Landing } from "./pages/Landing";
import { Home } from "./pages/Home";
import { Play } from "./pages/Play";
import { Leaderboard } from "./pages/Leaderboard";
import { Portfolio } from "./pages/Portfolio";
import { HowItWorks } from "./pages/HowItWorks";
import { Docs } from "./pages/Docs";
import { Flywheel } from "./pages/Flywheel";
import { Odds } from "./pages/Odds";

function App() {
  // The splash screen at "/" is a full-viewport gate with its own PLAY
  // button — it replaces the normal nav chrome rather than sitting inside it.
  const isSplash = useLocation().pathname === "/";

  return (
    <div className="app-shell">
      <AmbientGlow />
      {!isSplash && <NavBar />}
      {!isSplash && <TwitterTracker />}
      <main>
        <div className={isSplash ? undefined : "container"}>
          <Routes>
            <Route path="/" element={<Splash />} />
            <Route path="/home" element={<Landing />} />
            <Route path="/scoreboard" element={<Home />} />
            <Route path="/play" element={<Play />} />
            <Route path="/odds" element={<Odds />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/flywheel" element={<Flywheel />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default App;
