import { expect } from "chai";
import { ethers } from "hardhat";
import { constants, BigNumber } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
const { parseEther, keccak256, solidityKeccak256, solidityPack, toUtf8Bytes } = ethers.utils;

describe("HlOracle", function () {
  async function deployFixture() {
    // Deploy mock chainlink contract
    const Aggregator = await ethers.getContractFactory("MockAutomatedFunctionsConsumer");
    const aggregator = await Aggregator.deploy();

    // view
    const Oracle = await ethers.getContractFactory("HlOracle");
    const oracle = await Oracle.deploy(
      aggregator.address,
    );

    return { oracle, aggregator };
  }

  it("should work", async function () {
    const { oracle, aggregator } = await loadFixture(deployFixture);

    await expect(oracle.checkUpkeep('0x')).to.be.revertedWith('Oracle: not updated');
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
    // return [ true, '0x']
    expect(await oracle.checkUpkeep('0x')).to.deep.equal([ true, '0x' ]);
    await expect(oracle.performUpkeep('0x')).to.emit(oracle, 'Settled');
  });

  it("should assign prices for missed days correctly", async function () {
    const { oracle, aggregator } = await loadFixture(deployFixture);
    //30000, 32000
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
    expect(await oracle.checkUpkeep('0x')).to.deep.equal([ true, '0x' ]);
    await expect(oracle.performUpkeep('0x')).to.emit(oracle, 'Settled');

    // Move time forward by 3 days
    await ethers.provider.send("evm_increaseTime", [3 * 86400]);
    await ethers.provider.send("evm_mine", []);

    const latestExpiryUpdated0 = await oracle.latestExpiryUpdated();

    //27000, 35000
    await aggregator.setLatestResponse("0x0000000000000000000000000000000000000000000005b7ac4553de7ae000000000000000000000000000000000000000000000000007695a92c20d6fe00000");
    expect(await oracle.checkUpkeep('0x')).to.deep.equal([ true, '0x' ]);
    await expect(oracle.performUpkeep('0x')).to.emit(oracle, 'Settled');

    for (let i = 1; i < 3; i++) {
      const missedExpiry = latestExpiryUpdated0.toNumber() + i * 86400;
      const missedPrice0 = await oracle.settlePrices(missedExpiry, 0);
      const missedPrice1 = await oracle.settlePrices(missedExpiry, 1);

      expect(missedPrice0).to.be.equal(parseEther((30000-1000*i).toString()));
      expect(missedPrice1).to.be.equal(parseEther((32000+1000*i).toString()));
    }
    const latestExpiryUpdated1 = await oracle.latestExpiryUpdated();
    expect(latestExpiryUpdated1).to.be.equal(latestExpiryUpdated0.toNumber() + 3 * 86400);
    const settlePrice0 = await oracle.settlePrices(latestExpiryUpdated1, 0);
    const settlePrice1 = await oracle.settlePrices(latestExpiryUpdated1, 1);
    expect(settlePrice0).to.be.equal(parseEther('27000'));
    expect(settlePrice1).to.be.equal(parseEther('35000'));
  });
});
