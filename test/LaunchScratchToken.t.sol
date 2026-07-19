// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LaunchScratchToken} from "../script/LaunchScratchToken.s.sol";
import {MockFlapPortal} from "./mocks/MockFlapPortal.sol";
import {IFlapPortalLauncher} from "../src/interfaces/IFlapPortal.sol";

contract LaunchScratchTokenTest is Test {
    LaunchScratchToken script;
    MockFlapPortal mockPortal;
    address constant PORTAL = 0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09;
    address ops = makeAddr("ops");

    function setUp() public {
        vm.chainId(4663);
        script = new LaunchScratchToken();

        // Etch a mock in place of the real Portal so launch() can broadcast against it.
        mockPortal = new MockFlapPortal();
        vm.etch(PORTAL, address(mockPortal).code);
    }

    function defaultConfig() internal view returns (LaunchScratchToken.LaunchConfig memory) {
        return LaunchScratchToken.LaunchConfig({
            ops: ops,
            name: "SCRATCH",
            symbol: "SCRATCH",
            meta: "bafktest",
            taxBps: 300,
            taxDuration: 315_360_000,
            initialBuy: 0,
            dividendBps: 9000,
            mktBps: 1000,
            minimumShareBalance: 0,
            salt: keccak256("seed")
        });
    }

    function test_defaultSplit_dividendAndMktSumToDenominator() public {
        address token = script.launch(defaultConfig());
        assertTrue(token != address(0));

        IFlapPortalLauncher.NewTokenV6Params memory p = MockFlapPortal(PORTAL).getLastParams();

        assertEq(p.beneficiary, ops);
        assertEq(p.buyTaxRate, 300);
        assertEq(p.sellTaxRate, 300);
        assertEq(p.mktBps, 1000);
        assertEq(p.dividendBps, 9000);
        assertEq(uint256(p.mktBps) + uint256(p.dividendBps), 10_000);
        assertEq(p.dividendToken, address(0)); // native ETH dividends
        assertEq(p.tokenVersion, 6); // TOKEN_TAXED_V3
        assertEq(p.migratorType, 1); // V2 migrator (required for tax tokens)
        assertEq(p.quoteToken, address(0)); // native ETH quote
    }

    function test_customSplit_honorsOverrides() public {
        LaunchScratchToken.LaunchConfig memory cfg = defaultConfig();
        cfg.dividendBps = 10_000;
        cfg.mktBps = 0;
        cfg.taxBps = 500;

        script.launch(cfg);

        IFlapPortalLauncher.NewTokenV6Params memory p = MockFlapPortal(PORTAL).getLastParams();
        assertEq(p.buyTaxRate, 500);
        assertEq(p.sellTaxRate, 500);
        assertEq(p.mktBps, 0);
        assertEq(p.dividendBps, 10_000);
    }

    function test_revertsIfSplitDoesNotSumToDenominator() public {
        LaunchScratchToken.LaunchConfig memory cfg = defaultConfig();
        cfg.dividendBps = 6000;
        cfg.mktBps = 3000; // sums to 9000, not 10000
        vm.expectRevert(bytes("dividendBps + mktBps must equal 10000"));
        script.launch(cfg);
    }

    function test_revertsIfTaxExceedsFlapMax() public {
        LaunchScratchToken.LaunchConfig memory cfg = defaultConfig();
        cfg.taxBps = 1001;
        vm.expectRevert(bytes("taxBps exceeds Flap max (1000 = 10%)"));
        script.launch(cfg);
    }

    function test_revertsOnWrongChain() public {
        vm.chainId(1); // not Robinhood mainnet
        vm.setEnv("META_CID", "bafktest");
        vm.expectRevert(bytes("wrong chain: expected Robinhood mainnet (4663)"));
        script.run();
    }

    function test_run_readsEnvAndAppliesDefaults() public {
        vm.setEnv("META_CID", "bafktest");

        address token = script.run();
        assertTrue(token != address(0));

        IFlapPortalLauncher.NewTokenV6Params memory p = MockFlapPortal(PORTAL).getLastParams();
        assertEq(p.beneficiary, 0xD65EeE84C26A6f976Ebc4E76D984341799841d83);
        assertEq(p.buyTaxRate, 300);
        assertEq(p.dividendBps, 9000);
        assertEq(p.mktBps, 1000);
        assertEq(p.name, "SCRATCH");
        assertEq(p.symbol, "SCRATCH");
    }
}
