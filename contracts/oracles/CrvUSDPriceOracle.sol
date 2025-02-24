// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IScrvUSD {
    function pricePerShare() external view returns (uint256);
}

interface IAutomator {
    function getPricePerShare() external view returns (uint256);
}

contract CrvUSDPriceOracle {
    IScrvUSD public scrvUSD;
    IAutomator public automator;

    constructor(address _scrvUSD, address _automator) {
        scrvUSD = IScrvUSD(_scrvUSD);
        automator = IAutomator(_automator);
    }

    function pricePerShare() external view returns (uint256) {
        return scrvUSD.pricePerShare() * automator.getPricePerShare() / 1e18;
    }
}
