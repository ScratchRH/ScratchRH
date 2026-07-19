// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Randomness} from "./Randomness.sol";
import {IPrizeConverter} from "./interfaces/IPrizeConverter.sol";

/// Ticket sales, split routing, prize pools, tier resolution, and payout
/// (SPEC.md §2). Immutable, no pause, no upgrade. One deliberate exception to
/// the no-sweep ethos: `owner` can withdraw the full pool balance, but only
/// after `WITHDRAW_INACTIVITY_PERIOD` has passed with zero tickets bought —
/// a dead-game recovery valve, not a live rug lever. Daily mint cap resets by
/// UTC day.
///
/// Mystery packs: which stock a ticket pays out in is not chosen by the
/// buyer — it's pulled from `deck` using the same randomness that resolves
/// the instant-prize tier, and only revealed at scratch() time. Letting
/// buyers pick their own stock would defeat the pack-opening reveal this
/// game is built around.
contract ScratchCore {
    enum CardType {
        Penny,
        Classic,
        Premium
    }

    enum Tier {
        None,
        OneX,
        TwoX,
        ThreeX,
        FourX,
        FiveX,
        TenX,
        Jackpot
    }

    struct CardConfig {
        uint128 price; // in wei
        uint8 jackpotEntries; // 0 = not eligible
    }

    struct DeckEntry {
        address token;
        uint16 weightBps; // relative pull odds; all entries must sum to BPS_DENOM
    }

    struct Ticket {
        address player;
        CardType cardType;
        address stockToken; // address(0) until scratch() reveals the pull
        bool scratched;
    }

    IPrizeConverter public immutable converter;
    Randomness public immutable randomness;
    address public immutable rakeRecipient;
    address public immutable owner;

    /// Withdraw unlocks once this many seconds pass with no ticket bought.
    uint256 public constant WITHDRAW_INACTIVITY_PERIOD = 36 hours;
    uint256 public lastPurchaseTimestamp;

    /// The jackpot is always paid in this stock regardless of a ticket's
    /// mystery pull — "the jackpot is real S&P 500 and grows even when
    /// nobody's playing" is a much better line if it's literally true.
    address public immutable jackpotStockToken;

    /// Season's mystery-pack pool. Set once at deploy; a new season is a new
    /// deployment rather than an admin update, matching the no-owner ethos.
    DeckEntry[] public deck;

    // $5 Classic split: $2 floor / $2 instant pool / $0.50 jackpot / $0.50 rake (SPEC.md §2).
    uint16 public constant FLOOR_BPS = 4000;
    uint16 public constant INSTANT_POOL_BPS = 4000;
    uint16 public constant JACKPOT_BPS = 1000;
    uint16 public constant RAKE_BPS = 1000;
    uint16 public constant BPS_DENOM = 10_000;

    // Odds expressed directly in bps out of 10,000 (1 bps = 1-in-10,000).
    uint16 public constant JACKPOT_ODDS_BPS = 1; // 1 in 10,000, scaled by jackpotEntries
    uint16 public constant TEN_X_ODDS_BPS = 10; // 1 in 1,000
    uint16 public constant FIVE_X_ODDS_BPS = 40; // 1 in 250
    uint16 public constant FOUR_X_ODDS_BPS = 120; // 1 in ~83
    uint16 public constant THREE_X_ODDS_BPS = 350; // 1 in ~29
    uint16 public constant TWO_X_ODDS_BPS = 700; // 1 in ~14
    uint16 public constant ONE_X_ODDS_BPS = 1400; // 1 in ~7

    uint16 public constant JACKPOT_PAYOUT_BPS = 7000; // 70% paid, 30% rolls over

    // Instant prize = ticket price * this bps (10_000 = 1x).
    uint32 public constant ONE_X_MULTIPLIER_BPS = 10_000;
    uint32 public constant TWO_X_MULTIPLIER_BPS = 20_000;
    uint32 public constant THREE_X_MULTIPLIER_BPS = 30_000;
    uint32 public constant FOUR_X_MULTIPLIER_BPS = 40_000;
    uint32 public constant FIVE_X_MULTIPLIER_BPS = 50_000;
    uint32 public constant TEN_X_MULTIPLIER_BPS = 100_000;

    /// Deliberately NOT immutable — this is a capacity dial, not a fairness
    /// lever. It can't touch prices, odds, or payouts, only how many cards
    /// can sell per day, so `owner` can tune it via setDailyCap(). Accepted
    /// tradeoff: setting this to 0 is functionally a pause (no new
    /// purchases until it's raised again), which the rest of the contract
    /// otherwise has zero capability to do.
    uint256 public dailyCap;
    uint256 public cardsSoldToday;
    uint256 public currentDay;

    uint256 public instantPool;
    uint256 public jackpotPot;

    uint256 public nextTicketId = 1;
    mapping(uint256 => Ticket) public tickets;
    mapping(CardType => CardConfig) public cardConfigs;

    uint256 private _locked = 1;

    event Bought(uint256 indexed ticketId, address indexed player, CardType cardType);
    event FloorPaid(uint256 indexed ticketId, address indexed player, uint256 amount, address stockToken);
    event Scratched(uint256 indexed ticketId, Tier tier, address stockToken, uint256 payout);
    event Won(uint256 indexed ticketId, address indexed player, Tier tier, uint256 payout);
    event JackpotHit(uint256 indexed ticketId, address indexed player, uint256 payout, uint256 rolledOver);
    event RolledOver(uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event DailyCapUpdated(uint256 oldCap, uint256 newCap);
    event PoolsFunded(uint256 instantAmount, uint256 jackpotAmount);

    error DailyCapReached();
    error TicketNotFound();
    error AlreadyScratched();
    error Reentrancy();
    error InvalidDeckWeights();
    error EmptyDeck();
    error NotOwner();
    error StillActive();
    error IncorrectPayment();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        IPrizeConverter _converter,
        Randomness _randomness,
        address _rakeRecipient,
        address _jackpotStockToken,
        DeckEntry[] memory _deck,
        CardConfig[3] memory _cardConfigs,
        uint256 _dailyCap,
        address _owner
    ) {
        if (_deck.length == 0) revert EmptyDeck();

        converter = _converter;
        randomness = _randomness;
        rakeRecipient = _rakeRecipient;
        jackpotStockToken = _jackpotStockToken;
        dailyCap = _dailyCap;
        owner = _owner;
        currentDay = block.timestamp / 1 days;
        lastPurchaseTimestamp = block.timestamp;

        uint256 totalWeight = 0;
        for (uint256 i = 0; i < _deck.length; i++) {
            deck.push(_deck[i]);
            totalWeight += _deck[i].weightBps;
        }
        if (totalWeight != BPS_DENOM) revert InvalidDeckWeights();

        // Indices match CardType's declaration order (Penny, Classic,
        // Premium) exactly — there are only ever these 3 slots, since
        // CardType is a fixed enum a live contract can never grow. A new
        // price lineup (or a whole new tier) means a new deployment, same
        // as `deck` above — matching the no-owner ethos, this is set once
        // here and has no setter. Odds and payout multipliers stay global
        // `constant`s (not per-card, not parameterized here) — they're the
        // core probability math, and keeping them as plain constants means
        // every deployment's game math is visible in the bytecode/diff
        // itself rather than hidden in constructor calldata.
        cardConfigs[CardType.Penny] = _cardConfigs[0];
        cardConfigs[CardType.Classic] = _cardConfigs[1];
        cardConfigs[CardType.Premium] = _cardConfigs[2];
    }

    function deckSize() external view returns (uint256) {
        return deck.length;
    }

    function buy(CardType cardType) external payable nonReentrant returns (uint256 ticketId) {
        if (msg.value != cardConfigs[cardType].price) revert IncorrectPayment();
        ticketId = _buy(cardType);
    }

    /// Lets anyone buy by sending ETH directly to this contract with no calldata —
    /// no wallet-connect, no separate buy() call. CardType is inferred from the
    /// exact amount sent, since a plain transfer carries no calldata to specify it.
    /// Force-sent ETH (selfdestruct) doesn't trigger receive(), so it can't forge a ticket.
    receive() external payable nonReentrant {
        _buy(_cardTypeForValue(msg.value));
    }

    function _cardTypeForValue(uint256 value) internal view returns (CardType) {
        if (value == cardConfigs[CardType.Penny].price) return CardType.Penny;
        if (value == cardConfigs[CardType.Classic].price) return CardType.Classic;
        if (value == cardConfigs[CardType.Premium].price) return CardType.Premium;
        revert IncorrectPayment();
    }

    function _buy(CardType cardType) internal returns (uint256 ticketId) {
        CardConfig memory config = cardConfigs[cardType];

        _rollDailyCap();
        if (cardsSoldToday >= dailyCap) revert DailyCapReached();
        cardsSoldToday++;
        lastPurchaseTimestamp = block.timestamp;

        uint256 instantContribution = (uint256(config.price) * INSTANT_POOL_BPS) / BPS_DENOM;
        uint256 jackpotContribution = (uint256(config.price) * JACKPOT_BPS) / BPS_DENOM;
        uint256 floorAmount = (uint256(config.price) * FLOOR_BPS) / BPS_DENOM;
        uint256 rakeAmount = config.price - floorAmount - instantContribution - jackpotContribution;

        instantPool += instantContribution;
        jackpotPot += jackpotContribution;
        (bool rakeOk,) = rakeRecipient.call{value: rakeAmount}("");
        require(rakeOk, "rake transfer failed");

        ticketId = nextTicketId++;
        tickets[ticketId] = Ticket({player: msg.sender, cardType: cardType, stockToken: address(0), scratched: false});

        emit Bought(ticketId, msg.sender, cardType);

        randomness.request(ticketId);
    }

    /// Permissionless so any keeper can crank a reveal once randomness matures.
    /// This is where BOTH the instant-prize tier and the mystery stock pull
    /// resolve — the floor prize isn't paid until here either, so nothing
    /// about a ticket is known until it's scratched.
    function scratch(uint256 ticketId) external nonReentrant returns (Tier tier, address stockToken, uint256 payout) {
        Ticket storage ticket = tickets[ticketId];
        if (ticket.player == address(0)) revert TicketNotFound();
        if (ticket.scratched) revert AlreadyScratched();
        ticket.scratched = true;

        uint256 randomWord = randomness.fulfill(ticketId);
        CardConfig memory config = cardConfigs[ticket.cardType];

        tier = _resolveTier(randomWord % BPS_DENOM, config.jackpotEntries);
        stockToken = _pullStock(randomWord);
        ticket.stockToken = stockToken;

        if (tier == Tier.Jackpot) {
            payout = _payJackpot(ticketId, ticket.player, jackpotStockToken);
        } else if (tier != Tier.None) {
            payout = _payInstant(tier, config.price, ticket.player, stockToken);
        } else {
            uint256 floorAmount = (uint256(config.price) * FLOOR_BPS) / BPS_DENOM;
            _payout(stockToken, floorAmount, ticket.player);
            emit FloorPaid(ticketId, ticket.player, floorAmount, stockToken);
        }

        emit Scratched(ticketId, tier, stockToken, payout);
        if (payout > 0) emit Won(ticketId, ticket.player, tier, payout);
    }

    function _resolveTier(uint256 roll, uint8 jackpotEntries) internal pure returns (Tier) {
        uint256 threshold = 0;
        if (jackpotEntries > 0) {
            threshold += uint256(JACKPOT_ODDS_BPS) * jackpotEntries;
            if (roll < threshold) return Tier.Jackpot;
        }
        threshold += TEN_X_ODDS_BPS;
        if (roll < threshold) return Tier.TenX;
        threshold += FIVE_X_ODDS_BPS;
        if (roll < threshold) return Tier.FiveX;
        threshold += FOUR_X_ODDS_BPS;
        if (roll < threshold) return Tier.FourX;
        threshold += THREE_X_ODDS_BPS;
        if (roll < threshold) return Tier.ThreeX;
        threshold += TWO_X_ODDS_BPS;
        if (roll < threshold) return Tier.TwoX;
        threshold += ONE_X_ODDS_BPS;
        if (roll < threshold) return Tier.OneX;
        return Tier.None;
    }

    /// Reuses randomWord's next digit-range above the tier roll so one
    /// Randomness fulfillment resolves both the tier and the stock pull.
    function _pullStock(uint256 randomWord) internal view returns (address) {
        uint256 roll = (randomWord / BPS_DENOM) % BPS_DENOM;
        uint256 cumulative = 0;
        uint256 len = deck.length;
        for (uint256 i = 0; i < len; i++) {
            cumulative += deck[i].weightBps;
            if (roll < cumulative) return deck[i].token;
        }
        return deck[len - 1].token;
    }

    function _multiplierBpsForTier(Tier tier) internal pure returns (uint32) {
        if (tier == Tier.OneX) return ONE_X_MULTIPLIER_BPS;
        if (tier == Tier.TwoX) return TWO_X_MULTIPLIER_BPS;
        if (tier == Tier.ThreeX) return THREE_X_MULTIPLIER_BPS;
        if (tier == Tier.FourX) return FOUR_X_MULTIPLIER_BPS;
        if (tier == Tier.FiveX) return FIVE_X_MULTIPLIER_BPS;
        if (tier == Tier.TenX) return TEN_X_MULTIPLIER_BPS;
        return 0;
    }

    /// Flat multiple of ticket price, clamped to the instant pool's actual
    /// balance so a payout can never revert-strand a ticket — not a policy
    /// cap like the old %-of-pool design, just insolvency protection.
    function _payInstant(Tier tier, uint256 price, address player, address stockToken)
        internal
        returns (uint256 amount)
    {
        uint256 pool = instantPool;
        amount = (price * _multiplierBpsForTier(tier)) / BPS_DENOM;
        if (amount > pool) amount = pool;

        instantPool = pool - amount;
        _payout(stockToken, amount, player);
    }

    function _payJackpot(uint256 ticketId, address player, address stockToken) internal returns (uint256 amount) {
        uint256 pot = jackpotPot;
        amount = (pot * JACKPOT_PAYOUT_BPS) / BPS_DENOM;
        uint256 rolledOver = pot - amount;
        jackpotPot = rolledOver;

        _payout(stockToken, amount, player);
        emit JackpotHit(ticketId, player, amount, rolledOver);
        emit RolledOver(rolledOver);
    }

    function _payout(address stockToken, uint256 paymentAmount, address recipient) internal {
        if (paymentAmount == 0) return;
        converter.convert{value: paymentAmount}(stockToken, recipient);
    }

    function _rollDailyCap() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) {
            currentDay = today;
            cardsSoldToday = 0;
        }
    }

    function cardsRemainingToday() external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 sold = today != currentDay ? 0 : cardsSoldToday;
        return sold >= dailyCap ? 0 : dailyCap - sold;
    }

    /// Capacity dial, not a fairness lever — can't touch prices, odds, or
    /// payouts. Deliberately allows 0 (functionally a pause until raised
    /// again); see the dailyCap declaration above for why that's accepted.
    function setDailyCap(uint256 newCap) external {
        if (msg.sender != owner) revert NotOwner();
        emit DailyCapUpdated(dailyCap, newCap);
        dailyCap = newCap;
    }

    /// Permissionless top-up straight into the prize pools, split 50/50 —
    /// bypasses buy()/receive() entirely, so it can never be mistaken for a
    /// ticket purchase or mint a phantom ticket. Intended source: $SCRATCH's
    /// own Flap-native trading tax, routed here via TokenTaxRouter, but
    /// anyone can call this — strictly beneficial to players, never a way
    /// to extract value, so no access control is needed.
    function fundPools() external payable {
        uint256 instantShare = msg.value / 2;
        uint256 jackpotShare = msg.value - instantShare; // avoids losing a wei to rounding
        instantPool += instantShare;
        jackpotPot += jackpotShare;
        emit PoolsFunded(instantShare, jackpotShare);
    }

    /// Dead-game recovery: sweeps the full instant + jackpot balance to
    /// `owner`, but only once `WITHDRAW_INACTIVITY_PERIOD` has elapsed since
    /// the last ticket was bought. A live game (tickets selling within the
    /// window) can never be swept — this is not a pause/rug switch.
    function withdraw() external nonReentrant returns (uint256 amount) {
        if (msg.sender != owner) revert NotOwner();
        if (block.timestamp < lastPurchaseTimestamp + WITHDRAW_INACTIVITY_PERIOD) revert StillActive();

        amount = address(this).balance;
        instantPool = 0;
        jackpotPot = 0;

        (bool ok,) = owner.call{value: amount}("");
        require(ok, "withdraw transfer failed");
        emit Withdrawn(owner, amount);
    }
}
