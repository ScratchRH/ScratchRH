interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}

export function StatTile({ label, value, sub, accent }: StatTileProps) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${accent ? " accent" : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
