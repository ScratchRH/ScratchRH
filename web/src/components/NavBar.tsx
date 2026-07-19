import { Link, NavLink } from "react-router-dom";
import { LogoMark } from "./LogoMark";
import { XIcon } from "./XIcon";

const LINKS = [
  { to: "/scoreboard", label: "Scoreboard" },
  { to: "/odds", label: "Odds" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/play", label: "Play" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/how-it-works", label: "How It Works" },
  { to: "/flywheel", label: "Flywheel" },
];

export function NavBar() {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/home" className="logo">
          <LogoMark />
          SCRATCH
        </Link>
        <nav className="nav-links">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <a
          href="https://x.com/Scratch_RH"
          target="_blank"
          rel="noopener noreferrer"
          className="social-link"
          aria-label="Follow on X"
        >
          <XIcon />
        </a>
      </div>
    </header>
  );
}
