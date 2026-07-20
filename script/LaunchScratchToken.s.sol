// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IFlapPortalLauncher} from "../src/interfaces/IFlapPortal.sol";

/// Launches $SCRATCH as a Flap TOKEN_TAXED_V3 token on Robinhood Chain.
///
/// $SCRATCH holders get NONE of the trading tax as dividends — deliberate,
/// decided 2026-07-19. dividendBps is 0. The tax splits two ways instead:
///   - 10% deflationBps -> automatic buyback-and-burn (Flap-native, shrinks
///     supply; confirmed mechanism, see Tax Token V2/V3 docs)
///   - 90% mktBps -> TokenTaxRouter.sol (a single fixed beneficiary), which
///     sweeps it ~11.11%/~88.89% ops/prize-pools (of what IT receives —
///     works out to 10%/80% of the TOTAL tax) straight into ScratchCore's
///     prize pools via fundPools() (50/50 instant/jackpot there).
/// Net effect on every trade's tax: 80% game rewards, 10% ops, 10% burn.
/// This is the opposite of Flap's more common "reward holders" pattern —
/// here, trading $SCRATCH funds the game and shrinks supply, it doesn't pay
/// dividends. Nothing about the token itself is custom; only where its tax
/// revenue is aimed. `lpBps` is deliberately left at 0 — its actual
/// mechanics aren't documented anywhere in Flap's own docs (checked the
/// Portal launch reference, Tax Token V2/V3 mechanics, the Robinhood
/// integration guide, protocol economics, and pre-bond tax pages on
/// 2026-07-19; none of them explain what it does), so it's not safe to rely
/// on for a permanent, irreversible launch parameter.
///
/// This is a SEPARATE fee stream from ScratchCore's own card-sale rake:
/// RakeRouter.sol already buys $SCRATCH with half the rake and parks it at
/// a treasury wallet (buy pressure only, no distribution). The two never
/// touch the same balance — one taxes $SCRATCH's own trading and funds the
/// game, the other taxes card sales and buys $SCRATCH.
///
/// Env:
///   TOKEN_NAME              default "SCRATCH"
///   TOKEN_SYMBOL            default "SCRATCH"
///   META_CID                required — IPFS CID of token metadata JSON, pinned via
///                           Flap's upload API (https://funcs.flap.sh/api/upload)
///   TAX_BPS                 default 300 (3% buy AND sell tax; Flap max is 1000)
///   TAX_DURATION             default 315360000 (10 years, in seconds)
///   DIVIDEND_BPS             default 0 (holders get no share of the tax)
///   MKT_BPS                  default 9000 (90% of tax -> TOKEN_TAX_ROUTER)
///   DEFLATION_BPS            default 1000 (10% of tax -> automatic buyback-and-burn)
///   MINIMUM_SHARE_BALANCE    default 0 (unused while DIVIDEND_BPS is 0, kept for completeness)
///   INITIAL_BUY              default 0 — ETH (wei) for the creator's initial buy
///
/// Sequencing: run script/ScratchCore.s.sol FIRST — it deploys TokenTaxRouter
/// as its last step. Fill TOKEN_TAX_ROUTER in below with that real address
/// before running this script; the require() below blocks an accidental
/// run against the placeholder.
///
/// Usage:
///   META_CID=bafk... forge script script/LaunchScratchToken.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast \
///     --private-key $DEPLOYER_KEY
///
/// PORTAL / TAX_TOKEN_HELPER / TOKEN_IMPL_TAXED_V3 re-verified live via
/// `cast code` against Robinhood mainnet on 2026-07-19 (all hold real
/// bytecode; TOKEN_IMPL_TAXED_V3 and its `7777` vanity suffix come straight
/// from Flap's own Robinhood Chain Integration Guide) — re-check before
/// mainnet use if meaningful time has passed.
contract LaunchScratchToken is Script {
    // Flap on Robinhood Chain mainnet (Portal v5.14.16).
    address constant PORTAL = 0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09;
    /// @dev Flap's shared dividend-claim contract on Robinhood mainnet. Not
    ///      deployed by us — logged purely for reference; irrelevant here
    ///      since dividendBps is 0 and nothing accrues to claim.
    address constant TAX_TOKEN_HELPER = 0xb10bD2672aE63735d677164A54B573a016f0203C;
    /// @dev The TOKEN_TAXED_V3 clone-base implementation on Robinhood Chain —
    ///      every tax token's address is a CREATE2 minimal-proxy clone of
    ///      this address, salted to land on the `7777` suffix Portal
    ///      requires for tax tokens (Robinhood Chain Integration Guide).
    address public constant TOKEN_IMPL_TAXED_V3 = 0x7777C8743C88B3aff3cf262135beF2c8b2e83333;

    /// Real TokenTaxRouter from the current ScratchCore deploy (redeployed
    /// 2026-07-20 for REVEAL_DELAY=1 + repricing) — fingerprint-verified via
    /// Randomness.consumer() pointing back at that ScratchCore. Update this
    /// alongside script/ScratchCore.s.sol's address table in Docs.tsx if
    /// ScratchCore ever gets redeployed again before this script runs.
    address constant TOKEN_TAX_ROUTER = 0x760F117668011C05c7A073e4F8FE0dcE660bE8dA;

    uint256 constant EXPECTED_CHAIN_ID = 4663;

    // IPortalTypes enum values (see src/interfaces/IFlapPortal.sol)
    uint8 constant DEX_THRESH_FOUR_FIFTHS = 1;
    uint8 constant MIGRATOR_V2 = 1; // tax tokens must use the V2 migrator
    uint8 constant TOKEN_TAXED_V3 = 6;
    uint16 constant BPS_DENOMINATOR = 10_000;
    uint256 constant VANITY_SUFFIX = 0x7777;

    struct LaunchConfig {
        address beneficiary;
        string name;
        string symbol;
        string meta;
        uint16 taxBps;
        uint64 taxDuration;
        uint256 initialBuy;
        uint16 dividendBps;
        uint16 mktBps;
        uint16 deflationBps;
        uint256 minimumShareBalance;
        bytes32 salt;
    }

    function run() external returns (address token) {
        require(block.chainid == EXPECTED_CHAIN_ID, "wrong chain: expected Robinhood mainnet (4663)");
        require(TOKEN_TAX_ROUTER != address(0), "TOKEN_TAX_ROUTER not set - deploy ScratchCore.s.sol first");

        LaunchConfig memory cfg = LaunchConfig({
            beneficiary: TOKEN_TAX_ROUTER,
            name: vm.envOr("TOKEN_NAME", string("SCRATCH")),
            symbol: vm.envOr("TOKEN_SYMBOL", string("SCRATCH")),
            meta: vm.envString("META_CID"),
            taxBps: uint16(vm.envOr("TAX_BPS", uint256(300))),
            taxDuration: uint64(vm.envOr("TAX_DURATION", uint256(315_360_000))),
            initialBuy: vm.envOr("INITIAL_BUY", uint256(0)),
            dividendBps: uint16(vm.envOr("DIVIDEND_BPS", uint256(0))),
            mktBps: uint16(vm.envOr("MKT_BPS", uint256(9000))),
            deflationBps: uint16(vm.envOr("DEFLATION_BPS", uint256(1000))),
            minimumShareBalance: vm.envOr("MINIMUM_SHARE_BALANCE", uint256(0)),
            salt: _findVanitySalt()
        });

        return launch(cfg);
    }

    /// @dev Core launch logic, decoupled from env parsing so tests can drive it
    ///      directly with explicit configs instead of racing shared process env.
    function launch(LaunchConfig memory cfg) public returns (address token) {
        require(
            uint256(cfg.dividendBps) + uint256(cfg.mktBps) + uint256(cfg.deflationBps) == BPS_DENOMINATOR,
            "dividendBps + mktBps + deflationBps must equal 10000"
        );
        require(cfg.taxBps <= 1000, "taxBps exceeds Flap max (1000 = 10%)");

        vm.startBroadcast();

        token = IFlapPortalLauncher(PORTAL).newTokenV6{value: cfg.initialBuy}(
            IFlapPortalLauncher.NewTokenV6Params({
                name: cfg.name,
                symbol: cfg.symbol,
                meta: cfg.meta,
                dexThresh: DEX_THRESH_FOUR_FIFTHS,
                salt: cfg.salt,
                migratorType: MIGRATOR_V2,
                quoteToken: address(0), // native ETH
                quoteAmt: cfg.initialBuy,
                beneficiary: cfg.beneficiary, // mktBps share -> TokenTaxRouter
                permitData: "",
                extensionID: bytes32(0),
                extensionData: "",
                dexId: 0,
                lpFeeProfile: 0,
                buyTaxRate: cfg.taxBps,
                sellTaxRate: cfg.taxBps,
                taxDuration: cfg.taxDuration,
                antiFarmerDuration: 0,
                mktBps: cfg.mktBps,
                deflationBps: cfg.deflationBps,
                dividendBps: cfg.dividendBps,
                lpBps: 0,
                minimumShareBalance: cfg.minimumShareBalance,
                dividendToken: address(0), // irrelevant while dividendBps is 0
                commissionReceiver: address(0),
                tokenVersion: TOKEN_TAXED_V3
            })
        );

        vm.stopBroadcast();

        console.log("Token launched at:", token);
        console.log("Tax bps (buy & sell):", cfg.taxBps);
        console.log("Dividend bps (of tax, to holders):", cfg.dividendBps);
        console.log("Mkt bps (of tax, to TokenTaxRouter):", cfg.mktBps);
        console.log("Deflation bps (of tax, buyback & burn):", cfg.deflationBps);
        console.log("TokenTaxRouter address:", cfg.beneficiary);
        console.log("Flap page: https://flap.sh/ (search the token address)");
    }

    /// Brute-force CREATE2 vanity salt search, replicating Flap's own
    /// documented off-chain algorithm (Launch token through Portal, "Find
    /// the salt" section) directly on-chain via vm.computeCreate2Address —
    /// pure/local, no network calls, so looping here is cheap even though
    /// a 4-hex-char suffix takes ~65,536 tries on average. The token
    /// address is a CREATE2 minimal-proxy (EIP-1167) clone of
    /// TOKEN_IMPL_TAXED_V3, deployed by PORTAL.
    /// @dev Test-only accessor — _findVanitySalt() itself stays internal.
    function exposed_findVanitySalt() external view returns (bytes32) {
        return _findVanitySalt();
    }

    function _findVanitySalt() internal view returns (bytes32 salt) {
        bytes memory cloneBytecode = abi.encodePacked(
            hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", TOKEN_IMPL_TAXED_V3, hex"5af43d82803e903d91602b57fd5bf3"
        );
        bytes32 initCodeHash = keccak256(cloneBytecode);

        salt = keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender));
        while (uint160(vm.computeCreate2Address(salt, initCodeHash, PORTAL)) & 0xFFFF != VANITY_SUFFIX) {
            salt = keccak256(abi.encodePacked(salt));
        }
    }
}
