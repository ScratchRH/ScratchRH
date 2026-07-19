// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IScratchConverter} from "../src/interfaces/IScratchConverter.sol";
import {RakeRouter} from "../src/RakeRouter.sol";

/// Deploys RakeRouter behind ScratchCore's rakeRecipient (SPEC.md §2/§3).
/// Not runnable yet: CONVERTER is unset until $SCRATCH and its swap pool go
/// live (SPEC.md §3/§7.2) — run() reverts until that address is filled in.
contract DeployRakeRouter is Script {
    address internal constant OPS_RECIPIENT = 0xD65EeE84C26A6f976Ebc4E76D984341799841d83;

    /// TODO: fill in once the $SCRATCH buyback converter is deployed.
    address internal constant CONVERTER = address(0);

    function run() external returns (RakeRouter router) {
        require(CONVERTER != address(0), "CONVERTER not set: $SCRATCH buyback not live yet");

        vm.startBroadcast();
        router = new RakeRouter(IScratchConverter(CONVERTER), OPS_RECIPIENT);
        vm.stopBroadcast();
    }
}
