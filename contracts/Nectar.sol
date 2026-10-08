// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Nectar is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable botToken;
    IERC20 public immutable lendToken;

    uint256 public constant COLLATERAL_FACTOR = 75;
    uint256 public constant LIQUIDATION_THRESHOLD = 80;
    uint256 public constant BORROW_RATE = 5;
    uint256 public constant REWARD_RATE = 2;

    uint256 public totalDeposits;
    uint256 public totalBorrows;
    uint256 public lastRewardUpdate;

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public borrows;
    mapping(address => uint256) public borrowTimestamp;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount);
    event Repay(address indexed user, uint256 amount);
    event Liquidate(address indexed borrower, address indexed liquidator, uint256 amount);

    constructor(address _botToken, address _lendToken) Ownable(msg.sender) {
        botToken = IERC20(_botToken);
        lendToken = IERC20(_lendToken);
        lastRewardUpdate = block.timestamp;
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        botToken.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        totalDeposits += amount;
        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        uint256 maxBorrow = (deposits[msg.sender] - amount) * COLLATERAL_FACTOR / 100;
        require(borrows[msg.sender] <= maxBorrow, "Would exceed collateral");
        deposits[msg.sender] -= amount;
        totalDeposits -= amount;
        botToken.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        uint256 maxBorrow = deposits[msg.sender] * COLLATERAL_FACTOR / 100;
        require(borrows[msg.sender] + amount <= maxBorrow, "Exceeds collateral");
        borrows[msg.sender] += amount;
        totalBorrows += amount;
        borrowTimestamp[msg.sender] = block.timestamp;
        lendToken.safeTransfer(msg.sender, amount);
        emit Borrow(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(borrows[msg.sender] >= amount, "Repay exceeds borrow");
        lendToken.safeTransferFrom(msg.sender, address(this), amount);
        borrows[msg.sender] -= amount;
        totalBorrows -= amount;
        emit Repay(msg.sender, amount);
    }

    function liquidate(address borrower) external nonReentrant {
        uint256 collateral = deposits[borrower];
        uint256 debt = borrows[borrower];
        require(debt > 0, "No debt");
        uint256 threshold = collateral * LIQUIDATION_THRESHOLD / 100;
        require(debt > threshold, "Not liquidatable");
        uint256 seize = debt * 110 / 100;
        require(seize <= collateral, "Seize exceeds collateral");
        deposits[borrower] -= seize;
        borrows[borrower] = 0;
        totalDeposits -= seize;
        lendToken.safeTransferFrom(msg.sender, address(this), debt);
        botToken.safeTransfer(msg.sender, seize);
        emit Liquidate(borrower, msg.sender, seize);
    }

    function getHealthFactor(address user) public view returns (uint256) {
        if (borrows[user] == 0) return type(uint256).max;
        return deposits[user] * 100 / borrows[user];
    }

    function accrueRewards() external {
        uint256 timeElapsed = block.timestamp - lastRewardUpdate;
        if (timeElapsed == 0 || totalDeposits == 0) return;
        uint256 reward = totalDeposits * REWARD_RATE * timeElapsed / 100 / 365 days;
        lastRewardUpdate = block.timestamp;
    }
}
