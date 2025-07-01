import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const {
  expect,
  constants,
  deployFixture,
  parseEther,
  signMintParams,
  signSignatures,
} = require("../helpers/helpers");

describe("Treasury", function () {
  let collateral, feeCollector, oracle, owner, minter, maker, referral, aavePool, vaultA, vaultB,
      eip721DomainA, eip721DomainB, atoken, automatorBase, automatorFactory, treasury;
  beforeEach(async function () {
    ({
      collateral,
      feeCollector,
      spotOracle: oracle,
      owner,
      minter,
      maker,
      referral,
      atoken,
      aavePool
    } = await loadFixture(deployFixture));
    // Deploy AutomatorBaseFactory contract
    const feeRate = parseEther("0.02");
    const AutomatorFactory = await ethers.getContractFactory("AutomatorFactory");
    automatorFactory = await AutomatorFactory.deploy(referral.address, feeCollector.address, aavePool.address);
    await automatorFactory.deployed();
    await automatorFactory.topUp(owner.address, 1);
    const maxPeriod = 3600 * 24 * 7; //7 days
    const tx = await automatorFactory.createAutomator(feeRate, maxPeriod, collateral.address);
    const receipt: any = await tx.wait();
    const automatorAddr = receipt.events[1].args[2];
    const AutomatorBase = await ethers.getContractFactory("AAVEAutomatorBase");
    automatorBase = AutomatorBase.attach(automatorAddr).connect(owner);
    // Deploy Treasury
    const Treasury = await ethers.getContractFactory("AAVETreasury");
    treasury = await Treasury.deploy(collateral.address, aavePool.address, automatorFactory.address);
    // Deploy SmartTrendVault contract
    const StrategyA = await ethers.getContractFactory("SmartBull");
    const strategyA = await StrategyA.deploy();
    const StrategyB = await ethers.getContractFactory("SmartBear");
    const strategyB = await StrategyB.deploy();
    const VaultA = await ethers.getContractFactory("contracts/treasury/vaults/RebaseSmartTrendVault.sol:RebaseSmartTrendVault");
    vaultA = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // bull
      atoken.address,
      oracle.address,
      treasury.address
    ]);
    vaultB = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // bear
      atoken.address,
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
    //approve treasury
    await collateral.connect(minter).approve(treasury.address, constants.MaxUint256);
    await collateral.connect(owner).approve(treasury.address, constants.MaxUint256);
    //approve automator
    await collateral.connect(minter).approve(automatorBase.address, constants.MaxUint256);
    await collateral.connect(minter).approve(aavePool.address, constants.MaxUint256);
    await aavePool.connect(minter).supply(collateral.address, parseEther("500"), minter.address, 0);
  });
  
  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await treasury.asset()).to.equal(collateral.address);
      expect(await treasury.name()).to.equal("Treasury of COLLATERAL");
      expect(await treasury.symbol()).to.equal("vCOL");
      expect(await treasury.pool()).to.equal(aavePool.address);
      expect(await treasury.aToken()).to.equal(atoken.address);
      expect(await treasury.factory()).to.equal(automatorFactory.address);
      expect(await treasury.decimals()).to.equal(18);
    });
  });

  describe("Deposit", function () {
    it("Should deposit collateral to treasury for others", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.mul(-1), 0]);
      expect(await atoken.balanceOf(treasury.address)).to.equal(amount);
      expect(await treasury.totalAssets()).to.equal(amount);
      expect(await treasury.balanceOf(owner.address)).to.equal(amount);
    });
    it("Should deposit emit log", async function () {
      const amount = parseEther("100");
      //transfer collateral to treasury before deposit
      await atoken.connect(minter).transfer(treasury.address, amount.div(2));
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.emit(treasury, "Deposit").withArgs(minter.address, owner.address, amount, 1);
    });
    it("Should deposit after deposit", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).deposit(amount, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.mul(-1), 0]);
      await expect(treasury.connect(owner).deposit(amount.mul(2), minter.address))
        .to.changeTokenBalances(collateral, [owner, treasury], [amount.mul(-2), 0]);
      expect(await atoken.balanceOf(treasury.address)).to.equal(amount.mul(3));
      expect(await treasury.totalAssets()).to.equal(amount.mul(3));
      expect(await treasury.balanceOf(owner.address)).to.equal(amount);
      expect(await treasury.balanceOf(minter.address)).to.equal(amount.mul(2));
    });
  });
  
  describe("Mint", function () {
    it("Should mint revert", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).mint(amount, owner.address))
        .to.be.revertedWith("AAVETreasury: minting shares is not supported");
    });
  });
  
  describe("Withdraw", function () {
    it("Should withdraw revert", async function () {
      const amount = parseEther("100");
      await expect(treasury.connect(minter).withdraw(amount,  minter.address, owner.address))
        .to.be.revertedWith("AAVETreasury: withdrawing assets is not supported, use redeem instead");
    });
  });

  describe("Redeem", function () {
    it("Should redeem shares", async function () {
      const amount = parseEther("100");
      await treasury.connect(minter).deposit(amount, owner.address);
      //transfer collateral to treasury
      await atoken.connect(minter).transfer(treasury.address, amount);
      await expect(treasury.connect(owner).redeem(amount.div(2), minter.address, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.sub(1), 0]);
      expect(await atoken.balanceOf(treasury.address)).to.equal(amount.add(1));
      expect(await treasury.totalAssets()).to.equal(amount.add(1));
      expect(await treasury.balanceOf(owner.address)).to.equal(amount.div(2));
    });
    it("Should redeem emit log", async function () {
      const amount = parseEther("100");
      await treasury.connect(minter).deposit(amount, owner.address);
      //transfer collateral to treasury
      await atoken.connect(minter).transfer(treasury.address, amount);
      await expect(treasury.connect(owner).redeem(amount.div(2), minter.address, owner.address))
        .to.emit(treasury, "Withdraw").withArgs(owner.address, minter.address, owner.address, amount.sub(1), amount.div(2));
    });
    it("Should redeem others' shares if approved", async function () {
      const amount = parseEther("100");
      await treasury.connect(minter).deposit(amount, owner.address);
      //transfer collateral to treasury
      await atoken.connect(minter).transfer(treasury.address, amount);
      //approve
      await treasury.connect(owner).approve(minter.address, amount.div(2));
      await expect(treasury.connect(minter).redeem(amount.div(2), minter.address, owner.address))
        .to.changeTokenBalances(collateral, [minter, treasury], [amount.sub(1), 0]);
        expect(await atoken.balanceOf(treasury.address)).to.equal(amount.add(1));
      expect(await treasury.totalAssets()).to.equal(amount.add(1));
      expect(await treasury.balanceOf(owner.address)).to.equal(amount.div(2));
    });
  });
  
  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let productMintC: any;
    let productMintD: any;
    let productMintE: any;
    let expiry, expiryD, anchorPrices, anchorPricesC, anchorPricesD, anchorPricesE;
    beforeEach(async function () {
      //deposit to treasury
      await treasury.connect(minter).deposit(parseEther("100"), owner.address);
      //automator factory config
      await automatorFactory.enableMakers([maker.address]);
      await automatorFactory.enableVaults([vaultA.address, vaultB.address]);
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("500"));
      //vault parameters
      const totalCollateral = parseEther("100");
      const makerCollateral = parseEther("10");
      const makerCollateralB = parseEther("20");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      expiryD = expiry + 86400 * 2; //next day
      const deadline = await time.latest() + 600;
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      anchorPricesC = [parseEther("30000"), parseEther("32000")];
      anchorPricesD = [parseEther("29000"), parseEther("30000")];
      anchorPricesE = [parseEther("30000"), parseEther("31000")];
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
        anchorPricesC,
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
      const signatureE = await signMintParams( //makerCollateralB
        totalCollateral,
        expiry,
        anchorPricesE,
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
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
          anchorPrices: anchorPricesC,
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
      productMintE = { //maker win 100
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesE,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureE
        }
      };
    });
    
    it("should mint product", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(atoken, [automatorBase, treasury, vaultA], [parseEther("90").mul(-1), parseEther("10").mul(-1), parseEther("100")]);
      expect(await treasury.minExpiry()).to.equal(expiry);
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
      expect(await treasury.minExpiry()).to.equal(expiry); //next day
      await expect(treasury.connect(minter).deposit(0, owner.address))
        .to.changeTokenBalances(atoken, [automatorBase, treasury], [0, 0]);
      expect(await treasury.minExpiry()).to.equal(expiry + 86400);
      expect(await treasury.totalPositions()).to.equal(0);
      expect(await treasury.totalAssets()).to.equal(parseEther("90"));
      await expect(treasury.expiries(expiry, 0)).to.be.reverted;
    });
    it("should position remain if deposit 0 before minExpiry", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      await treasury.connect(minter).deposit(0, owner.address);
      expect(await treasury.minExpiry()).to.equal(expiry);
      expect(await treasury.totalPositions()).to.equal(parseEther("10"));
      expect(await treasury.totalAssets()).to.equal(parseEther("100"));
      expect(await treasury.expiries(expiry, 0)).to.equal(computeId(vaultA.address, expiry, anchorPrices));
    });
    it("should burn Positions with parameters", async function () {
      //mint
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      //burn
      await expect(treasury.connect(minter).burnPositions([{vault:vaultA.address, positions:[{expiry:expiry, anchorPrices:anchorPrices}]}]))
        .to.changeTokenBalances(atoken, [minter, treasury], [0, 0]);
      expect(await treasury.minExpiry()).to.equal(expiry);
      expect(await treasury.totalPositions()).to.equal(0);
      expect(await treasury.totalAssets()).to.equal(parseEther("90"));
      expect(await treasury.expiries(expiry, 0)).to.equal(computeId(vaultA.address, expiry, anchorPrices));
    });
    it("should deposit 0 after burn Positions with parameters", async function () {
      //mint
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      //burn
      await expect(treasury.connect(minter).burnPositions([{vault:vaultA.address, positions:[{expiry:expiry, anchorPrices:anchorPrices}]}]))
        .to.changeTokenBalances(atoken, [minter, treasury], [0, 0]);
      //deposit
      await expect(treasury.connect(minter).deposit(0, owner.address))
        .to.changeTokenBalances(atoken, [minter, treasury], [0, 0]);
      expect(await treasury.minExpiry()).to.equal(expiry + 86400);
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
      expect(await treasury.minExpiry()).to.equal(expiry + 86400);
      expect(await atoken.balanceOf(treasury.address)).to.equal(amount.mul(2));
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
      expect(await treasury.minExpiry()).to.equal(expiry + 86400);
      await expect(treasury.expiries(expiry, 0)).to.be.reverted;
      expect(await atoken.balanceOf(treasury.address)).to.equal(0);
      expect(await treasury.totalPositions()).to.equal(0);
      expect(await treasury.totalAssets()).to.equal(0);
      expect(await treasury.balanceOf(owner.address)).to.equal(0);
    });
    it("should successfully mint 4 products with 2 vaults", async function () {
      const signaturesSignature = await signSignatures([productMintD, productMintC, productMintB, productMint], maker);
      await expect(automatorBase.mintProducts([productMintD, productMintC, productMintB, productMint], signaturesSignature))
        .to.changeTokenBalances(atoken, [automatorBase, treasury, vaultA, vaultB], [parseEther("350").mul(-1), parseEther("50").mul(-1), parseEther("300"), parseEther("100")]);
      expect(await treasury.minExpiry()).to.equal(expiry);
      expect(await treasury.totalPositions()).to.equal(parseEther("50"));
      expect(await treasury.totalAssets()).to.equal(parseEther("100"));
      expect(await treasury.expiries(expiry, 0)).to.equal(computeId(vaultA.address, expiry, anchorPricesC));
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
        .to.changeTokenBalances(atoken, [minter, treasury], [0, parseEther("200")]);
      expect(await treasury.minExpiry()).to.equal(expiryD + 86400);
      expect(await treasury.totalPositions()).to.equal(0);
      await expect(treasury.expiries(expiry, 0)).to.be.reverted;
      await expect(treasury.expiries(expiryD, 0)).to.be.reverted;
      expect(await treasury.totalAssets()).to.equal(parseEther("250"));
      expect(await treasury.balanceOf(owner.address)).to.equal(parseEther("100"));
    });
    it("should burn some positions and deposit 0 to burn other positions", async function () {
      const signaturesSignature = await signSignatures([productMintD, productMintC, productMintB, productMint, productMintE], maker);
      await automatorBase.mintProducts([productMintD, productMintC, productMintB, productMint, productMintE], signaturesSignature);
      await time.increaseTo(expiry);
      await oracle.settle();
      await time.increaseTo(expiryD);
      await oracle.settle();
      //burn
      await expect(treasury.connect(minter).burnPositions([
        {vault:vaultA.address, positions:[
          {expiry:expiry, anchorPrices:anchorPrices},
          {expiry:expiry, anchorPrices:anchorPricesC}]
        },
        {vault:vaultB.address, positions:[{expiry:expiryD, anchorPrices:anchorPricesD}]}
      ])).to.changeTokenBalances(atoken, [minter, treasury], [0, parseEther("200")]);
      expect(await treasury.minExpiry()).to.equal(expiry);
      expect(await treasury.totalPositions()).to.equal(parseEther("10"));
      expect(await treasury.totalAssets()).to.equal(parseEther("250"));
      expect(await treasury.expiries(expiry, 0)).to.equal(computeId(vaultA.address, expiry, anchorPricesC));
      expect(await treasury.expiries(expiry, 1)).to.equal(computeId(vaultA.address, expiry, anchorPrices));
      expect(await treasury.expiries(expiry, 2)).to.equal(computeId(vaultA.address, expiry, anchorPricesE));
      expect(await treasury.expiries(expiryD, 0)).to.equal(computeId(vaultB.address, expiryD, anchorPricesD));
      //deposit
      await expect(treasury.connect(minter).deposit(0, owner.address))
       .to.changeTokenBalances(atoken, [minter, treasury], [0, parseEther("100")]);
      expect(await treasury.minExpiry()).to.equal(expiryD + 86400);
      expect(await treasury.totalPositions()).to.equal(0);
      await expect(treasury.expiries(expiry, 0)).to.be.reverted;
      await expect(treasury.expiries(expiryD, 0)).to.be.reverted;
      expect(await treasury.totalAssets()).to.equal(parseEther("340"));
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
