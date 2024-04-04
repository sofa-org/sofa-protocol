// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

interface IFeeCollector {
    function feeRate() external view returns (uint256);
}
