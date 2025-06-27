// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "./TreasuryBase.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IZenRCH {
    function mint(uint256 amount) external returns (uint256);
    function withdraw(address to, uint256 shares) external returns (uint256);
}

contract RCHTreasury is TreasuryBase {
    using SafeERC20 for IERC20;
    using Math for uint256;

    IERC20 public immutable rch;

    constructor(
        IERC20 rch_,
        IERC20 asset,
        IAutomatorFactory factory_
    )
        TreasuryBase(asset, factory_)
    {
        rch = rch_;
        rch.safeApprove(address(asset), type(uint256).max);
    }

    function deposit(uint256 amount, address receiver) public override nonReentrant returns (uint256 shares) {
        _burnPositions();
        rch.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 assets = IZenRCH(asset()).mint(amount);
        require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");
        shares = assets.mulDiv(totalSupply() + 10 ** _decimalsOffset(), totalAssets() + 1 - assets, Math.Rounding.Down);
        _mint(receiver, shares);
        
        emit Deposit(_msgSender(), receiver, amount, shares);
        return shares;
    }

    function mint(uint256, address) public pure override returns (uint256) {
        revert("RCHTreasury: minting is not supported, use deposit instead");
    }

    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert("RCHTreasury: withdrawing is not supported, use redeem instead");
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
        uint256 amount = IZenRCH(asset()).withdraw(receiver, assets);

        emit Withdraw(caller, receiver, owner, amount, shares);
    }
}
