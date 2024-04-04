// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IUniswapV2Router.sol";
import "../interfaces/IERC20Burnable.sol";

contract FeeCollector is Ownable {
    address immutable public utilityToken;
    IUniswapV2Router immutable public router;
    uint256 public feeRate;

    constructor(address utilityToken_, uint256 feeRate_, IUniswapV2Router router_) {
        utilityToken = utilityToken_;
        feeRate = feeRate_;
        router = router_;
    }

    function approve(IERC20 token) external {
        require(token.approve(address(router), type(uint256).max), "Collector: approve failed");
    }

    function swapUtilityToken(address token, uint256 minPrice, address[] calldata path) external onlyOwner {
        // last element of path should be utilityToken
        require(path[path.length - 1] == utilityToken, "Collector: invalid path");
        require(path.length <= 4, "Collector: path too long");

        uint256 balance = IERC20(token).balanceOf(address(this));
        router.swapExactTokensForTokens(
            balance,
            balance * minPrice / 1e18,
            path,
            address(this),
            block.timestamp + 10 minutes
        );
    }

    function burnUtilityToken() external {
        IERC20Burnable(utilityToken).burn(IERC20(utilityToken).balanceOf(address(this)));
    }

    // set feeRate
    function setFeeRate(uint256 feeRate_) external onlyOwner {
        feeRate = feeRate_;
    }
}
