// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IFlapPortalLauncher} from "../src/interfaces/IFlapPortal.sol";

/// Launches $SCRATCH as a Flap TOKEN_TAXED_V3 token on Robinhood Chain.
///
/// $SCRATCH needs no custom Solidity: Flap's TOKEN_TAXED_V3 has a built-in
/// dividend mechanism (the `dividendBps` / `dividendToken` launch params)
/// with pull-based, magnified-dividend-per-share-style accounting, pool /
/// dead / zero addresses auto-excluded from share calculations. Holders
/// claim their accrued ETH via Flap's shared Tax Token Helper contract.
/// Nothing here is deployed by this repo — the token is entirely Flap's.
///
/// This is a SEPARATE fee stream from ScratchCore's own card-sale rake:
/// RakeRouter.sol already buys $SCRATCH with half the rake and parks it at
/// a treasury wallet (buy pressure only, no distribution). The dividend
/// split configured here taxes $SCRATCH's OWN trading and pushes it
/// straight to $SCRATCH holders — the two never touch the same balance.
///
/// Every trade pays TAX_BPS tax, split:
///   DIVIDEND_BPS (default 9000 = 90%) -> pro-rata ETH dividends to holders
///   MKT_BPS      (default 1000 = 10%) -> OPS_ADDRESS (immutable, set once at launch)
///
/// Env:
///   TOKEN_NAME              default "SCRATCH"
///   TOKEN_SYMBOL            default "SCRATCH"
///   META_CID                required — IPFS CID of token metadata JSON, pinned via
///                           Flap's upload API (https://funcs.flap.sh/api/upload)
///   TAX_BPS                 default 300 (3% buy AND sell tax; Flap max is 1000)
///   TAX_DURATION             default 315360000 (10 years, in seconds)
///   DIVIDEND_BPS             default 9000 (90% of tax -> holder dividends)
///   MKT_BPS                  default 1000 (10% of tax -> OPS_ADDRESS)
///   MINIMUM_SHARE_BALANCE    default 0 (min $SCRATCH balance to accrue dividends)
///   INITIAL_BUY              default 0 — ETH (wei) for the creator's initial buy
///   SEED                     default 1 — salt seed (no vanity requirement here,
///                            since there is no companion contract address to predict)
///
/// Usage:
///   META_CID=bafk... forge script script/LaunchScratchToken.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com --broadcast \
///     --private-key $DEPLOYER_KEY
///
/// PORTAL / TAX_TOKEN_HELPER re-verified live via `cast code` against
/// Robinhood mainnet on 2026-07-19 (both hold real proxy bytecode) —
/// re-check before mainnet use if meaningful time has passed.
contract LaunchScratchToken is Script {
    // Flap on Robinhood Chain mainnet (Portal v5.14.16).
    address constant PORTAL = 0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09;
    /// @dev Flap's shared dividend-claim contract on Robinhood mainnet. Not
    ///      deployed by us — logged here purely for operator/frontend reference.
    address constant TAX_TOKEN_HELPER = 0xb10bD2672aE63735d677164A54B573a016f0203C;
    /// @dev Same ops/treasury wallet as RakeRouter.s.sol's OPS_RECIPIENT —
    ///      one address for both fee streams.
    address constant OPS_ADDRESS = 0xD65EeE84C26A6f976Ebc4E76D984341799841d83;
    uint256 constant EXPECTED_CHAIN_ID = 4663;

    // IPortalTypes enum values (see src/interfaces/IFlapPortal.sol)
    uint8 constant DEX_THRESH_FOUR_FIFTHS = 1;
    uint8 constant MIGRATOR_V2 = 1; // tax tokens must use the V2 migrator
    uint8 constant TOKEN_TAXED_V3 = 6;
    uint16 constant BPS_DENOMINATOR = 10_000;

    struct LaunchConfig {
        address ops;
        string name;
        string symbol;
        string meta;
        uint16 taxBps;
        uint64 taxDuration;
        uint256 initialBuy;
        uint16 dividendBps;
        uint16 mktBps;
        uint256 minimumShareBalance;
        bytes32 salt;
    }

    function run() external returns (address token) {
        require(block.chainid == EXPECTED_CHAIN_ID, "wrong chain: expected Robinhood mainnet (4663)");

        LaunchConfig memory cfg = LaunchConfig({
            ops: OPS_ADDRESS,
            name: vm.envOr("TOKEN_NAME", string("SCRATCH")),
            symbol: vm.envOr("TOKEN_SYMBOL", string("SCRATCH")),
            meta: vm.envString("META_CID"),
            taxBps: uint16(vm.envOr("TAX_BPS", uint256(300))),
            taxDuration: uint64(vm.envOr("TAX_DURATION", uint256(315_360_000))),
            initialBuy: vm.envOr("INITIAL_BUY", uint256(0)),
            dividendBps: uint16(vm.envOr("DIVIDEND_BPS", uint256(9000))),
            mktBps: uint16(vm.envOr("MKT_BPS", uint256(1000))),
            minimumShareBalance: vm.envOr("MINIMUM_SHARE_BALANCE", uint256(0)),
            salt: keccak256(abi.encode(vm.envOr("SEED", uint256(1)), block.number))
        });

        return launch(cfg);
    }

    /// @dev Core launch logic, decoupled from env parsing so tests can drive it
    ///      directly with explicit configs instead of racing shared process env.
    function launch(LaunchConfig memory cfg) public returns (address token) {
        require(
            uint256(cfg.dividendBps) + uint256(cfg.mktBps) == BPS_DENOMINATOR,
            "dividendBps + mktBps must equal 10000"
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
                beneficiary: cfg.ops, // mktBps share -> ops address
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
                deflationBps: 0,
                dividendBps: cfg.dividendBps,
                lpBps: 0,
                minimumShareBalance: cfg.minimumShareBalance,
                dividendToken: address(0), // native ETH dividends
                commissionReceiver: address(0),
                tokenVersion: TOKEN_TAXED_V3
            })
        );

        vm.stopBroadcast();

        console.log("Token launched at:", token);
        console.log("Tax bps (buy & sell):", cfg.taxBps);
        console.log("Dividend bps (of tax):", cfg.dividendBps);
        console.log("Ops/mkt bps (of tax):", cfg.mktBps);
        console.log("Ops address:", cfg.ops);
        console.log("Tax Token Helper (claim contract):", TAX_TOKEN_HELPER);
        console.log("Flap page: https://flap.sh/ (search the token address)");
    }
}
