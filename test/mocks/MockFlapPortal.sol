// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFlapPortalLauncher} from "../../src/interfaces/IFlapPortal.sol";

/// TEST ONLY — captures the params LaunchScratchToken.s.sol passes to
/// newTokenV6 so tests can assert on them, without needing a real Portal
/// deployment.
contract MockFlapPortal is IFlapPortalLauncher {
    NewTokenV6Params private _lastParams;
    uint256 public callCount;

    function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token) {
        _lastParams = params;
        callCount++;
        return address(uint160(uint256(keccak256(abi.encode(params.salt, callCount)))));
    }

    function getLastParams() external view returns (NewTokenV6Params memory) {
        return _lastParams;
    }
}
