// test/DNTVaultTest.ts

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { constants, BigNumber } from "ethers";
import {
    SignatureTransfer,
    PermitTransferFrom,
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
const { parseEther, keccak256, solidityKeccak256, solidityPack, toUtf8Bytes } = ethers.utils;

describe("ETHSmartTrendVault", function () {
  async function deployFixture() {
    const UNI_ROUTERV2_ADDR = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
    const uniRouterV2 = await ethers.getContractAt("IUniswapV2Router", UNI_ROUTERV2_ADDR);

    const UNI_FACTORY_ADDR = await uniRouterV2.factory();
    const uniFactory = await ethers.getContractAt("IUniswapV2Factory", UNI_FACTORY_ADDR);

    // Permit2
    const permit2 = await ethers.getContractAt("IPermit2", PERMIT2_ADDRESS);

    // mock weth
    const WETH = await ethers.getContractFactory("MockWETH9");
    const weth = await WETH.deploy();
    // mock collateral contract
    const collateral = weth;
    // mock governance contract
    const Governance = await ethers.getContractFactory("MockERC20Mintable");
    const governance = await Governance.deploy(
      "Governance",
      "GOV",
      18
    );

    await uniFactory.createPair(weth.address, governance.address);

    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBear");
    const strategy = await Strategy.deploy();

    // Deploy mock chainlink contract
    const Aggregator = await ethers.getContractFactory("MockChainlinkAggregator");
    const aggregator = await Aggregator.deploy();
    await aggregator.setLatestAnswer(parseEther("30000"));

    // Deploy SmartTrendVault contract
    const Vault = await ethers.getContractFactory("SmartTrendVault");

    const [owner, minter, maker, referral, lp] = await ethers.getSigners();
    collateral.mint(owner.address, parseEther("100000"));
    collateral.mint(minter.address, parseEther("100000"));
    collateral.mint(maker.address, parseEther("100000"));
    collateral.mint(lp.address, parseEther("100000"));

    await collateral.connect(minter).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
    await collateral.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

    weth.mint(lp.address, parseEther("100000"));
    await weth.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

    governance.mint(lp.address, parseEther("100000"));
    await governance.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

    await uniRouterV2.connect(lp).addLiquidity(
      weth.address,
      governance.address,
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      lp.address,
      constants.MaxUint256
    );
    // view
    const Oracle = await ethers.getContractFactory("SpotOracle");
    const oracle = await Oracle.deploy(
      aggregator.address,
    );
    const FeeCollector = await ethers.getContractFactory("FeeCollector");
    const feeCollector = await FeeCollector.deploy(
      governance.address,
      parseEther("0.01"), // Mock fee rate 1%
      UNI_ROUTERV2_ADDR
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
    return { permit2, collateral, strategy, aggregator, oracle, vault, owner, minter, maker, referral, eip721Domain };
  }

  async function mint(
    totalCollateral: any,
    expiry: number,
    anchorPrices: Array<string>,
    makerCollateral: string,
    deadline: number,
    collateral: any,
    vault: any,
    minter: any,
    maker: any,
    referral: any,
    eip721Domain: any
  ) {
    const makerSignatureTypes = { Mint: [
      { name: 'minter', type: 'address' },
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'anchorPrices', type: 'uint256[2]' },
      { name: 'makerCollateral', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'vault', type: 'address' },
    ] };
    const makerSignatureValues = {
      minter: minter.address,
      totalCollateral: totalCollateral,
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      deadline: deadline,
      vault: vault.address,
    };
    const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

    // Call mint function
    await vault
        .connect(minter)
        ["mint((uint256,uint256[2],uint256,uint256,address,bytes),address)"](
          {
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: maker.address,
            makerSignature: makerSignature
          },
          referral.address,
          { value: (totalCollateral - makerCollateral).toString() }
        );

    return { vault, collateral, maker, minter };
  }

  async function mintBatch(
    params: Array<any>,
    vault: any,
    minter: any,
    referral: any,
    eip721Domain: any
  ) {
    let totalCollaterals = [];
    let paramsArray = [];
    let collateral = BigNumber.from(0);
    for (let i = 0; i < params.length; i++) {
      const { totalCollateral, expiry, anchorPrices, makerCollateral, deadline, maker } = params[i];
      const makerSignatureTypes = { Mint: [
        { name: 'minter', type: 'address' },
        { name: 'totalCollateral', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'anchorPrices', type: 'uint256[2]' },
        { name: 'makerCollateral', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'vault', type: 'address' },
      ] };
      const makerSignatureValues = {
        minter: minter.address,
        totalCollateral: totalCollateral,
        expiry: expiry,
        anchorPrices: anchorPrices,
        makerCollateral: makerCollateral,
        deadline: deadline,
        vault: vault.address,
      };
      const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);
      totalCollaterals[i] = totalCollateral;
      paramsArray[i] = {
        expiry: expiry,
        anchorPrices: anchorPrices,
        makerCollateral: makerCollateral,
        deadline: deadline,
        maker: maker.address,
        makerSignature: makerSignature
      };
      collateral = collateral.add(totalCollateral).sub(makerCollateral);
    }
    // Call mint function
    await vault
        .connect(minter)
        ["mintBatch(uint256[],(uint256,uint256[2],uint256,uint256,address,bytes)[],address)"](
          totalCollaterals,
          paramsArray,
          referral.address,
          { value: collateral.toString() }
        );
  }

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const { collateral, vault, minter, maker, referral, eip721Domain } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("90"));
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral);
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });

  describe("MintBatch", function () {
    it("should batch mint tokens", async function () {
      const { collateral, vault, minter, maker, referral, eip721Domain } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker }
      ], vault, minter, referral, eip721Domain);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("180"));
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral.mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral.mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const { collateral, oracle, vault, minter, maker, referral, eip721Domain, aggregator, owner } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      // Call burn function
      await expect(vault.ethBurn(expiry, anchorPrices, 0)).to.be.reverted;

      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      await oracle.settle();
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, 0);
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("99"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089"));

      // invalid nonce
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral);
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, parseEther("16.500000000000000001"));
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("16"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("82.5"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.999999999999999999"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100161.5"));

      // withdraw fee
      expect(await vault.harvest()).to.changeTokenBalance(collateral, owner, parseEther("1.999999999999999999"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const { collateral, vault, oracle, minter, maker, referral, eip721Domain, owner, aggregator } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)

      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await vault.connect(minter).ethBurnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:0 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:0 }
      ]);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("16"));
      await vault.connect(maker).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:1 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:1 }
      ]);

      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.999999999999999999"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100161.5"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });
});
