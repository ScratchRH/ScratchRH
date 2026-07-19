// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScratchCore} from "./ScratchCore.sol";

/// Sits behind $SCRATCH's Flap-native tax `beneficiary` (dividendBps=0,
/// mktBps=10000 — see script/LaunchScratchToken.s.sol). Every trade's tax
/// just lands here as native ETH; `sweep()` splits the balance OPS_BPS/
/// POOLS_BPS — the ops share stays as ETH to `opsRecipient`, the rest goes
/// straight into ScratchCore's prize pools via `core.fundPools()`, split
/// 50/50 between instant and jackpot there.
///
/// Deliberately does NOT distribute anything to $SCRATCH holders — that's
/// the whole point of routing tax through mktBps instead of Flap's native
/// dividendBps. Immutable, no owner, no pause — permissionless like
/// ScratchCore.scratch()/RakeRouter.sweep(), so any keeper can crank it.
contract TokenTaxRouter {
    ScratchCore public immutable core;
    address public immutable opsRecipient;

    uint16 public constant OPS_BPS = 1000;
    uint16 public constant POOLS_BPS = 9000;
    uint16 public constant BPS_DENOM = 10_000;

    uint256 private _locked = 1;

    event Swept(uint256 opsAmount, uint256 poolsAmount);

    error Reentrancy();
    error NothingToSweep();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(ScratchCore _core, address _opsRecipient) {
        core = _core;
        opsRecipient = _opsRecipient;
    }

    receive() external payable {}

    /// Permissionless so any keeper can crank a sweep once tax has accrued.
    function sweep() external nonReentrant returns (uint256 opsAmount, uint256 poolsAmount) {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToSweep();

        opsAmount = (balance * OPS_BPS) / BPS_DENOM;
        poolsAmount = balance - opsAmount;

        if (opsAmount > 0) {
            (bool ok,) = opsRecipient.call{value: opsAmount}("");
            require(ok, "ops transfer failed");
        }

        if (poolsAmount > 0) {
            core.fundPools{value: poolsAmount}();
        }

        emit Swept(opsAmount, poolsAmount);
    }
}
