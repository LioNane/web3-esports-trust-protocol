// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @title TournamentEscrow
/// @notice Local classroom simulation of one free-entry esports tournament.
/// @dev Credits are bookkeeping entries, not Ether or transferable tokens. Hashes
/// commit to supplied information; they do not verify gameplay or real payment.
contract TournamentEscrow {
    enum Phase {
        Registration,
        Active,
        Proposed,
        Challenged,
        Reviewed,
        Finalized,
        Settled,
        Cancelled
    }

    error LocalNetworkOnly();
    error InvalidConfiguration();
    error Unauthorized();
    error WrongPhase(Phase actual);
    error InvalidReference();
    error AlreadyJoined();
    error RoleCannotJoin();
    error FundingAlreadyLocked();
    error FundingNotLocked();
    error NotEnoughParticipants();
    error InvalidPodium();
    error NotParticipant();
    error ChallengeWindowClosed();
    error ChallengeWindowOpen();

    event TournamentConfigured(
        address indexed organizer,
        bytes32 indexed rulesHash,
        uint256 prizePool,
        uint64 challengePeriod
    );
    event ParticipantJoined(address indexed participant);
    event FundingLocked(bytes32 indexed fundingReference, uint256 credits);
    event EventStarted(uint256 participantCount);
    event ResultPosted(address[3] podium, bytes32 indexed evidenceHash, uint256 challengeDeadline);
    event ChallengeOpened(address indexed challenger, bytes32 indexed challengeHash);
    event ChallengeResolved(address[3] podium, bytes32 indexed decisionHash);
    event PrizeAwarded(address indexed recipient, uint8 place, uint256 credits);
    event AwardsFinalized(uint256 totalCredits);
    event SettlementRecorded(bytes32 indexed receiptHash);
    event EventCancelled(address indexed cancelledBy, bytes32 indexed reasonHash, uint256 returnedCredits);

    address public immutable organizer;
    address public immutable sponsor;
    address public immutable resultReporter;
    address public immutable reviewer;
    address public immutable receiptReporter;
    bytes32 public immutable rulesHash;
    uint256 public immutable prizePool;
    uint64 public immutable challengePeriod;

    Phase public phase;
    uint256 public sponsorCredits;
    uint256 public reservedCredits;
    uint256 public totalAwardedCredits;
    uint256 public participantCount;
    uint256 public challengeDeadline;
    address public challenger;
    bytes32 public fundingReference;
    bytes32 public evidenceHash;
    bytes32 public challengeHash;
    bytes32 public decisionHash;
    bytes32 public receiptHash;
    address[3] public originalPodium;
    address[3] public awardPodium;
    mapping(address => bool) public isParticipant;
    mapping(address => uint256) public awardCredits;

    /// @notice Set fixed roles, rules and mock prize credits before registration.
    /// @dev A chain ID check prevents ordinary mainnet deployment, but is not proof
    /// that a network is local. Use only the classroom Hardhat network.
    constructor(
        address sponsor_,
        address resultReporter_,
        address reviewer_,
        address receiptReporter_,
        bytes32 rulesHash_,
        uint256 prizePool_,
        uint64 challengePeriod_
    ) {
        if (block.chainid != 31337) revert LocalNetworkOnly();
        if (
            rulesHash_ == bytes32(0) || prizePool_ == 0 || prizePool_ % 10 != 0
                || challengePeriod_ == 0 || challengePeriod_ > 7 days
        ) revert InvalidConfiguration();

        address[5] memory roles = [msg.sender, sponsor_, resultReporter_, reviewer_, receiptReporter_];
        for (uint256 i = 0; i < roles.length; ++i) {
            if (roles[i] == address(0)) revert InvalidConfiguration();
            for (uint256 j = 0; j < i; ++j) {
                if (roles[i] == roles[j]) revert InvalidConfiguration();
            }
        }

        organizer = msg.sender;
        sponsor = sponsor_;
        resultReporter = resultReporter_;
        reviewer = reviewer_;
        receiptReporter = receiptReporter_;
        rulesHash = rulesHash_;
        prizePool = prizePool_;
        challengePeriod = challengePeriod_;
        sponsorCredits = prizePool_;

        emit TournamentConfigured(msg.sender, rulesHash_, prizePool_, challengePeriod_);
    }

    /// @notice Register as a player without paying an entry fee.
    function join() external {
        _requirePhase(Phase.Registration);
        if (
            msg.sender == organizer || msg.sender == sponsor || msg.sender == resultReporter
                || msg.sender == reviewer || msg.sender == receiptReporter
        ) revert RoleCannotJoin();
        if (isParticipant[msg.sender]) revert AlreadyJoined();

        isParticipant[msg.sender] = true;
        ++participantCount;
        emit ParticipantJoined(msg.sender);
    }

    /// @notice Reserve the fixed pool of simulated credits before play begins.
    function lockFunding(bytes32 fundingReference_) external {
        _requireRole(sponsor);
        _requirePhase(Phase.Registration);
        if (reservedCredits != 0) revert FundingAlreadyLocked();
        _requireReference(fundingReference_);

        fundingReference = fundingReference_;
        reservedCredits = sponsorCredits;
        sponsorCredits = 0;
        emit FundingLocked(fundingReference_, reservedCredits);
    }

    /// @notice Close registration once funding and three distinct players exist.
    function startEvent() external {
        _requireRole(organizer);
        _requirePhase(Phase.Registration);
        if (reservedCredits != prizePool) revert FundingNotLocked();
        if (participantCount < 3) revert NotEnoughParticipants();

        phase = Phase.Active;
        emit EventStarted(participantCount);
    }

    /// @notice Record a proposed top three and start the fixed challenge window.
    /// @dev The reporter's transaction authenticates the reporting account only.
    function postResult(address[3] calldata podium, bytes32 evidenceHash_) external {
        _requireRole(resultReporter);
        _requirePhase(Phase.Active);
        _requireReference(evidenceHash_);
        _requireValidPodium(podium);

        originalPodium = podium;
        awardPodium = podium;
        evidenceHash = evidenceHash_;
        challengeDeadline = block.timestamp + challengePeriod;
        phase = Phase.Proposed;
        emit ResultPosted(podium, evidenceHash_, challengeDeadline);
    }

    /// @notice Open the prototype's single review case before the deadline.
    function challenge(bytes32 challengeHash_) external {
        _requirePhase(Phase.Proposed);
        if (!isParticipant[msg.sender]) revert NotParticipant();
        if (block.timestamp >= challengeDeadline) revert ChallengeWindowClosed();
        _requireReference(challengeHash_);

        challenger = msg.sender;
        challengeHash = challengeHash_;
        phase = Phase.Challenged;
        emit ChallengeOpened(msg.sender, challengeHash_);
    }

    /// @notice Uphold or revise the ranking while preserving the original result.
    function resolveChallenge(address[3] calldata podium, bytes32 decisionHash_) external {
        _requireRole(reviewer);
        _requirePhase(Phase.Challenged);
        _requireReference(decisionHash_);
        _requireValidPodium(podium);

        awardPodium = podium;
        decisionHash = decisionHash_;
        phase = Phase.Reviewed;
        emit ChallengeResolved(podium, decisionHash_);
    }

    /// @notice Allocate all reserved credits 50/30/20 after the original deadline.
    /// @dev Anyone may trigger this fixed calculation. An open challenge blocks it.
    function finalizeAwards() external {
        if (phase != Phase.Proposed && phase != Phase.Reviewed) revert WrongPhase(phase);
        if (block.timestamp < challengeDeadline) revert ChallengeWindowOpen();
        if (reservedCredits != prizePool) revert FundingNotLocked();

        uint256 unit = reservedCredits / 10;
        uint256[3] memory shares = [5 * unit, 3 * unit, 2 * unit];
        totalAwardedCredits = reservedCredits;
        reservedCredits = 0;
        phase = Phase.Finalized;

        for (uint8 i = 0; i < 3; ++i) {
            address recipient = awardPodium[i];
            awardCredits[recipient] = shares[i];
            emit PrizeAwarded(recipient, i + 1, shares[i]);
        }
        emit AwardsFinalized(totalAwardedCredits);
    }

    /// @notice Record a mock receipt once. This does not transfer or verify funds.
    function recordSettlement(bytes32 receiptHash_) external {
        _requireRole(receiptReporter);
        _requirePhase(Phase.Finalized);
        _requireReference(receiptHash_);

        receiptHash = receiptHash_;
        phase = Phase.Settled;
        emit SettlementRecorded(receiptHash_);
    }

    /// @notice End an event and release any reserved credits back to the sponsor.
    /// @dev The organizer can cancel before play. The reviewer can cancel an
    /// active or challenged event. An award already approved cannot be reversed.
    function cancelEvent(bytes32 reasonHash) external {
        if (phase == Phase.Registration) {
            _requireRole(organizer);
        } else if (phase == Phase.Active || phase == Phase.Challenged) {
            _requireRole(reviewer);
        } else {
            revert WrongPhase(phase);
        }
        _requireReference(reasonHash);

        uint256 returnedCredits = reservedCredits;
        reservedCredits = 0;
        sponsorCredits += returnedCredits;
        phase = Phase.Cancelled;
        emit EventCancelled(msg.sender, reasonHash, returnedCredits);
    }

    function _requireRole(address expected) private view {
        if (msg.sender != expected) revert Unauthorized();
    }

    function _requirePhase(Phase expected) private view {
        if (phase != expected) revert WrongPhase(phase);
    }

    function _requireReference(bytes32 value) private pure {
        if (value == bytes32(0)) revert InvalidReference();
    }

    function _requireValidPodium(address[3] calldata podium) private view {
        if (
            podium[0] == podium[1] || podium[0] == podium[2] || podium[1] == podium[2]
                || !isParticipant[podium[0]] || !isParticipant[podium[1]] || !isParticipant[podium[2]]
        ) revert InvalidPodium();
    }
}
