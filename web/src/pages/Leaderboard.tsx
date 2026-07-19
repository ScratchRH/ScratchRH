import { LEADERBOARD } from "../lib/mockData";
import { formatUsd } from "../lib/format";

export function Leaderboard() {
  return (
    <div className="stack">
      <h1 className="page-title">Streak Leaderboard</h1>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Streak</th>
              <th>Cards Scratched</th>
              <th>Total Won</th>
            </tr>
          </thead>
          <tbody>
            {LEADERBOARD.map((entry) => (
              <tr key={entry.player}>
                <td className={entry.rank === 1 ? "rank-1" : undefined}>#{entry.rank}</td>
                <td>{entry.player}</td>
                <td>{entry.streak} days</td>
                <td>{entry.cardsScratched}</td>
                <td>{formatUsd(entry.totalWonUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
