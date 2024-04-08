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

describe("SmartTrendVault", function () {
  async function deployFixture() {
    const UNI_ROUTERV2_ADDR = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
    const UNI_ROUTERV3_ADDR = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    const uniRouterV2 = await ethers.getContractAt("IUniswapV2Router", UNI_ROUTERV2_ADDR);

    const UNI_FACTORY_ADDR = await uniRouterV2.factory();
    const uniFactory = await ethers.getContractAt("IUniswapV2Factory", UNI_FACTORY_ADDR);

    // Permit2
    const permit2 = await ethers.getContractAt("IPermit2", PERMIT2_ADDRESS);

    // mock weth
    const WETH = await ethers.getContractFactory("MockERC20Mintable");
    const weth = await WETH.deploy(
      "WETH",
      "WETH",
      18
    );
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

    // view
    const Oracle = await ethers.getContractFactory("SpotOracle");
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
        ["mint(uint256,(uint256,uint256[2],uint256,uint256,address,bytes),bytes,uint256,address)"](
          totalCollateral,
          {
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
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
        ["mintBatch(uint256[],(uint256,uint256[2],uint256,uint256,address,bytes)[],bytes,uint256,uint256,address)"](
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
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const minterNonce = 0;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
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
      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker }
      ], deadline, minterNonce, collateral, vault, minter, referral, eip721Domain);
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral.mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral.mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
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
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      // Call burn function
      await expect(vault.burn(expiry, anchorPrices, 0)).to.be.reverted;

      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      await oracle.settle();
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, 0);
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("99"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089"));

      // invalid nonce
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.reverted;

      // strike case
      minterNonce = 1;
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(totalCollateral);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(totalCollateral);
      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, parseEther("16.500000000000000001"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("82.5"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.999999999999999999"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99836.500000000000000001"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100161.5"));

      // withdraw fee
      expect(await vault.harvest()).to.changeTokenBalance(collateral, owner, parseEther("1.999999999999999999"));

      // another  case
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      minterNonce = 2;
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("26000"));
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, totalCollateral, parseEther("99"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, totalCollateral, parseEther("0"));
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

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)

      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:0 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:1 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:1 }
      ]);

      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.999999999999999999"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100161.5"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99836.500000000000000001"));
    });
  });

  describe("Settle", function () {
    it("should settle the price", async function () {
      const { oracle } = await loadFixture(deployFixture);
      // Call settle function
      await expect(oracle.settle()).emit(oracle, "Settled");
    });
  });


  describe("Upgrade Proxy", function () {
    it("should upgrade the proxy", async function () {
      const { vault } = await loadFixture(deployFixture);
      const VaultV2 = await ethers.getContractFactory("SmartTrendVault");
      await upgrades.upgradeProxy(vault.address, VaultV2);
    });
  });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      const { vault, collateral } = await loadFixture(deployFixture);
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });
});
