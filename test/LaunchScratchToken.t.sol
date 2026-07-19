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
    address taxRouter = makeAddr("taxRouter");

    function setUp() public {
        vm.chainId(4663);
        script = new LaunchScratchToken();

        // Etch a mock in place of the real Portal so launch() can broadcast against it.
        mockPortal = new MockFlapPortal();
        vm.etch(PORTAL, address(mockPortal).code);
    }

    function defaultConfig() internal view returns (LaunchScratchToken.LaunchConfig memory) {
        return LaunchScratchToken.LaunchConfig({
            beneficiary: taxRouter,
            name: "SCRATCH",
            symbol: "SCRATCH",
            meta: "bafktest",
            taxBps: 300,
            taxDuration: 315_360_000,
            initialBuy: 0,
            dividendBps: 0,
            mktBps: 9000,
            deflationBps: 1000,
            minimumShareBalance: 0,
            salt: keccak256("seed")
        });
    }

    function test_defaultSplit_ninetyMktTenDeflationNoneToHolders() public {
        address token = script.launch(defaultConfig());
        assertTrue(token != address(0));

        IFlapPortalLauncher.NewTokenV6Params memory p = MockFlapPortal(PORTAL).getLastParams();

        assertEq(p.beneficiary, taxRouter);
        assertEq(p.buyTaxRate, 300);
        assertEq(p.sellTaxRate, 300);
        assertEq(p.mktBps, 9000);
        assertEq(p.deflationBps, 1000);
        assertEq(p.dividendBps, 0);
        assertEq(uint256(p.mktBps) + uint256(p.deflationBps) + uint256(p.dividendBps), 10_000);
        assertEq(p.lpBps, 0); // deliberately unused — see script's doc comment
        assertEq(p.tokenVersion, 6); // TOKEN_TAXED_V3
        assertEq(p.migratorType, 1); // V2 migrator (required for tax tokens)
        assertEq(p.quoteToken, address(0)); // native ETH quote
    }

    function test_customSplit_honorsOverrides() public {
        LaunchScratchToken.LaunchConfig memory cfg = defaultConfig();
        cfg.dividendBps = 3000;
        cfg.mktBps = 6000;
        cfg.deflationBps = 1000;
        cfg.taxBps = 500;

        script.launch(cfg);

        IFlapPortalLauncher.NewTokenV6Params memory p = MockFlapPortal(PORTAL).getLastParams();
        assertEq(p.buyTaxRate, 500);
        assertEq(p.sellTaxRate, 500);
        assertEq(p.mktBps, 6000);
        assertEq(p.dividendBps, 3000);
        assertEq(p.deflationBps, 1000);
    }

    function test_revertsIfSplitDoesNotSumToDenominator() public {
        LaunchScratchToken.LaunchConfig memory cfg = defaultConfig();
        cfg.dividendBps = 6000;
        cfg.mktBps = 3000;
        cfg.deflationBps = 500; // sums to 9500, not 10000
        vm.expectRevert(bytes("dividendBps + mktBps + deflationBps must equal 10000"));
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

    /// TOKEN_TAX_ROUTER is a hardcoded constant (address(0) until
    /// script/ScratchCore.s.sol has actually deployed it) — run() must
    /// refuse to launch against that placeholder rather than silently
    /// routing 100% of the tax into a burn address.
    function test_run_revertsWhenTokenTaxRouterNotSet() public {
        vm.setEnv("META_CID", "bafktest");
        vm.expectRevert(bytes("TOKEN_TAX_ROUTER not set - deploy ScratchCore.s.sol first"));
        script.run();
    }

    /// Proves the on-chain vanity salt search actually produces a salt
    /// whose predicted CREATE2 address ends in the `7777` suffix Portal
    /// requires for tax tokens — not just that the loop compiles.
    function test_findVanitySalt_producesAnAddressEndingIn7777() public view {
        bytes32 salt = script.exposed_findVanitySalt();

        address tokenImpl = script.TOKEN_IMPL_TAXED_V3();
        bytes memory cloneBytecode =
            abi.encodePacked(hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", tokenImpl, hex"5af43d82803e903d91602b57fd5bf3");
        address predicted = vm.computeCreate2Address(salt, keccak256(cloneBytecode), PORTAL);

        assertEq(uint160(predicted) & 0xFFFF, 0x7777);
    }
}
