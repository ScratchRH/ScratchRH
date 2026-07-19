// Randomized once per page load so the glow spots don't feel mechanically
// synced to each other — each orb drifts through the background lines on
// its own timer.
const ORBS = Array.from({ length: 6 }, () => ({
  x: Math.random() * 100,
  y: Math.random() * 100,
  duration: 6 + Math.random() * 7,
  delay: Math.random() * 8,
}));

export function AmbientGlow() {
  return (
    <div className="ambient-glow" aria-hidden="true">
      {ORBS.map((orb, i) => (
        <span
          key={i}
          className="glow-orb"
          style={{
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            animationDuration: `${orb.duration}s`,
            animationDelay: `${orb.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
