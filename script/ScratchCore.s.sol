// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ScratchCore} from "../src/ScratchCore.sol";
import {Randomness} from "../src/Randomness.sol";
import {UniswapV4PrizeConverter} from "../src/UniswapV4PrizeConverter.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

/// Deploys UniswapV4PrizeConverter -> Randomness -> ScratchCore in the one
/// order that works: Randomness needs ScratchCore's address up front
/// (immutable consumer), so it's predicted from the deployer's next nonce
/// before ScratchCore exists — same trick test/ScratchCore.t.sol uses, with
/// the same post-deploy assertion so this reverts loudly instead of
/// silently deploying against a mismatched address if the nonce math drifts.
///
/// Addresses below are Robinhood Chain mainnet (chain id 4663), verified
/// 2026-07-19 against live deployed bytecode (cast code) and, for the
/// PoolManager, a genuine held SPY/ETH/WETH balance — not just pulled from
/// documentation. Re-verify before mainnet use if time has passed.
///
/// Does NOT call UniswapV4PrizeConverter.setPoolConfig() — the real
/// fee/tickSpacing/hooks for the SPY pool weren't pinned down during
/// research (see conversation notes), only that a real, liquid pool exists.
/// Call setPoolConfig separately once those are confirmed; scratch() will
/// revert with PoolNotConfigured until then, which is a safe default.
contract DeployScratchCore is Script {
    // --- Robinhood Chain mainnet (chain id 4663) — verified live ---
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant COIN = 0x6330D8C3178a418788dF01a47479c0ce7CCF450b;
    address internal constant PLTR = 0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A;

    /// Also the keeper's address — same wallet holds both roles, a
    /// deliberate tradeoff the user accepted (2026-07-19): owner's
    /// sweep()/setDailyCap() powers and the keeper's 24/7 hot-wallet
    /// exposure now share one key.
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

    function run() external returns (UniswapV4PrizeConverter converter, Randomness randomness, ScratchCore core) {
        require(OWNER != address(0), "OWNER not set");
        require(RAKE_RECIPIENT != address(0), "RAKE_RECIPIENT not set");
        require(DAILY_CAP != 0, "DAILY_CAP not set");

        vm.startBroadcast();
        address deployer = msg.sender;

        converter = new UniswapV4PrizeConverter(IPoolManager(POOL_MANAGER), OWNER);

        address predictedCore = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        randomness = new Randomness(predictedCore);

        core = new ScratchCore(
            converter,
            randomness,
            RAKE_RECIPIENT,
            SPY, // jackpot always settles in SPY, regardless of the mystery pull
            _deck(),
            _cardConfigs(),
            DAILY_CAP,
            OWNER
        );
        require(address(core) == predictedCore, "address prediction drifted");

        vm.stopBroadcast();
    }

    /// Mirrors web/src/lib/mockData.ts's MYSTERY_DECK weights exactly —
    /// keep these in sync if the frontend's odds table ever changes.
    function _deck() internal pure returns (ScratchCore.DeckEntry[] memory deck) {
        deck = new ScratchCore.DeckEntry[](7);
        deck[0] = ScratchCore.DeckEntry({token: SPY, weightBps: 7_000});
        deck[1] = ScratchCore.DeckEntry({token: AAPL, weightBps: 1_000});
        deck[2] = ScratchCore.DeckEntry({token: MSFT, weightBps: 1_000});
        deck[3] = ScratchCore.DeckEntry({token: NVDA, weightBps: 600});
        deck[4] = ScratchCore.DeckEntry({token: TSLA, weightBps: 250});
        deck[5] = ScratchCore.DeckEntry({token: COIN, weightBps: 100});
        deck[6] = ScratchCore.DeckEntry({token: PLTR, weightBps: 50});
    }

    /// Same 1:5:10 ratio as the $1/$5/$10 pricing in SPEC.md §2 — not a live
    /// USD conversion, tune before mainnet. A future season with a
    /// different lineup is a new deploy-script run with different numbers
    /// here, not a Solidity edit to ScratchCore itself.
    function _cardConfigs() internal pure returns (ScratchCore.CardConfig[3] memory cfg) {
        cfg[0] = ScratchCore.CardConfig({price: 0.001 ether, jackpotEntries: 0}); // Penny
        cfg[1] = ScratchCore.CardConfig({price: 0.005 ether, jackpotEntries: 1}); // Classic
        cfg[2] = ScratchCore.CardConfig({price: 0.01 ether, jackpotEntries: 2}); // Premium
    }
}
