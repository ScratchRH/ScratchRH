// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ScratchCore} from "../../src/ScratchCore.sol";
import {Randomness} from "../../src/Randomness.sol";
import {IPrizeConverter} from "../../src/interfaces/IPrizeConverter.sol";

/// Exposes ScratchCore's internal tier-resolution and stock-pull math for
/// direct unit testing without needing to drive real blockhash-based
/// randomness.
contract ScratchCoreHarness is ScratchCore {
    constructor(
        IPrizeConverter _converter,
        Randomness _randomness,
        address _rakeRecipient,
        address _jackpotStockToken,
        DeckEntry[] memory _deck,
        uint256 _dailyCap,
        address _owner
    ) ScratchCore(_converter, _randomness, _rakeRecipient, _jackpotStockToken, _deck, _dailyCap, _owner) {}

    function resolveTier(uint256 roll, uint8 jackpotEntries) external pure returns (Tier) {
        return _resolveTier(roll, jackpotEntries);
    }

    function pullStock(uint256 randomWord) external view returns (address) {
        return _pullStock(randomWord);
    }

    function payInstant(Tier tier, uint256 price, address player, address stockToken) external returns (uint256) {
        return _payInstant(tier, price, player, stockToken);
    }
}
