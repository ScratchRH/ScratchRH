interface Note {
  title: string;
  body: string;
}

const NOTES: Note[] = [
  {
    title: "Where every dollar goes",
    body: "A $5 Classic card splits $2.00 to your floor prize (paid immediately as stock), $2.00 into the instant prize pool, $0.50 into the progressive jackpot, and $0.50 to keep the lights on. This split is locked into the contract before launch — nobody can change it later.",
  },
  {
    title: "The stock is a mystery until you scratch",
    body: "You don't pick which stock a card pays out in — it's pulled from that season's deck the moment you scratch, alongside your prize tier. Most pulls land on steady names like SPY, but there's always a shot at a rarer chase stock. Nobody, not even us, can see or influence the pull ahead of time.",
  },
  {
    title: "Nobody holds the keys",
    body: "There's no admin switch on any money path. Nobody, including us, can pause the game, sweep the pools, or change the odds once it's live.",
  },
  {
    title: "How shuffles are randomized",
    body: "Each card's outcome comes from a blockhash a few blocks after you buy it. We're upfront that this leans on trusting the chain's block producer rather than a dedicated randomness oracle, and we plan to upgrade to one as the jackpot grows past a few thousand dollars.",
  },
  {
    title: "The jackpot is always real S&P 500",
    body: "Unlike your card's mystery pull, the jackpot pot itself always lives in SPY — it's real S&P 500 exposure that grows even on days nobody's playing. When someone hits it, 70% pays out and 30% stays in the pot to kick off the next round. The number only climbs.",
  },
  {
    title: "The prize pool can't go broke",
    body: "Instant prizes are paid as a share of the pool's balance at the moment you scratch, not a fixed dollar amount, and no single prize can take more than 40% of it. The pool can't run dry and can't spiral.",
  },
  {
    title: "Buying never needs a wallet connection",
    body: "Every page here is a friendly window into what's already on-chain, and buying a card is as simple as sending payment to the game's address — a helper bot watches for it and hands you your ticket, without ever holding your funds or asking you to connect anything.",
  },
];

export function HowItWorks() {
  return (
    <div className="stack">
      <h1 className="page-title">How It Works</h1>
      <div className="panel">
        {NOTES.map((note, i) => (
          <div className="info-note" key={note.title}>
            <div className="info-note-number">{String(i + 1).padStart(2, "0")}</div>
            <div className="info-note-body">
              <h3>{note.title}</h3>
              <p>{note.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
