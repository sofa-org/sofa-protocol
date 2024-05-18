// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract SpotOracle {
    mapping(uint256 => uint256) public settlePrices;
    AggregatorV3Interface immutable internal PRICEFEED;
    uint256 private latestExpiryUpdated = 0;

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

        uint256 currentPrice = uint256(getLatestPrice());
        if (latestExpiryUpdated != 0 && latestExpiryUpdated < expiry - 86400 * 2) {
            uint256 missedDays = (expiry - latestExpiryUpdated) / 86400;
            uint256 startPrice = settlePrices[latestExpiryUpdated];

            for (uint256 i = 1; i < missedDays; i++) {
                uint256 missedExpiry = latestExpiryUpdated + i * 86400;
                uint256 missedDayPrice = startPrice + (currentPrice - startPrice) * i / missedDays;
                settlePrices[missedExpiry] = missedDayPrice;
                emit Settled(missedExpiry, missedDayPrice);
            }
        }

        settlePrices[expiry] = currentPrice;
        latestExpiryUpdated = expiry;

        emit Settled(expiry, currentPrice);
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
