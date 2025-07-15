// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "./TreasuryBase.sol";

contract Treasury is TreasuryBase {
    constructor(
        IERC20 asset,
        IAutomatorFactory factory_
    )
        TreasuryBase(asset, factory_)
    {}
}
