import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { constants, BigNumber, BigNumberish } from "ethers";
import {
    SignatureTransfer,
    PermitTransferFrom,
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import bn from 'bignumber.js';
const { parseEther, keccak256, solidityKeccak256, solidityPack, toUtf8Bytes } = ethers.utils;
import { mint } from "../helpers/helpers";

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

describe("FeeCollector", function () {
  async function deployFixture() {
    // Permit2
    const permit2 = await ethers.getContractAt("IPermit2", PERMIT2_ADDRESS);

    // mock weth
    const WETH = await ethers.getContractFactory("MockWETH9");
    const weth = await WETH.deploy();

    // mock collateral contract
    const Collateral = await ethers.getContractFactory("MockERC20Mintable");
    const collateral = await Collateral.deploy(
      "COLLATERAL",
      "COL",
      18
    );

    // tomorrow timestmap
    const tradingStartTime = Math.floor(new Date().getTime() / 1000 + 60 * 60 * 24); // 1 day later
    // rch contract
    const RCH = await ethers.getContractFactory("RCH");
    const rch = await RCH.deploy(tradingStartTime);

    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("DNT");
    const strategy = await Strategy.deploy();

    // Deploy mock chainlink contract
    const Aggregator = await ethers.getContractFactory("MockAutomatedFunctionsConsumer");
    const aggregator = await Aggregator.deploy();
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");

    // Deploy DNTVault contract
    const Vault = await ethers.getContractFactory("DNTVault");

    const [owner, minter, maker, referral, lp] = await ethers.getSigners();
    collateral.mint(minter.address, parseEther("100000"));
    collateral.mint(maker.address, parseEther("100000"));
    collateral.mint(lp.address, parseEther("100000"));
    collateral.mint(owner.address, parseEther("100000"));

    await collateral.connect(minter).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max

    // view
    const Oracle = await ethers.getContractFactory("HlOracle");
    const oracle = await Oracle.deploy(
      aggregator.address,
    );
    const FeeCollector = await ethers.getContractFactory("FeeCollector");
    const feeCollector = await FeeCollector.deploy(
      parseEther("0.01"), // Mock fee rate 1%
      parseEther("0.01"), // Mock fee rate 1%
    );

    const vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      PERMIT2_ADDRESS, // Mock permit contract
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
      collateral.address,
      feeCollector.address,
      oracle.address
    ]);
    const eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max

    return { vault, collateral, feeCollector, weth, rch, aggregator, oracle, referral, owner, maker, minter, eip721Domain };
  }

  it("should burn utility token", async function () {
    const { vault, feeCollector, collateral, aggregator, oracle, owner, minter, maker, referral, eip721Domain } = await loadFixture(deployFixture);
    const totalCollateral = parseEther("100");
    let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
    let anchorPrices = [parseEther("28000"), parseEther("30000")];
    const makerCollateral = parseEther("10");
    let deadline = await time.latest() + 600;
    let minterNonce = await time.latest();

    await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

    // Test variables
    let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
    let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
    let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);

    await time.increaseTo(expiry);
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
    await oracle.settle();
    await vault.connect(minter).burn(term, expiry, anchorPrices, 0);
    await vault.connect(maker).burn(term, expiry, anchorPrices, 1);

    expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
    deadline = await time.latest() + 600;

    // withdraw fee
    expect(await vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("2"));

    await expect(feeCollector.connect(minter).collect(collateral.address)).to.be.revertedWith("FeeCollector: unauthorized");
    expect(await feeCollector.collect(collateral.address)).to.changeTokenBalance(collateral, owner, parseEther("2"));
    await expect(feeCollector.collect(collateral.address)).to.be.revertedWith("FeeCollector: nothing to collect");
    expect(await collateral.balanceOf(feeCollector.address)).to.equal(parseEther("0"));
  });

  it("should set fee rate & collector", async function () {
    const { feeCollector, minter } = await loadFixture(deployFixture);

    await expect(feeCollector.connect(minter).setTradingFeeRate(parseEther("0.01"))).to.be.revertedWith("Ownable: caller is not the owner");
    await feeCollector.setTradingFeeRate(parseEther("0.1"));
    expect(await feeCollector.tradingFeeRate()).to.equal(parseEther("0.1"));
    await expect(feeCollector.connect(minter).setSettlementFeeRate(parseEther("0.01"))).to.be.revertedWith("Ownable: caller is not the owner");
    await feeCollector.setSettlementFeeRate(parseEther("0.1"));
    expect(await feeCollector.settlementFeeRate()).to.equal(parseEther("0.1"));
    await expect(feeCollector.connect(minter).setCollector(minter.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await feeCollector.setCollector(minter.address);
    expect(await feeCollector.collector()).to.equal(minter.address);
  });
});
