// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IMerkleAirdrop {
    function isClaimed(uint256[] calldata indexes) external view returns (bool[] memory);
    function claimMultiple(uint256[] calldata indexes, uint256[] calldata amounts, bytes32[][] calldata merkleProofs) external;
}

contract StRCH is Context, Ownable {
    using SafeERC20 for IERC20;

    uint256 public totalShares;
    uint256 public interestRate = 3e16; //1e18
    uint256 public accRewardsPerShare; //1e18
    uint256 public lastRewardsUpdateTimestamp;

    mapping(address => bool) private _vaults;
    mapping(address => uint256) private _shares;
    mapping(address => uint256) public userAccRewards;

    IERC20 public constant RCH = IERC20(0x57B96D4aF698605563A4653D882635da59Bf11AF);
    IMerkleAirdrop public constant AIRDROP = IMerkleAirdrop(0x5a8cDDa6CA37B284b32eF8D513Ef71Ddac553270);

    event Mint(address indexed account, uint256 amount, uint256 rewards);
    event Burn(address indexed from, address to, uint256 amount, uint256 rewards);
    event InterestRateUpdated(uint256 oldInterestRate, uint256 newInterestRate);

    modifier onlyVault() {
        require(_vaults[_msgSender()], "StRCH: caller is not a vault");
        _;
    }

    constructor() {
        lastRewardsUpdateTimestamp = block.timestamp;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _shares[account] + _pendingRewards(account);
    }

    function mint(uint256 amount) external onlyVault {
        _mint(_msgSender(), amount);
    }

    function _mint(address account, uint256 amount) internal {
        _updateRewards();
        uint256 pendingRewards = _shares[_msgSender()] * accRewardsPerShare / 1e18 - userAccRewards[_msgSender()];

        RCH.safeTransferFrom(account, address(this), amount);
        _mintShares(_msgSender(), pendingRewards + amount);
        userAccRewards[_msgSender()] = _shares[_msgSender()]  * accRewardsPerShare / 1e18;

        emit Mint(account, amount, pendingRewards);
    }

    function _mintShares(address account, uint256 sharesAmount) internal {
        totalShares = totalShares + sharesAmount;
        _shares[account] = _shares[account] + sharesAmount;
    }

    function withdraw(address to, uint256 amount) external onlyVault {
        _burnFrom(_msgSender(), to, amount);
    }

    function _burnFrom(address from, address to, uint256 amount) internal {
        require(RCH.balanceOf(address(this)) >= amount, "StRCH: insufficient rewards");

        _updateRewards();
        uint256 pendingRewards = _shares[from] * accRewardsPerShare / 1e18 - userAccRewards[from];

        require(_shares[from] + pendingRewards >= amount, "StRCH: insufficient balance");
        if (pendingRewards > amount) {
            _mintShares(from, pendingRewards - amount);
        } else if (pendingRewards < amount) {
            _burnShares(from, amount - pendingRewards);
        }
        userAccRewards[from] = _shares[from] * accRewardsPerShare / 1e18;
        RCH.safeTransfer(to, amount);

        emit Burn(from, to, amount, pendingRewards);
    }

    function _burnShares(address account, uint256 amount) internal {
        totalShares = totalShares - amount;
        _shares[account] = _shares[account] - amount;
    }

    function _updateRewards() internal {
        require(lastRewardsUpdateTimestamp < block.timestamp, "StRCH: rewards already updated");
        uint256 rewards = _calculateRewards();
        accRewardsPerShare = accRewardsPerShare + rewards * 1e18 / totalShares;
        lastRewardsUpdateTimestamp = block.timestamp;
    }

    function _calculateRewards() internal view returns (uint256) {
        uint256 timePassed = block.timestamp - lastRewardsUpdateTimestamp;
        return totalShares * interestRate * timePassed / 365 days / 1e18;
    }

    function _pendingRewards(address account) internal view returns (uint256) {
        uint256 newAccRewardsPerShare = accRewardsPerShare + _calculateRewards() * 1e18 / totalShares;
        return _shares[account] * newAccRewardsPerShare / 1e18 - userAccRewards[account];
    }

    function enableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            _vaults[vaults_[i]] = true;
        }
    }

    function disableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            _vaults[vaults_[i]] = false;
        }
    }

    function updateInterestRate(uint256 newInterestRate) external onlyOwner {
        _updateRewards();
        uint256 oldInterestRate = interestRate;
        interestRate = newInterestRate;
        emit InterestRateUpdated(oldInterestRate, newInterestRate);
    }

    function interestIsClaimed(uint256[] calldata indexes) external view returns (bool[] memory) {
        return AIRDROP.isClaimed(indexes);
    }

    function claimInterest(
        uint256[] calldata indexes,
        uint256[] calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external {
        AIRDROP.claimMultiple(indexes, amounts, merkleProofs);
    }
}
