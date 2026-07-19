export function Docs() {
  return (
    <div className="stack">
      <h1 className="page-title">Docs</h1>

      <div className="panel docs-section">
        <h2 className="docs-h2">Overview</h2>
        <p className="docs-p">
          SCRATCH is an onchain scratch-card game on Robinhood Chain where every card pays out in real tokenized
          stock — SPY, AAPL, NVDA, TSLA, and others. Every card wins something: a guaranteed floor prize lands the
          moment your card is revealed, and about one in three cards also hits an instant multiplier on top. A
          progressive jackpot, always denominated in SPY, grows with each card sold and rolls over until someone
          hits it.
        </p>
        <p className="docs-p">
          The game runs entirely on immutable smart contracts. Nobody — including the team — can change the odds,
          pause payouts, or touch the prize pools once the contracts are deployed.
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">Buying a card</h2>
        <p className="docs-p">
          You don't need a wallet connection or a signature. Send the exact ETH price for your chosen card type
          directly to the contract address — the keeper bot watches the chain, spots your payment, and reveals your
          card on-chain within a few blocks. The Play page shows you exactly what to send and to where, and watches
          for the result once you've entered your address.
        </p>
        <ol className="docs-list">
          <li>Open the Play page and pick a card type (Penny, Classic, or Premium).</li>
          <li>Enter your wallet address so the page knows what to watch for.</li>
          <li>Send exactly the listed ETH amount to the contract address shown.</li>
          <li>Wait a few blocks — the keeper reveals your card automatically.</li>
          <li>Scratch to see your prize. Stock lands in your wallet immediately.</li>
        </ol>
        <p className="docs-p">
          To buy multiple cards in one transaction, use the quantity stepper on the Play page (up to 5). For
          count &gt; 1 the page shows the calldata for <code className="docs-code">buyBatch(cardType, count)</code> —
          paste it as the transaction data in your wallet alongside the total ETH.
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">Card types</h2>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Price (ETH)</th>
                <th>Floor prize</th>
                <th>Jackpot entries</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Penny</td>
                <td>0.001 ETH</td>
                <td>~$0.40 in stock</td>
                <td>None</td>
              </tr>
              <tr>
                <td>Classic</td>
                <td>0.005 ETH</td>
                <td>~$2.00 in stock</td>
                <td>1</td>
              </tr>
              <tr>
                <td>Premium</td>
                <td>0.01 ETH</td>
                <td>~$4.00 in stock</td>
                <td>2</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="docs-p docs-note">
          USD equivalents are approximate and depend on the ETH/USD rate at scratch time. The floor prize is always
          exactly 40% of the card's ETH price, converted to stock at the live pool price.
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">Prize structure</h2>
        <p className="docs-p">Every card's price splits four ways at the moment of purchase:</p>
        <ul className="docs-list">
          <li><strong>40% floor prize</strong> — paid to you immediately as stock. Every card wins this.</li>
          <li><strong>40% instant pool</strong> — funds the tiered instant prizes drawn at scratch time.</li>
          <li><strong>10% jackpot</strong> — added to the progressive jackpot pot (always denominated in SPY).</li>
          <li><strong>10% ops</strong> — keeps the game running.</li>
        </ul>
        <p className="docs-p">
          At scratch time a random tier is drawn. If you hit an instant prize, you receive a multiple of your card
          price paid from the instant pool: 1× / 2× / 3× / 4× / 5× / 10×. The pool can never be drained — no
          single payout exceeds the pool's actual balance. Classic odds: ~14% chance of any instant prize,
          ~0.01% chance of a jackpot entry per ticket.
        </p>
        <p className="docs-p">
          The jackpot pays 70% of its pot to the winner and keeps 30% rolling over to seed the next round.
          It is always settled in SPY regardless of which stock your card pulled.
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">The mystery pull</h2>
        <p className="docs-p">
          Which stock your card pays out in isn't known until scratch time — not by you, not by us. At the moment
          the keeper reveals your card, the same random value that resolves your prize tier also draws a stock from
          that season's deck. The deck is weighted: SPY is the most common pull (70%), with AAPL and MSFT next,
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">Randomness</h2>
        <p className="docs-p">
          Outcomes use future-blockhash randomness via <code className="docs-code">Randomness.sol</code>. When you
          buy a card, a reveal is scheduled 3 blocks ahead. The keeper calls{" "}
          <code className="docs-code">fulfill()</code> once that block is past — anyone can call it, not just us.
          The revealed blockhash seeds both the prize tier and the stock pull in one operation.
        </p>
        <p className="docs-p">
          This trusts the chain's block producer to not manipulate blockhashes — acceptable at small jackpot sizes.
          The contract upgrades to Chainlink VRF before the jackpot exceeds ~$5k.
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">$SCRATCH token</h2>
        <p className="docs-p">
          $SCRATCH is a Flap-native TOKEN_TAXED_V3 token on Robinhood Chain. Every buy and sell carries a 3%
          trading tax split three ways:
        </p>
        <ul className="docs-list">
          <li><strong>80%</strong> — routed into ScratchCore's prize pools (50/50 instant and jackpot)</li>
          <li><strong>10%</strong> — ops</li>
          <li><strong>10%</strong> — automatic buyback-and-burn via Flap's native deflation</li>
        </ul>
        <p className="docs-p">
          Holders receive no dividend. The tax funds the game and shrinks supply. Card-sale rake separately buys
          $SCRATCH via RakeRouter, creating independent buy pressure on every card sold.
        </p>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">Smart contracts</h2>
        <p className="docs-p">
          All contracts are immutable. No admin can change odds, pause payouts, or sweep pools while the game is
          active. The only owner privilege is adjusting the daily card cap and a dead-game withdrawal that only
          unlocks after 36 hours of zero purchases.
        </p>
        <p className="docs-p">Contract addresses (Robinhood Chain, chain ID 4663) — updated post-deploy:</p>
        <div className="docs-addresses">
          <div className="docs-address-row"><span>ScratchCore</span><code className="docs-code docs-addr">deploy pending</code></div>
          <div className="docs-address-row"><span>UniswapV4PrizeConverter</span><code className="docs-code docs-addr">deploy pending</code></div>
          <div className="docs-address-row"><span>Randomness</span><code className="docs-code docs-addr">deploy pending</code></div>
          <div className="docs-address-row"><span>TokenTaxRouter</span><code className="docs-code docs-addr">deploy pending</code></div>
          <div className="docs-address-row"><span>RakeRouter</span><code className="docs-code docs-addr">deploy pending</code></div>
        </div>
      </div>

      <div className="panel docs-section">
        <h2 className="docs-h2">FAQ</h2>
        <div className="docs-faq">
          <div className="docs-faq-item">
            <div className="docs-faq-q">Do I need MetaMask or a wallet connection?</div>
            <div className="docs-faq-a">No. Send ETH directly from any wallet — no connect prompt, no signature.</div>
          </div>
          <div className="docs-faq-item">
            <div className="docs-faq-q">Can I lose my whole stake?</div>
            <div className="docs-faq-a">No. The floor prize (40% of your card price, in stock) is guaranteed on every card.</div>
          </div>
          <div className="docs-faq-item">
            <div className="docs-faq-q">Who controls the odds?</div>
            <div className="docs-faq-a">Nobody. Odds and prize splits are constants in the bytecode — unchangeable after deploy.</div>
          </div>
          <div className="docs-faq-item">
            <div className="docs-faq-q">What chain is this on?</div>
            <div className="docs-faq-a">Robinhood Chain (chain ID 4663) — the only chain where stocks like SPY and AAPL exist as composable ERC-20s.</div>
          </div>
          <div className="docs-faq-item">
            <div className="docs-faq-q">Where does the stock come from?</div>
            <div className="docs-faq-a">Prize payouts swap ETH into stock tokens live via a Uniswap v4 pool at reveal time. No inventory is held.</div>
          </div>
        </div>
      </div>
    </div>
  );
}