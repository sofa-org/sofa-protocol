// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "./TreasuryBase.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IAToken} from "@aave/core-v3/contracts/interfaces/IAToken.sol";

contract AAVETreasury is TreasuryBase {
    using SafeERC20 for IERC20;

    IPool public immutable pool;
    IAToken public immutable aToken;
    uint16 private constant REFERRAL_CODE = 0;

    constructor(
        IERC20 asset,
        IPool aavePool,
        IAutomatorFactory factory_
    )
        TreasuryBase(asset, factory_)
    {
        pool = aavePool;
        aToken = IAToken(pool.getReserveData(address(asset)).aTokenAddress);
        asset.safeApprove(address(pool), type(uint256).max);
    }

    function mintPosition(uint256 expiry, uint256[2] calldata anchorPrices, uint256 amount, address maker) external override nonReentrant onlyVaults {
        require(factory.makers(maker), "Treasury: signer is not a maker");
        uint256 index = pool.getReserveNormalizedIncome(address(asset())); // ray
        uint256 scaled = (amount * 1e27) / index;
        require(scaled > 0, "Treasury: scaled amount must be greater than zero");
        bytes32 id = keccak256(abi.encodePacked(msg.sender, expiry, anchorPrices));
        if (_positions[id].amount == 0) {
            _positions[id].vault = msg.sender;
            _positions[id].expiry = expiry;
            _positions[id].anchorPrices = anchorPrices;
            expiries[expiry].push(id);
        }
        _positions[id].amount += scaled;
        totalPositions += scaled;
        if (minExpiry == 0 || expiry < minExpiry) {
            minExpiry = expiry;
        }
        IERC20(address(aToken)).safeTransfer(msg.sender, amount);
    }

    function mint(uint256, address) public pure override returns (uint256) {
        revert("AAVETreasury: minting shares is not supported");
    }

    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert("AAVETreasury: withdrawing assets is not supported, use redeem instead");
    }

    function maxMint(address) public pure override returns (uint256) {
        return 0;
    }

    function maxWithdraw(address) public pure override returns (uint256) {
        return 0;
    }

    function previewMint(uint256) public pure override returns (uint256) {
        return 0;
    }

    function previewWithdraw(uint256) public pure override returns (uint256) {
        return 0;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        pool.supply(
            address(asset()),
            assets,
            address(this),
            REFERRAL_CODE
        );
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        uint256 amount = pool.withdraw(
            address(asset()),
            totalSupply() > 0 ? assets - assets / 100 : assets,
            receiver
        );

        emit Withdraw(caller, receiver, owner, amount, shares);
    }

    function totalAssets() public view override returns (uint256) {
        uint256 index = pool.getReserveNormalizedIncome(address(asset())); // ray
        return aToken.balanceOf(address(this)) + totalPositions * index / 1e27;
    }
}