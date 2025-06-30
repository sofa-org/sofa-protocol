import { ethers, network } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const {
  expect,
  constants,
  deployFixture,
  parseEther,
  signMintParams,
  signSignatures,
} = require("../helpers/helpers");

describe("RCHTreasury", function () {
  let collateral, feeCollector, oracle, owner, minter, maker, referral, vaultA, vaultB, zenRCH,
      eip721DomainA, eip721DomainB, aggregator, automatorBase, automatorFactory, treasury;
  beforeEach(async function () {
    ({
      spotAggregator: aggregator,
      feeCollector,
      spotOracle: oracle,
      owner,
      minter,
      maker,
      referral,
    } = await loadFixture(deployFixture));
    // Deploy RCH
    const rchAddr = "0x57B96D4aF698605563A4653D882635da59Bf11AF";
    const RCH = await ethers.getContractFactory("RCH");
    const rchContract = await RCH.deploy(0);
    const code = await network.provider.send("eth_getCode", [rchContract.address]);
    await network.provider.send("hardhat_setCode", [rchAddr, code]);
    const rch = RCH.attach(rchAddr).connect(owner);
    //console.log("storage:", await network.provider.send("eth_getStorageAt", [rch.address, "0x9"]));
    await network.provider.send("hardhat_setStorageAt", [
      rch.address,
      "0x9",
      ethers.utils.hexZeroPad(owner.address, 32)
    ]);
    const StRCH = await ethers.getContractFactory("StRCH");
    const stRCH = await StRCH.deploy(rch.address, ethers.constants.AddressZero, parseEther("0"));
    const ZenRCH = await ethers.getContractFactory("ZenRCH");
    zenRCH = await ZenRCH.deploy(rch.address, stRCH.address);
    // Deploy AutomatorBaseFactory contract
    const feeRate = parseEther("0.02");
    const AutomatorFactory = await ethers.getContractFactory("RCHAutomatorFactory");
    automatorFactory = await AutomatorFactory.deploy(referral.address, feeCollector.address, zenRCH.address);
    await automatorFactory.deployed();
    await automatorFactory.topUp(owner.address, 1);
    const maxPeriod = 3600 * 24 * 7; //7 days
    const tx = await automatorFactory.createAutomator(feeRate, maxPeriod, rch.address);
    const receipt: any = await tx.wait();
    const automatorAddr = receipt.events[1].args[2];
    const AutomatorBase = await ethers.getContractFactory("RCHAutomatorBase");
    automatorBase = AutomatorBase.attach(automatorAddr).connect(owner);
    // Deploy Treasury
    const Treasury = await ethers.getContractFactory("RCHTreasury");
    treasury = await Treasury.deploy(rch.address, zenRCH.address, automatorFactory.address);
    // Deploy SmartTrendVault contract
    const StrategyA = await ethers.getContractFactory("SmartBull");
    const strategyA = await StrategyA.deploy();
    const StrategyB = await ethers.getContractFactory("SmartBear");
    const strategyB = await StrategyB.deploy();
    const VaultA = await ethers.getContractFactory("contracts/treasury/vaults/SimpleSmartTrendVault.sol:SimpleSmartTrendVault");
    vaultA = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // bull
      zenRCH.address,
      oracle.address,
      treasury.address
    ]);
    vaultB = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // bear
      zenRCH.address,
      oracle.address,
      treasury.address
    ]);
    eip721DomainA = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vaultA.address,
    };
    eip721DomainB = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vaultB.address,
    };
    collateral = rch;
    //approve treasury
    await collateral.connect(minter).approve(treasury.address, constants.MaxUint256);
    await collateral.connect(owner).approve(treasury.address, constants.MaxUint256);
     await collateral.connect(minter).approve(zenRCH.address, constants.MaxUint256);
    //approve automator
    await collateral.connect(minter).approve(automatorBase.address, constants.MaxUint256);
    //mint rch
    await collateral.mint(owner.address, parseEther("100000"));
    await collateral.mint(minter.address, parseEther("100000"));
    await collateral.mint(maker.address, parseEther("100000"));
    await stRCH.enableVaults([zenRCH.address]);
    await zenRCH.connect(minter).mint(parseEther("200"));
  });
  
  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await treasury.rch()).to.equal(collateral.address);
      expect(await treasury.asset()).to.equal(zenRCH.address);
      expect(await treasury.factory()).to.equal(automatorFactory.address);
      expect(await treasury.name()).to.equal("Treasury of Zen RCH");
      expect(await treasury.symbol()).to.equal("vzRCH");
      expect(await treasury.decimals()).to.equal(18);
    });
  });

  describe("Deposit", function () {
    it("Should deposit collateral to treasury for others", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.mul(-1), 0]);
      expect(await zenRCH.balanceOf(treasury.address)).to.equal(amount);
      expect(await treasury.totalAssets()).to.equal(amount);
      expect(await treasury.balanceOf(owner.address)).to.equal(amount);
    });
    it("Should deposit emit log", async function () {
      const amount = parseEther("100");
      //transfer collateral to treasury before deposit
      await zenRCH.connect(minter).transfer(treasury.address, amount.div(2));
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.emit(treasury, "Deposit").withArgs(minter.address, owner.address, amount, 1);
    });
    it("Should deposit after deposit", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.mul(-1), 0]);
      await expect(treasury.connect(owner).deposit(amount.mul(2), minter.address))
        .to.changeTokenBalances(collateral, [owner, treasury], [amount.mul(-2), 0]);
      expect(await zenRCH.balanceOf(treasury.address)).to.equal(amount.mul(3));
      expect(await treasury.totalAssets()).to.equal(amount.mul(3));
      expect(await treasury.balanceOf(owner.address)).to.equal(amount);
      expect(await treasury.balanceOf(minter.address)).to.equal(amount.mul(2));
    });
  });
  
  describe("Mint", function () {
    it("Should mint revert", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).mint(amount, owner.address))
        .to.be.revertedWith("RCHTreasury: minting is not supported, use deposit instead");
    });
  });
  
  describe("Withdraw", function () {
    it("Should withdraw revert", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).withdraw(amount,  minter.address, owner.address))
        .to.be.revertedWith("RCHTreasury: withdrawing is not supported, use redeem instead");
    });
  });

  describe("Redeem", function () {
    it("Should redeem shares", async function () {
      const amount = parseEther("100");
      await treasury.connect(minter).deposit(amount, owner.address);
      //transfer collateral to treasury
      await zenRCH.connect(minter).transfer(treasury.address, amount);
      await expect(treasury.connect(owner).redeem(amount.div(2), minter.address, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.sub(1), 0]);
      expect(await zenRCH.balanceOf(treasury.address)).to.equal(amount.add(1));
      expect(await treasury.totalAssets()).to.equal(amount.add(1));
      expect(await treasury.balanceOf(owner.address)).to.equal(amount.div(2));
    });
    it("Should redeem emit log", async function () {
      const amount = parseEther("100");
      await treasury.connect(minter).deposit(amount, owner.address);
      //transfer collateral to treasury
      await zenRCH.connect(minter).transfer(treasury.address, amount);
      await expect(treasury.connect(owner).redeem(amount.div(2), minter.address, owner.address))
        .to.emit(treasury, "Withdraw").withArgs(owner.address, minter.address, owner.address, amount.sub(1), amount.div(2));
    });
    it("Should redeem others' shares if approved", async function () {
      const amount = parseEther("100");
      await treasury.connect(minter).deposit(amount, owner.address);
      //transfer collateral to treasury
      await zenRCH.connect(minter).transfer(treasury.address, amount);
      //approve
      await treasury.connect(owner).approve(minter.address, amount.div(2));
      await expect(treasury.connect(minter).redeem(amount.div(2), minter.address, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.sub(1), 0]);
        expect(await zenRCH.balanceOf(treasury.address)).to.equal(amount.add(1));
      expect(await treasury.totalAssets()).to.equal(amount.add(1));
      expect(await treasury.balanceOf(owner.address)).to.equal(amount.div(2));
    });
  });
  
  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let productMintC: any;
    let productMintD: any;
    let expiry, expiryD, anchorPrices, anchorPricesD;
    beforeEach(async function () {
      //deposit to treasury
      await treasury.connect(minter).deposit(parseEther("100"), owner.address);
      //automator factory config
      await automatorFactory.enableMakers([maker.address]);
      await automatorFactory.enableVaults([vaultA.address, vaultB.address]);
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("400"));
      //vault parameters
      const totalCollateral = parseEther("100");
      const makerCollateral = parseEther("10");
      const makerCollateralB = parseEther("20");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      expiryD = expiry + 86400; //next day
      const deadline = await time.latest() + 600;
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      anchorPricesD = [parseEther("29000"), parseEther("30000")];
      //signatures
      const signature = await signMintParams(
        totalCollateral,
        expiry,
        anchorPrices,
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureB = await signMintParams( //makerCollateralB
        totalCollateral,
        expiry,
        anchorPrices,
        makerCollateralB,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureC = await signMintParams( //anchorPricesD
        totalCollateral,
        expiry,
        anchorPricesD,
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureD = await signMintParams( //expiryD vaultB
        totalCollateral,
        expiryD,
        anchorPricesD, //adj
        makerCollateral,
        deadline,
        vaultB,
        automatorBase,
        maker,
        eip721DomainB
      );
      //product
      productMint = { //win
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPrices,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signature
        }
      };
      productMintB = { //win
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPrices,
          makerCollateral: makerCollateralB,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureB
        }
      };
      productMintC = { //win
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesD,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureC
        }
      };
      productMintD = { //lose
        vault: vaultB.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiryD,
          anchorPrices: anchorPricesD,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureD
        }
      };
    });
    
    it("should mint product", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(zenRCH, [automatorBase, treasury, vaultA], [parseEther("90").mul(-1), parseEther("10").mul(-1), parseEther("100")]);
      expect(await treasury.totalPositions()).to.equal(parseEther("10"));
      expect(await treasury.totalAssets()).to.equal(parseEther("100"));
      expect(await treasury.expiries(expiry, 0)).to.equal(computeId(vaultA.address, expiry, anchorPrices));
    });
    it("should revert if message sender is not a enabled vault by the factory", async function () {
      await expect(treasury.mintPosition(expiry, anchorPrices, parseEther("10"), maker.address))
        .to.be.revertedWith("Treasury: caller is not a vault");
    });
    it("should revert if maker is not enabled by the factory", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableMakers([maker.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Treasury: signer is not a maker");
    });
    it("should deposit 0 to burn position", async function () {
      //mint
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      //deposit
      await expect(treasury.connect(minter).deposit(0, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [0, 0]);
      expect(await treasury.totalPositions()).to.equal(0);
      expect(await treasury.totalAssets()).to.equal(parseEther("90"));
      await expect(treasury.expiries(expiry, 0)).to.be.reverted;
    });
    it("should deposit amount to burn position", async function () {
      //mint
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      //deposit
      const amount = parseEther("90"); 
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.mul(-1), 0]);
      expect(await zenRCH.balanceOf(treasury.address)).to.equal(amount.mul(2));
      expect(await treasury.totalPositions()).to.equal(0);
      expect(await treasury.totalAssets()).to.equal(amount.mul(2));
      //OpenZeppelin ERC4626: amount * (totalSupply+1) / (totalAssets + 1)
      expect(await treasury.balanceOf(owner.address)).to.equal(parseEther("200").sub(1));
    });
    it("should redeem shares to burn position", async function () {
      //mint
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      //redeem
      const shares = parseEther("100");
      await expect(treasury.connect(owner).redeem(shares, minter.address, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [parseEther("90"), 0]);
      expect(await zenRCH.balanceOf(treasury.address)).to.equal(0);
      expect(await treasury.totalPositions()).to.equal(0);
      expect(await treasury.totalAssets()).to.equal(0);
      expect(await treasury.balanceOf(owner.address)).to.equal(0);
    });
    it("should successfully mint 4 products with 2 vaults", async function () {
      const signaturesSignature = await signSignatures([productMintD, productMintC, productMintB, productMint], maker);
      await expect(automatorBase.mintProducts([productMintD, productMintC, productMintB, productMint], signaturesSignature))
        .to.changeTokenBalances(zenRCH, [automatorBase, treasury, vaultA, vaultB], [parseEther("350").mul(-1), parseEther("50").mul(-1), parseEther("300"), parseEther("100")]);
      expect(await treasury.totalPositions()).to.equal(parseEther("50"));
      expect(await treasury.totalAssets()).to.equal(parseEther("100"));
      expect(await treasury.expiries(expiry, 0)).to.equal(computeId(vaultA.address, expiry, anchorPricesD));
      expect(await treasury.expiries(expiry, 1)).to.equal(computeId(vaultA.address, expiry, anchorPrices));
      expect(await treasury.expiries(expiryD, 0)).to.equal(computeId(vaultB.address, expiryD, anchorPricesD));
    });
    it("should deposit 0 to burn 4 position in 2 vaults", async function () {
      const signaturesSignature = await signSignatures([productMintD, productMintC, productMintB, productMint], maker);
      await automatorBase.mintProducts([productMintD, productMintC, productMintB, productMint], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      await time.increaseTo(expiryD);
      await oracle.settle();
      //deposit
      await expect(treasury.connect(minter).deposit(0, owner.address))
        .to.changeTokenBalances(zenRCH, [minter, treasury], [0, parseEther("100")]);
      expect(await treasury.totalPositions()).to.equal(0);
      await expect(treasury.expiries(expiry, 0)).to.be.reverted;
      await expect(treasury.expiries(expiryD, 0)).to.be.reverted;
      expect(await treasury.totalAssets()).to.equal(parseEther("150"));
      expect(await treasury.balanceOf(owner.address)).to.equal(parseEther("100"));
    });
  });
})

function computeId(sender, expiry, anchorPrices) {
  const packed = ethers.utils.solidityPack(
    [ "address", "uint256", "uint256[]"],
    [ sender, expiry, anchorPrices ]
  );
  const id = ethers.utils.keccak256(packed);
  return id;
}
