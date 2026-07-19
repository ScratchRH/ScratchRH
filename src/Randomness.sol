// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Future-blockhash randomness. Chainlink VRF is not confirmed available on
/// Robinhood Chain (SPEC.md §7.1 / research 2026-07) so this is the fallback
/// v1 design named in the spec. Reveal is permissionless so any keeper can
/// crank it (SPEC.md's settle()/reveal() bounty pattern). The sequencer
/// controls block production, so this inherits sequencer trust — disclose
/// that in the site's vault-notes panel. Upgrade to VRF before any single
/// jackpot exceeds ~$5k.
contract Randomness {
    uint256 public constant REVEAL_DELAY = 3;

    address public immutable consumer;

    struct Request {
        uint64 targetBlock;
        bool fulfilled;
    }

    mapping(uint256 requestId => Request) public requests;

    event Requested(uint256 indexed requestId, uint256 targetBlock);
    event Fulfilled(uint256 indexed requestId, uint256 randomWord);

    error NotConsumer();
    error AlreadyRequested();
    error RequestNotFound();
    error NotYetRevealable();
    error AlreadyFulfilled();
    error BlockhashExpired();
    error NotExpired();

    modifier onlyConsumer() {
        if (msg.sender != consumer) revert NotConsumer();
        _;
    }

    constructor(address _consumer) {
        consumer = _consumer;
    }

    function request(uint256 requestId) external onlyConsumer returns (uint256 targetBlock) {
        if (requests[requestId].targetBlock != 0) revert AlreadyRequested();
        targetBlock = block.number + REVEAL_DELAY;
        // safe: uint64 doesn't wrap until block ~1.8e19, far beyond any real chain's lifetime
        // forge-lint: disable-next-line(unsafe-typecast)
        requests[requestId] = Request({targetBlock: uint64(targetBlock), fulfilled: false});
        emit Requested(requestId, targetBlock);
    }

    /// Permissionless: anyone can pay the gas to reveal a matured request.
    function fulfill(uint256 requestId) external returns (uint256 randomWord) {
        Request storage req = requests[requestId];
        if (req.targetBlock == 0) revert RequestNotFound();
        if (req.fulfilled) revert AlreadyFulfilled();
        if (block.number <= req.targetBlock) revert NotYetRevealable();

        bytes32 hash = blockhash(req.targetBlock);
        if (hash == bytes32(0)) revert BlockhashExpired();

        req.fulfilled = true;
        randomWord = uint256(keccak256(abi.encode(hash, requestId, address(this))));
        emit Fulfilled(requestId, randomWord);
    }

    /// If nobody called fulfill() within 256 blocks the target blockhash is
    /// gone forever; re-arm the request with a fresh target rather than
    /// stranding the ticket permanently unresolved.
    function reroll(uint256 requestId) external onlyConsumer returns (uint256 targetBlock) {
        Request storage req = requests[requestId];
        if (req.targetBlock == 0) revert RequestNotFound();
        if (req.fulfilled) revert AlreadyFulfilled();
        if (block.number <= req.targetBlock || blockhash(req.targetBlock) != bytes32(0)) revert NotExpired();

        targetBlock = block.number + REVEAL_DELAY;
        // safe: uint64 doesn't wrap until block ~1.8e19, far beyond any real chain's lifetime
        // forge-lint: disable-next-line(unsafe-typecast)
        req.targetBlock = uint64(targetBlock);
        emit Requested(requestId, targetBlock);
    }

    function isRevealable(uint256 requestId) external view returns (bool) {
        Request storage req = requests[requestId];
        return req.targetBlock != 0 && !req.fulfilled && block.number > req.targetBlock
            && blockhash(req.targetBlock) != bytes32(0);
    }

    function isExpired(uint256 requestId) external view returns (bool) {
        Request storage req = requests[requestId];
        return req.targetBlock != 0 && !req.fulfilled && block.number > req.targetBlock
            && blockhash(req.targetBlock) == bytes32(0);
    }
}
