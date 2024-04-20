// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IERC20Burnable.sol";

contract FeeCollector is Ownable {
    using SafeERC20 for IERC20;

    address immutable public rch;
    address immutable public routerV2;
    address immutable public routerV3;
    uint256 public feeRate;

    constructor(
        address rch_,
        uint256 feeRate_,
        address routerV2_,
        address routerV3_
    ) {
        rch = rch_;
        feeRate = feeRate_;
        routerV2 = routerV2_;
        routerV3 = routerV3_;
    }

    function approve(IERC20 token, address router) external {
        require(router == routerV2 || router == routerV3, "Collector: invalid router");
        token.safeApprove(router, type(uint256).max);
    }

    function swapRCH(
        address token,
        uint256 minPrice,
        address[] calldata path
    ) external onlyOwner {
        // last element of path should be rch
        require(path.length <= 4, "Collector: path too long");
        require(path[path.length - 1] == rch, "Collector: invalid path");

        uint256 amountIn = IERC20(token).balanceOf(address(this));
        IUniswapV2Router(routerV2).swapExactTokensForTokens(
            amountIn,
            amountIn * minPrice / 1e18,
            path,
            address(this),
            block.timestamp + 10 minutes
        );
    }

    function swapRCH(
        address token,
        uint256 minPrice,
        bytes calldata path
    ) external onlyOwner {
        uint256 balanceBefore = IERC20(rch).balanceOf(address(this));
        uint256 amountIn = IERC20(token).balanceOf(address(this));
        ISwapRouter.ExactInputParams memory params =
            ISwapRouter.ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: block.timestamp + 10 minutes,
                amountIn: amountIn,
                amountOutMinimum: amountIn * minPrice / 1e18
           });
        uint256 amountOut = ISwapRouter(routerV3).exactInput(params);
        uint256 balanceAfter = IERC20(rch).balanceOf(address(this));
        require(balanceAfter == balanceBefore + amountOut, "Collector: invalid path");
    }

    function burnRCH() external {
        IERC20Burnable(rch).burn(IERC20(rch).balanceOf(address(this)));
    }

    // set feeRate
    function setFeeRate(uint256 feeRate_) external onlyOwner {
        feeRate = feeRate_;
    }
}
