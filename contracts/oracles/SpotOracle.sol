// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract SpotOracle {
    mapping(uint256 => uint256) public settlePrices;
    AggregatorV3Interface immutable internal PRICEFEED;

    event Settled(uint256 expiry, uint256 settlePrice);

    constructor(
        AggregatorV3Interface priceFeed
    ) {
        PRICEFEED = priceFeed;
    }

    // settle price
    function settle() public {
        uint256 expiry = block.timestamp - block.timestamp % 86400 + 28800;
        require(settlePrices[expiry] == 0, "Oracle: already settled");
        settlePrices[expiry] = uint256(getLatestPrice());

        emit Settled(expiry, settlePrices[expiry]);
    }

    function getLatestPrice() internal view returns (int) {
        // prettier-ignore
        (
            /* uint80 roundID */,
            int price,
            /*uint startedAt*/,
            /*uint timeStamp*/,
            /*uint80 answeredInRound*/
        ) = PRICEFEED.latestRoundData();
        require(price > 0, "Oracle: invalid price");

        return price;
    }
}
