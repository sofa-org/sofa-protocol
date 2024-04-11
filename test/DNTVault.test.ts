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

describe("DNTVault", function () {
  async function deployFixture() {
    const UNI_ROUTERV2_ADDR = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
    const UNI_ROUTERV3_ADDR = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    const uniRouterV2 = await ethers.getContractAt("IUniswapV2Router", UNI_ROUTERV2_ADDR);

    const UNI_FACTORY_ADDR = await uniRouterV2.factory();
    const uniFactory = await ethers.getContractAt("IUniswapV2Factory", UNI_FACTORY_ADDR);

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
    // mock governance contract
    const Governance = await ethers.getContractFactory("MockERC20Mintable");
    const governance = await Governance.deploy(
      "Governance",
      "GOV",
      18
    );

    await uniFactory.createPair(weth.address, collateral.address);
    await uniFactory.createPair(weth.address, governance.address);

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
      collateral.address,
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      lp.address,
      constants.MaxUint256
    );
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
    const Oracle = await ethers.getContractFactory("HlOracle");
    const oracle = await Oracle.deploy(
      aggregator.address,
    );
    const FeeCollector = await ethers.getContractFactory("FeeCollector");
    const feeCollector = await FeeCollector.deploy(
      governance.address,
      parseEther("0.01"), // Mock fee rate 1%
      UNI_ROUTERV2_ADDR,
      UNI_ROUTERV3_ADDR
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
    totalCollateral: string,
    expiry: number,
    anchorPrices: Array<string>,
    makerCollateral: string,
    makerBalanceThreshold: string,
    deadline: number,
    minterNonce: number,
    collateral: any,
    vault: any,
    minter: any,
    maker: any,
    referral: any,
    eip721Domain: any
  ) {
    // console.log(keccak256(toUtf8Bytes("Mint(address minter,uint256 totalCollateral,uint256 expiry,uint256 strikePrice,uint256 makerCollateral,uint256 deadline,uint256 nonce,address vault)")));
    // Test variables
    const minterPermit: PermitTransferFrom = {
      permitted: {
        token: collateral.address,
        amount: (totalCollateral - makerCollateral).toString()
      },
      spender: vault.address,
      nonce: minterNonce,
      deadline: deadline
    };
    const { domain, types, values } = SignatureTransfer.getPermitData(minterPermit, PERMIT2_ADDRESS, eip721Domain.chainId);
    const minterPermitSignature = await minter._signTypedData(domain, types, values);

    const makerSignatureTypes = { Mint: [
      { name: 'minter', type: 'address' },
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'anchorPrices', type: 'uint256[2]' },
      { name: 'makerCollateral', type: 'uint256' },
      { name: 'makerBalanceThreshold', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'vault', type: 'address' },
    ] };
    const makerSignatureValues = {
      minter: minter.address,
      totalCollateral: totalCollateral,
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      makerBalanceThreshold: makerBalanceThreshold,
      deadline: deadline,
      vault: vault.address,
    };
    const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

    // Call mint function
    await vault
        .connect(minter)
        ["mint(uint256,(uint256,uint256[2],uint256,uint256,uint256,address,bytes),bytes,uint256,address)"](
          totalCollateral,
          {
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            makerBalanceThreshold: makerBalanceThreshold,
            deadline: deadline,
            maker: maker.address,
            makerSignature: makerSignature
          },
          minterPermitSignature,
          minterNonce,
          referral.address
        );

    return { vault, collateral, maker, minter };
  }

  async function mintBatch(
    params: Array<any>,
    deadline: number,
    minterNonce: number,
    collateral: any,
    vault: any,
    minter: any,
    referral: any,
    eip721Domain: any
  ) {
    let totalCollaterals = [];
    let paramsArray = [];
    let minterCollateral = BigNumber.from(0);
    for (let i = 0; i < params.length; i++) {
      const { totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, maker } = params[i];
      const makerSignatureTypes = { Mint: [
        { name: 'minter', type: 'address' },
        { name: 'totalCollateral', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
        { name: 'anchorPrices', type: 'uint256[2]' },
        { name: 'makerCollateral', type: 'uint256' },
        { name: 'makerBalanceThreshold', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'vault', type: 'address' },
      ] };
      const makerSignatureValues = {
        minter: minter.address,
        totalCollateral: totalCollateral,
        expiry: expiry,
        anchorPrices: anchorPrices,
        makerCollateral: makerCollateral,
        makerBalanceThreshold: makerBalanceThreshold,
        deadline: deadline,
        vault: vault.address,
      };
      const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);
      totalCollaterals[i] = totalCollateral;
      paramsArray[i] = {
        expiry: expiry,
        anchorPrices: anchorPrices,
        makerCollateral: makerCollateral,
        makerBalanceThreshold: makerBalanceThreshold,
        deadline: deadline,
        maker: maker.address,
        makerSignature: makerSignature
      };
      minterCollateral = minterCollateral.add(totalCollateral).sub(makerCollateral);
    }
    const minterPermit: PermitTransferFrom = {
      permitted: {
        token: collateral.address,
        amount: minterCollateral.toString()
      },
      spender: vault.address,
      nonce: minterNonce,
      deadline: deadline
    };
    const { domain, types, values } = SignatureTransfer.getPermitData(minterPermit, PERMIT2_ADDRESS, eip721Domain.chainId);
    const minterPermitSignature = await minter._signTypedData(domain, types, values);

    // Call mint function
    await vault
        .connect(minter)
        ["mintBatch(uint256[],(uint256,uint256[2],uint256,uint256,uint256,address,bytes)[],bytes,uint256,uint256,address)"](
          totalCollaterals,
          paramsArray,
          minterPermitSignature,
          minterNonce,
          deadline,
          referral.address,
        );
  }

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const { collateral, vault, minter, maker, referral, eip721Domain } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const makerBalanceThreshold = parseEther("100000");
      const deadline = await time.latest() + 600;
      let minterNonce = 0;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      minterNonce = 1;
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid balance threshold");
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral);
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
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
      const minterNonce = 0;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("100000"), deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("100000"), deadline: deadline, maker: maker }
      ], deadline, minterNonce, collateral, vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: invalid balance threshold");

      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("100000"), deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("99990"), deadline: deadline, maker: maker }
      ], deadline, minterNonce, collateral, vault, minter, referral, eip721Domain);
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral.mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral.mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const { collateral, oracle, vault, minter, maker, referral, eip721Domain, owner, aggregator } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      // Call burn function
      await expect(vault.burn(term, expiry, anchorPrices, 0)).to.be.reverted;

      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry);
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not settled");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, 0);
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("99"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.reverted;

      // strike case
      minterNonce = 1;
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await expect(oracle.settle()).to.be.revertedWith("Oracle: not updated");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral);
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, parseEther("99"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, 0);
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("2"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99919"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100079"));

      // burnable when not expired
      minterNonce = 2;
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 3;
      deadline = await time.latest() + 600;
      term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry - 86400 * 2);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, 0);
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("99"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("3"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99829"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100168"));


      // withdraw fee
      expect(await vault.harvest()).to.changeTokenBalance(collateral, owner, parseEther("2"));
    });

    it("should burn tokens if knock-out", async function () {
      const { collateral, oracle, vault, minter, maker, referral, eip721Domain, owner, aggregator } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 2;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const makerBalanceThreshold = parseEther("100000");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);

      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, 0);
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("99"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089"));
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
      let makerBalanceThreshold = parseEther("100000");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      makerBalanceThreshold = parseEther("99990");
      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)

      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await time.increaseTo(expiry);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, isMaker:0 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, isMaker:1 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, isMaker:1 }
      ]);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99919"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100079"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("2"));
    });

    it("should batch burn tokens if knock-out", async function () {
      // batch burn tokens
      const { collateral, vault, oracle, minter, maker, referral, eip721Domain, owner, aggregator } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      makerBalanceThreshold = parseEther("99990");
      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)

      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await time.increaseTo(expiry);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, isMaker:0 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, isMaker:1 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, isMaker:1 }
      ]);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100178"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("2"));
    });
  });

  describe("Settle", function () {
    it("should settle the price", async function () {
      const { oracle } = await loadFixture(deployFixture);
      // Call settle function
      await expect(oracle.settle()).emit(oracle, "Settled");
    });
  });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      const { vault, collateral } = await loadFixture(deployFixture);
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });

  describe("Upgrade Proxy", function () {
    it("should upgrade the proxy", async function () {
      const { vault } = await loadFixture(deployFixture);
      const VaultV2 = await ethers.getContractFactory("DNTVault");
      await upgrades.upgradeProxy(vault.address, VaultV2);
    });
  });
});
