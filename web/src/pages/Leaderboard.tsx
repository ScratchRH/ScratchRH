import { formatEther } from "viem";
import { LEADERBOARD } from "../lib/mockData";
import { formatUsd, truncateAddress } from "../lib/format";
import { KEEPER_API_URL } from "../lib/chain";
import { useScoreboardApi } from "../hooks/useScoreboardApi";
import { useLeaderboard } from "../hooks/useLeaderboard";

const REAL_MODE = Boolean(KEEPER_API_URL);

export function Leaderboard() {
  const scoreboard = useScoreboardApi(); // only used here for ethUsdPrice
  const realRows = useLeaderboard();

  const stillLoading = REAL_MODE && realRows === undefined;
  const ethUsdPrice = scoreboard?.ethUsdPrice;

  const rows = REAL_MODE
    ? (realRows ?? []).map((row, i) => ({
        rank: i + 1,
        player: truncateAddress(row.player),
        cardsScratched: row.cardsScratched,
        totalWonUsd: ethUsdPrice === undefined ? undefined : Number(formatEther(row.totalWonWei)) * ethUsdPrice,
      }))
    : LEADERBOARD.map((entry) => ({ ...entry, totalWonUsd: entry.totalWonUsd as number | undefined }));

  return (
    <div className="stack">
      <h1 className="page-title">Leaderboard</h1>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Cards Scratched</th>
              <th>Total Won</th>
            </tr>
          </thead>
          <tbody>
            {stillLoading ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  {REAL_MODE ? "No cards scratched yet." : "No players yet."}
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={entry.player}>
                  <td className={entry.rank === 1 ? "rank-1" : undefined}>#{entry.rank}</td>
                  <td>{entry.player}</td>
                  <td>{entry.cardsScratched}</td>
                  <td>{entry.totalWonUsd === undefined ? "…" : formatUsd(entry.totalWonUsd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
