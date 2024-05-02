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
});
