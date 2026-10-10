// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title NectarV2 — same-asset lending with REAL borrow interest.
/// v2 fixes vs v1: BORROW_RATE is actually charged (time-weighted simple APR,
/// capitalized into principal on repay/borrow); collected interest self-funds
/// lender rewards pro-rata (no underfunding possible); owner pause switch;
/// dead borrowTimestamp/accrueRewards vestiges removed.
contract NectarV2 is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable botToken;
    IERC20 public immutable lendToken;

    uint256 public constant COLLATERAL_FACTOR = 75;
    uint256 public constant LIQUIDATION_THRESHOLD = 80;
    uint256 public constant BORROW_RATE = 5; // 5% simple APR on outstanding debt

    uint256 public totalDeposits;
    uint256 public totalBorrows; // principal only (accrued interest capitalizes on touch)
    uint256 public totalInterestCollected;
    uint256 public rewardIndex; // cumulative collected interest per 1e18 deposit units

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public borrows;
    mapping(address => uint256) public borrowTimestamp;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public claimableRewards;

    bool public paused;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount);
    event Repay(address indexed user, uint256 amount, uint256 interestPaid);
    event Liquidate(address indexed borrower, address indexed liquidator, uint256 debt, uint256 seized);
    event RewardClaimed(address indexed user, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    constructor(address _botToken, address _lendToken) Ownable(msg.sender) {
        require(_botToken != address(0) && _lendToken != address(0), "Zero token");
        botToken = IERC20(_botToken);
        lendToken = IERC20(_lendToken);
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    function borrowInterest(address user) public view returns (uint256) {
        if (borrows[user] == 0) return 0;
        return borrows[user] * BORROW_RATE * (block.timestamp - borrowTimestamp[user]) / 100 / 365 days;
    }

    function debtOf(address user) public view returns (uint256) {
        return borrows[user] + borrowInterest(user);
    }

    function pendingLenderReward(address user) public view returns (uint256) {
        uint256 acc = deposits[user] * rewardIndex / 1e18;
        uint256 extra = acc > rewardDebt[user] ? acc - rewardDebt[user] : 0;
        return claimableRewards[user] + extra;
    }

    function _updateReward(address user) internal {
        uint256 acc = deposits[user] * rewardIndex / 1e18;
        if (acc > rewardDebt[user]) claimableRewards[user] += acc - rewardDebt[user];
        rewardDebt[user] = deposits[user] * rewardIndex / 1e18;
    }

    function _distribute(uint256 interest) internal {
        totalInterestCollected += interest;
        if (totalDeposits > 0) rewardIndex += interest * 1e18 / totalDeposits;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be > 0");
        botToken.safeTransferFrom(msg.sender, address(this), amount);
        _updateReward(msg.sender);
        deposits[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        _updateReward(msg.sender);
        require(debtOf(msg.sender) <= (deposits[msg.sender] - amount) * COLLATERAL_FACTOR / 100, "Would exceed collateral");
        deposits[msg.sender] -= amount;
        totalDeposits -= amount;
        botToken.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    function borrow(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "Amount must be > 0");
        uint256 interest = borrowInterest(msg.sender);
        if (interest > 0) {
            borrows[msg.sender] += interest;
            totalBorrows += interest;
        }
        borrowTimestamp[msg.sender] = block.timestamp;
        require(borrows[msg.sender] + amount <= deposits[msg.sender] * COLLATERAL_FACTOR / 100, "Exceeds collateral");
        borrows[msg.sender] += amount;
        totalBorrows += amount;
        lendToken.safeTransfer(msg.sender, amount);
        emit Borrow(msg.sender, amount);
    }

    function repay(uint256 amount) external whenNotPaused nonReentrant {
        uint256 interest = borrowInterest(msg.sender);
        uint256 owed = borrows[msg.sender] + interest;
        require(amount > 0 && amount <= owed, "Bad amount");
        uint256 payInterest = amount < interest ? amount : interest;
        borrows[msg.sender] = owed - amount; // unpaid interest capitalizes automatically
        totalBorrows = totalBorrows + interest - amount;
        borrowTimestamp[msg.sender] = block.timestamp;
        lendToken.safeTransferFrom(msg.sender, address(this), amount);
        if (payInterest > 0) _distribute(payInterest);
        emit Repay(msg.sender, amount, payInterest);
    }

    function liquidate(address borrower) external whenNotPaused nonReentrant {
        uint256 debt = debtOf(borrower);
        uint256 collateral = deposits[borrower];
        require(debt > 0, "No debt");
        uint256 threshold = collateral * LIQUIDATION_THRESHOLD / 100;
        require(debt > threshold, "Not liquidatable");
        uint256 seize = debt * 110 / 100;
        require(seize <= collateral, "Seize exceeds collateral");
        uint256 interest = debt - borrows[borrower];
        _updateReward(borrower);
        deposits[borrower] -= seize;
        totalDeposits -= seize;
        totalBorrows -= borrows[borrower];
        borrows[borrower] = 0;
        borrowTimestamp[borrower] = 0;
        lendToken.safeTransferFrom(msg.sender, address(this), debt);
        botToken.safeTransfer(msg.sender, seize);
        if (interest > 0) _distribute(interest);
        emit Liquidate(borrower, msg.sender, debt, seize);
    }

    function claimLenderReward() external whenNotPaused nonReentrant {
        _updateReward(msg.sender);
        uint256 amt = claimableRewards[msg.sender];
        require(amt > 0, "Nothing to claim");
        claimableRewards[msg.sender] = 0;
        lendToken.safeTransfer(msg.sender, amt);
        emit RewardClaimed(msg.sender, amt);
    }

    function getHealthFactor(address user) public view returns (uint256) {
        if (debtOf(user) == 0) return type(uint256).max;
        return deposits[user] * 100 / debtOf(user);
    }
}
