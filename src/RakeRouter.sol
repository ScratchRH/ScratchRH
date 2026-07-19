// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IScratchConverter} from "./interfaces/IScratchConverter.sol";

/// Sits behind ScratchCore's `rakeRecipient` (SPEC.md §2/§3). Every rake
/// transfer just lands here as native ETH; `sweep()` splits the balance
/// 50/50 — half stays as ETH and goes straight to `recipient`, half is
/// swapped into $SCRATCH via `converter` and sent to the same `recipient`.
/// Immutable, no owner, no pause — permissionless like scratch()/withdraw()
/// so any keeper can crank it. `recipient` is fixed at deploy and is meant
/// to be a wallet the deployer controls.
contract RakeRouter {
    IScratchConverter public immutable converter;
    address public immutable recipient;

    uint16 public constant OPS_BPS = 5000;
    uint16 public constant BUYBACK_BPS = 5000;
    uint16 public constant BPS_DENOM = 10_000;

    uint256 private _locked = 1;

    event Swept(uint256 opsAmount, uint256 buybackAmountIn, uint256 scratchOut);

    error Reentrancy();
    error NothingToSweep();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IScratchConverter _converter, address _recipient) {
        converter = _converter;
        recipient = _recipient;
    }

    receive() external payable {}

    /// Permissionless so any keeper can crank a sweep once rake has accrued.
    function sweep() external nonReentrant returns (uint256 opsAmount, uint256 scratchOut) {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToSweep();

        opsAmount = (balance * OPS_BPS) / BPS_DENOM;
        uint256 buybackAmount = balance - opsAmount;

        if (opsAmount > 0) {
            (bool ok,) = recipient.call{value: opsAmount}("");
            require(ok, "ops transfer failed");
        }

        if (buybackAmount > 0) {
            scratchOut = converter.convert{value: buybackAmount}(recipient);
        }

        emit Swept(opsAmount, buybackAmount, scratchOut);
    }
}
