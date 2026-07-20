// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ScratchCore} from "../src/ScratchCore.sol";
import {Randomness} from "../src/Randomness.sol";
import {PrizeConverter} from "../src/PrizeConverter.sol";
import {TokenTaxRouter} from "../src/TokenTaxRouter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";

/// Deploys a fresh PrizeConverter -> Randomness -> ScratchCore ->
/// TokenTaxRouter. Unlike the old UniswapV4PrizeConverter (which was reused
/// across deploys since convert() has no caller restriction), this deploy
/// always creates a new PrizeConverter — the old one's routes were never
/// populated for the current six-token deck, so there's no live state worth
/// preserving.
/// Randomness needs ScratchCore's address up front (immutable consumer), so
/// it's predicted from the deployer's next nonce before ScratchCore exists —
/// same trick test/ScratchCore.t.sol uses, with the same post-deploy
/// assertion so this reverts loudly instead of silently deploying against a
/// mismatched address if the nonce math drifts. TokenTaxRouter goes last
/// since it just needs ScratchCore's (by-then-real) address — its own
/// address is what LaunchScratchToken.s.sol's beneficiary needs filling in
/// with, once this script has run.
///
/// Addresses below are Robinhood Chain mainnet (chain id 4663). The six
/// stock token addresses were verified 2026-07-19 against live deployed
/// bytecode. WETH, USDG, the WETH/USDG V3 pool, and the real V4 PoolManager
/// were verified 2026-07-20 three independent ways: symbol() calls
/// returning the expected ticker for every token, the V3 pool's own
/// fee()/tickSpacing()/token0()/token1() matching what's used below, and —
/// for the V4 PoolManager specifically — computing the exact PoolId hash
/// Uniswap V4 derives from (currency0, currency1, fee, tickSpacing, hooks)
/// and confirming it matches the indexed `id` topic on a real Swap event
/// this address emitted for a live MSFT trade (tx
/// 0xe70ab68d4abc6ac0b654392dc8419673b6e53c5917c2933241a3a98fb125dcf3). Not
/// pulled from documentation — re-verify before mainnet use if time has
/// passed.
///
/// Every one of the six stock tokens routes the same way on this chain:
/// WETH -> USDG on the one WETH/USDG Uniswap V3 pool, then USDG -> stock on
/// a per-stock Uniswap V4 pool (no hooks). This was initially assumed to be
/// three different shapes per token (a direct Algebra WETH pool for SPY/
/// PLTR, a V3-then-V4 path for NVDA/MSFT, a V4-then-V4 path for AAPL) based
/// on decoding individual live swap transactions through GMGN's router —
/// that assumption undersold the real picture: those transactions just
/// happened to route through whatever pool GMGN's aggregator picked at that
/// moment, not necessarily the deepest one. A pool census (2026-07-20,
/// cross-checked against live on-chain liquidity for every pool below)
/// showed a single deeper USDG-denominated V4 pool exists for every stock,
/// including SPY and PLTR — e.g. MSFT's USDG pool at fee=20000 carries
/// ~4.6x the liquidity of the fee=3000 pool the sampled GMGN trade actually
/// used. PrizeConverter's Hop-list design already supports this shape
/// without any contract change (it's exactly the "V3-then-V4" case
/// test/PrizeConverter.t.sol already covers) — Algebra support stays in the
/// contract for future flexibility, just unused by every route configured
/// here.
///
/// This script deploys PrizeConverter but does NOT call setRoute() for any
/// token — setRoute is owner-only, and this script broadcasts as whichever
/// key runs `forge script`, not necessarily the OWNER key. Call
/// configureRoutes() separately (`forge script ... --sig
/// "configureRoutes(address)" <converter>`), broadcasting as OWNER, once
/// this has run. scratch() reverts with RouteNotConfigured for any token
/// pulled from the deck that setRoute hasn't been called for, which is a
/// safe default — ScratchCore simply can't pay out until configureRoutes
/// has run.
/// COIN is deliberately excluded from the deck below (2026-07-19: both its
/// pools on this chain are functionally empty — under 0.11 ETH of virtual
/// liquidity — so it has no real market yet).
contract DeployScratchCore is Script {
    // --- Robinhood Chain mainnet (chain id 4663) — verified live ---
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant PLTR = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;

    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    /// The one WETH/USDG Uniswap V3 pool every route's first hop uses.
    address internal constant WETH_USDG_V3_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    uint24 internal constant WETH_USDG_FEE = 100;
    int24 internal constant WETH_USDG_TICK_SPACING = 1;

    /// The real Uniswap V4 PoolManager singleton on this chain — see the
    /// contract-level doc comment for how this was verified.
    address internal constant V4_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    /// Per-stock USDG -> stock V4 pool parameters (all hookless), from the
    /// 2026-07-20 pool census.
    uint24 internal constant SPY_FEE = 3000;
    int24 internal constant SPY_TICK_SPACING = 60;
    uint24 internal constant AAPL_FEE = 10_000;
    int24 internal constant AAPL_TICK_SPACING = 200;
    uint24 internal constant MSFT_FEE = 20_000;
    int24 internal constant MSFT_TICK_SPACING = 400;
    uint24 internal constant NVDA_FEE = 3000;
    int24 internal constant NVDA_TICK_SPACING = 60;
    uint24 internal constant TSLA_FEE = 3000;
    int24 internal constant TSLA_TICK_SPACING = 60;
    uint24 internal constant PLTR_FEE = 20_000;
    int24 internal constant PLTR_TICK_SPACING = 400;

    /// Same ops wallet as script/LaunchScratchToken.s.sol's OPS_ADDRESS —
    /// one treasury address for every fee stream's ops share.
    address internal constant OPS_ADDRESS = 0xD65EeE84C26A6f976Ebc4E76D984341799841d83;

    /// Also the keeper's address — same wallet holds both roles, a
    /// deliberate tradeoff the user accepted (2026-07-19): owner's
    /// sweep()/setDailyCap()/setRoute() powers and the keeper's 24/7
    /// hot-wallet exposure now share one key.
    address internal constant OWNER = 0x2f78D437468E6EBa13e987416d863DcCFdF51b2b;

    /// A dedicated wallet, deliberately separate from OPS (2026-07-19) —
    /// holds ScratchCore's raw rake uncontaminated by other operational
    /// funds, so its balance always equals "rake collected, not yet routed
    /// to buyback." IMMUTABLE on ScratchCore once deployed — RakeRouter
    /// (the $SCRATCH buyback router) can't be deployed yet since $SCRATCH
    /// doesn't exist, so this wallet just accumulates ETH until someone (or
    /// an automated bot, not yet built) manually forwards its balance into
    /// RakeRouter and calls sweep(). There is no "swap it later" option.
    address internal constant RAKE_RECIPIENT = 0x5f59391821C8FD8ab2377090b0a6d61Eb2310830;

    /// Starting cap; owner-adjustable later via ScratchCore.setDailyCap().
    uint256 internal constant DAILY_CAP = 1000;

    function run()
        external
        returns (PrizeConverter converter, Randomness randomness, ScratchCore core, TokenTaxRouter taxRouter)
    {
        vm.startBroadcast();
        converter = new PrizeConverter(IPoolManager(V4_POOL_MANAGER), IWETH(WETH), OWNER);
        (randomness, core, taxRouter) = _deployRest(converter, _cardConfigs(), true);
        vm.stopBroadcast();
    }

    /// Redeploys Randomness -> ScratchCore -> TokenTaxRouter against an
    /// ALREADY-deployed, ALREADY-configured PrizeConverter — for when only
    /// something downstream of the converter changed (e.g. Randomness's
    /// REVEAL_DELAY) and the converter's six routes don't need touching
    /// again. Skips configureRoutes() entirely; the reused converter is
    /// already live.
    function runWithExistingConverter(address existingConverter)
        external
        returns (PrizeConverter converter, Randomness randomness, ScratchCore core, TokenTaxRouter taxRouter)
    {
        require(existingConverter != address(0), "existingConverter not set");
        require(existingConverter.code.length != 0, "existingConverter has no code");
        converter = PrizeConverter(payable(existingConverter));

        vm.startBroadcast();
        (randomness, core, taxRouter) = _deployRest(converter, _cardConfigs(), true);
        vm.stopBroadcast();
    }

    /// A second, parallel ScratchCore for a $30 card, alongside (not
    /// replacing) the live $1/$5/$10 core — CardType is a fixed 3-slot enum
    /// with no setter (see ScratchCore's cardConfigs doc comment), so a new
    /// price point can't be added to an existing deployment; this is the
    /// workaround. Reuses the SAME already-configured PrizeConverter (its
    /// convert() has no caller restriction, so any ScratchCore can call it)
    /// — the live game's pools, tickets, and player history are untouched by
    /// this. No TokenTaxRouter here: $SCRATCH's trading tax already routes
    /// into the original core exclusively; this pool is meant to be funded
    /// manually (ScratchCore.fundPools(), permissionless) from accumulated
    /// ops fees instead. All 3 card slots get the identical $30 config —
    /// deliberately, so there's no accidental cheap tier live on this
    /// contract regardless of which CardType a caller passes.
    function runWhale(address existingConverter) external returns (Randomness randomness, ScratchCore core) {
        require(existingConverter != address(0), "existingConverter not set");
        require(existingConverter.code.length != 0, "existingConverter has no code");
        PrizeConverter converter = PrizeConverter(payable(existingConverter));

        vm.startBroadcast();
        (randomness, core,) = _deployRest(converter, _whaleCardConfigs(), false);
        vm.stopBroadcast();
    }

    /// Shared by run(), runWithExistingConverter(), and runWhale() — must be
    /// called inside an active vm.startBroadcast()/stopBroadcast() block.
    /// `deployTaxRouter` is false for runWhale(): a second TokenTaxRouter
    /// would have no $SCRATCH fee stream pointed at it and would just be
    /// dead code on-chain.
    function _deployRest(PrizeConverter converter, ScratchCore.CardConfig[3] memory cardConfigs, bool deployTaxRouter)
        internal
        returns (Randomness randomness, ScratchCore core, TokenTaxRouter taxRouter)
    {
        require(OWNER != address(0), "OWNER not set");
        require(RAKE_RECIPIENT != address(0), "RAKE_RECIPIENT not set");
        require(DAILY_CAP != 0, "DAILY_CAP not set");

        address deployer = msg.sender;

        address predictedCore = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        randomness = new Randomness(predictedCore);

        core = new ScratchCore(
            converter,
            randomness,
            RAKE_RECIPIENT,
            SPY, // jackpot always settles in SPY, regardless of the mystery pull
            _deck(),
            cardConfigs,
            DAILY_CAP,
            OWNER
        );
        require(address(core) == predictedCore, "address prediction drifted");

        if (deployTaxRouter) taxRouter = new TokenTaxRouter(core, OPS_ADDRESS);
    }

    /// Owner-only follow-up: populates all six routes on an already-deployed
    /// PrizeConverter (typically the one run() just returned). Must
    /// broadcast as OWNER — setRoute reverts OwnerOnly otherwise. Run via:
    ///   forge script script/ScratchCore.s.sol --sig "configureRoutes(address)" <converter> --broadcast
    function configureRoutes(PrizeConverter converter) external {
        vm.startBroadcast();
        converter.setRoute(SPY, _route(SPY, SPY_FEE, SPY_TICK_SPACING));
        converter.setRoute(AAPL, _route(AAPL, AAPL_FEE, AAPL_TICK_SPACING));
        converter.setRoute(MSFT, _route(MSFT, MSFT_FEE, MSFT_TICK_SPACING));
        converter.setRoute(NVDA, _route(NVDA, NVDA_FEE, NVDA_TICK_SPACING));
        converter.setRoute(TSLA, _route(TSLA, TSLA_FEE, TSLA_TICK_SPACING));
        converter.setRoute(PLTR, _route(PLTR, PLTR_FEE, PLTR_TICK_SPACING));
        vm.stopBroadcast();
    }

    /// WETH -> USDG (the one V3 pool) -> `stockToken` (its own hookless V4
    /// pool at `fee`/`tickSpacing`) — the shape every one of the six routes
    /// uses, per the contract-level doc comment above.
    function _route(address stockToken, uint24 fee, int24 tickSpacing)
        internal
        pure
        returns (PrizeConverter.Hop[] memory hops)
    {
        hops = new PrizeConverter.Hop[](2);
        hops[0] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V3,
            pool: WETH_USDG_V3_POOL,
            tokenOut: USDG,
            fee: WETH_USDG_FEE,
            tickSpacing: WETH_USDG_TICK_SPACING,
            hooks: address(0)
        });
        hops[1] = PrizeConverter.Hop({
            protocol: PrizeConverter.Protocol.V4,
            pool: address(0),
            tokenOut: stockToken,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: address(0)
        });
    }

    /// Mirrors web/src/lib/mockData.ts's MYSTERY_DECK weights exactly —
    /// keep these in sync if the frontend's odds table ever changes.
    /// COIN is deliberately excluded (2026-07-19: no real liquidity on this
    /// chain yet); its 100bps rolls into SPY rather than being redistributed
    /// across the remaining tokens, since SPY already has the deepest
    /// liquidity and is the jackpot-settlement token.
    function _deck() internal pure returns (ScratchCore.DeckEntry[] memory deck) {
        deck = new ScratchCore.DeckEntry[](6);
        deck[0] = ScratchCore.DeckEntry({token: SPY, weightBps: 7_100});
        deck[1] = ScratchCore.DeckEntry({token: AAPL, weightBps: 1_000});
        deck[2] = ScratchCore.DeckEntry({token: MSFT, weightBps: 1_000});
        deck[3] = ScratchCore.DeckEntry({token: NVDA, weightBps: 600});
        deck[4] = ScratchCore.DeckEntry({token: TSLA, weightBps: 250});
        deck[5] = ScratchCore.DeckEntry({token: PLTR, weightBps: 50});
    }

    /// Same 1:5:10 ratio as the $1/$5/$10 pricing in SPEC.md §2. Repriced
    /// 2026-07-20 against the live WETH/USDG pool rate (~$1863/ETH) so the
    /// advertised $1/$5/$10 actually holds at deploy time; ETH prices are
    /// still fixed wei amounts so this drifts again as ETH/USD moves — a new
    /// deploy-script run with different numbers here is the fix, not a
    /// Solidity edit to ScratchCore itself.
    function _cardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.00054 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.0027 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.0054 ether, jackpotEntries: 2}); // Premium
    }

    /// $30 tier for the standalone Whale core (see runWhale()'s doc comment).
    /// Priced 2026-07-20 against the live WETH/USDG pool rate (~$1901/ETH,
    /// re-read fresh at the time this was written — already ~2% off the
    /// original $1/$5/$10 lineup's implied rate, since that was set earlier
    /// the same day; same drift-over-time caveat as _cardConfigs() applies).
    /// jackpotEntries=6 keeps the same 0.2-entries-per-dollar ratio the
    /// Classic/Premium configs above use (1/$5, 2/$10). All 3 slots
    /// identical on purpose — see runWhale().
    function _whaleCardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        ScratchCore.CardConfig memory whale = ScratchCore.CardConfig({price: 0.0158 ether, jackpotEntries: 6});
        cfg[0] = whale;
        cfg[1] = whale;
        cfg[2] = whale;
    }
}
