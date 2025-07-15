// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

interface ITreasury {
    function mintPosition(uint256 expiry, uint256[2] calldata anchorPrices, uint256 amount, address maker) external;
}
