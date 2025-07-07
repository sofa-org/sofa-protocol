import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
// import {
const {
  expect,
  constants,
  deployFixture,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack,
  leafComp,
  nodeComp,
  signMintParams,
  signSignatures,
} = require("../helpers/helpers");

describe("AutomatorBase", function () {
  let collateral, feeCollector, feeCollectorSimple, oracle, owner, minter, maker, referral, vaultA, vaultB,
      eip721DomainA, eip721DomainB, eip721DomainC,aggregator, automatorBase, crvUSD,
      automatorFactory;
  beforeEach(async function () {
    ({
      spotAggregator: aggregator,
      feeCollector,
      feeCollectorSimple,
      spotOracle: oracle,
      owner,
      minter,
      maker,
      referral,
    } = await loadFixture(deployFixture));
    const crvUSDAddr = "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E"; //ethereum real address: crvUSD
    const scrvUSDAddr = "0x0655977FEb2f289A4aB78af67BAB0d17aAb84367"; //ethereum real address: scrvUSD
    const scrvUSDABI = [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function balanceOf(address addr) view returns (uint256)",
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function transfer(address receiver, uint256 amount) external returns (bool)",
      "function deposit(uint256 assets, address receiver)",
      "function convertToShares(uint256 assets) view returns (uint256)",
      "function convertToAssets(uint256 shares) view returns (uint256)",
    ];
    const contractToken = await ethers.getContractFactory("MockERC20Mintable");
    crvUSD = contractToken.attach(crvUSDAddr);
    crvUSD = crvUSD.connect(owner);
    const scrvUSD = new ethers.Contract(scrvUSDAddr, scrvUSDABI);
    collateral = scrvUSD.connect(owner);
    //console.log("name:", await collateral.name());
    // Deploy mock strategy contract
    const StrategyA = await ethers.getContractFactory("SmartBull");
    const strategyA = await StrategyA.deploy();
    const StrategyB = await ethers.getContractFactory("SmartBear");
    const strategyB = await StrategyB.deploy();
    // Deploy SmartTrendVault contract
    const VaultA = await ethers.getContractFactory("contracts/automators/vaults/SimpleSmartTrendVault.sol:SimpleSmartTrendVault");
    vaultA = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // Mock strategy contract
      collateral.address,
      oracle.address
    ]);
    vaultB = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // Mock strategy contract
      collateral.address,
      oracle.address
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
    const feeRate = parseEther("0.02");
    const AutomatorFactory = await ethers.getContractFactory("CrvUSDAutomatorFactory");
    automatorFactory = await AutomatorFactory.deploy(referral.address, feeCollector.address, scrvUSD.address);
    await automatorFactory.deployed();
    await automatorFactory.topUp(owner.address, 1);
    const maxPeriod = 3600 * 24 * 7;
    const tx = await automatorFactory.createAutomator(feeRate, maxPeriod, crvUSD.address);
    const receipt = await tx.wait();
    //console.log("receipt:", receipt);
    const automatorAddr = receipt.events[1].args[2];
    const AutomatorBase = await ethers.getContractFactory("CrvUSDAutomatorBase");
    automatorBase = AutomatorBase.attach(automatorAddr).connect(owner);
    const money = await ethers.getImpersonatedSigner("0xAAc0aa431c237C2C0B5f041c8e59B3f1a43aC78F"); //mainnet real eoa
    await crvUSD.connect(money).transfer(minter.address, parseEther("1000"));
    await crvUSD.connect(money).transfer(owner.address, parseEther("1000")); //crvUSD
    await crvUSD.connect(minter).approve(collateral.address, constants.MaxUint256);
    await collateral.connect(minter).deposit(parseEther("300"), maker.address); //scrvUSD
    await crvUSD.connect(minter).approve(automatorBase.address, constants.MaxUint256); // approve max
    await crvUSD.connect(owner).approve(automatorBase.address, constants.MaxUint256);
    await collateral.connect(maker).approve(vaultA.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256);
  });
  
  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await automatorBase.collateral()).to.equal(crvUSD.address);
      expect(await automatorBase.name()).to.equal("Automator " + (await crvUSD.name()));
      expect(await automatorBase.symbol()).to.equal("at" + (await crvUSD.symbol()) + "_" + ethers.BigNumber.from(automatorBase.address).mod(65536).toString());
    });
    it("Should revert if not initialized by factory", async function () {
      await expect(automatorBase.initialize(owner.address, collateral.address, "100", 7))
        .to.be.revertedWith("Automator: forbidden");
    });
  });

  describe("harvest", function () {
    it("Should harvest revert if fee == 0", async function () {
      await expect(automatorBase.connect(minter).harvest())
        .to.be.revertedWith("Automator: zero fee");
    });
  });

 
  describe("decimals", function () {
    it("Should get decimals", async function () {
      expect(await automatorBase.decimals()).to.equal(18);
    });
  });
  
  describe("getRedemption", function () {
    it("Should get redemption", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automatorBase.connect(minter).deposit(amount);
      const shares = await collateral.convertToShares(amount);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares.sub(1000));
      await automatorBase.connect(minter).withdraw(amountWd);
      const ts = await time.latest();
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
      expect(await automatorBase.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      //console.log("totalCollateral:", await automatorBase.totalCollateral());
      await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256); //let time go
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(crvUSD, [minter, automatorBase], [await collateral.convertToAssets(amountWd), 0]);
      //after claim
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(ts)]);
    });
  });

  describe("getPricePerShare", function () {
    it("Should get initial price per share", async function () {
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1"));
    });
  });
  
  describe("getUnredeemedCollateral", function () {
    it("Should get initial amount of unredeemed collateral", async function () {
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(0);
    });
    it("Should get amount of unredeemed collateral after deposit and withdraw", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      const shares = await collateral.convertToShares(amount);
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(shares);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(shares.sub(amount.div(2)));
    });
  });

  describe("transferOwnership", function () {
    it("Should transfer ownership", async function () {
      await automatorBase.transferOwnership(minter.address);
      expect(await automatorBase.owner()).to.equal(minter.address);
    });
    it("Should revert if transfer ownership to zero address", async function () {
      await expect(automatorBase.transferOwnership(ethers.constants.AddressZero))
        .to.be.revertedWith("Ownable: new owner is the zero address");
    });
    it("Should revert if not the owner transfer ownership", async function () {
      await expect(automatorBase.connect(minter).transferOwnership(minter.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
  
  describe("Deposit/Withdraw", function () {
    it("Should deposit collateral to vault", async function () {
      const amount = parseEther("100");
      await expect(automatorBase.connect(minter).deposit(amount));
      expect(await collateral.balanceOf(minter.address)).to.equal(0);
      const shares = await collateral.convertToShares(amount);
      expect(await collateral.balanceOf(automatorBase.address)).to.equal(shares);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares.sub(1000));
      expect(await automatorBase.totalCollateral()).to.equal(shares);
      expect(await automatorBase.totalSupply()).to.equal(shares);
    });
    it("Should 1st deposit - 1000 wei", async function () {
      const amount = parseEther("100");
      await expect(automatorBase.connect(minter).deposit(amount))
        .to.emit(automatorBase, "Deposited")
        .withArgs(minter.address, amount, (await collateral.convertToShares(amount)), (await collateral.convertToShares(amount)).sub(1000));
      const shares = (await collateral.convertToShares(amount)).sub(1000);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares);
    });
    it("Should withdraw applied", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await expect(automatorBase.connect(minter).withdraw(amount.div(2))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(amount.div(2));
    });
    it("Should withdraw emit log", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await expect(automatorBase.connect(minter).withdraw(amount.div(2)))
        .to.emit(automatorBase, "Withdrawn").withArgs(minter.address, amount.div(2));
    });
    it("Should transfer done if transfer + pending <= balance", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      const amountWd = (await automatorBase.balanceOf(minter.address)).sub(amount.div(2).sub(1000));
      await expect(automatorBase.connect(minter).transfer(owner.address, amountWd))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amountWd, amountWd.mul(-1)]);
    });
    it("Should transferFrom done if transfer + pending <= balance", async function () {
      await automatorBase.connect(minter).approve(owner.address, constants.MaxUint256);
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      const amountWd = (await automatorBase.balanceOf(minter.address)).sub(amount.div(2).sub(1000));
      await expect(automatorBase.connect(owner).transferFrom(minter.address, owner.address, amountWd))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amountWd, amountWd.mul(-1)]);
    });
    it("Should revert if transferFrom amount + pending > balance", async function () {
      await automatorBase.connect(minter).approve(owner.address, constants.MaxUint256);
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      const amountWd = (await automatorBase.balanceOf(minter.address)).sub(amount.div(2).sub(1000));
      await expect(automatorBase.connect(owner).transferFrom(minter.address, owner.address, amountWd))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amountWd, amountWd.mul(-1)]);
      await expect(automatorBase.connect(owner).transferFrom(minter.address, owner.address, 1))
        .to.be.revertedWith("Automator: invalid transfer amount");
    });
    it("Should revert if transfer + pending > balance", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      const amountWd = (await automatorBase.balanceOf(minter.address)).sub(amount.div(2).sub(1000));
      await expect(automatorBase.connect(minter).transfer(owner.address, amountWd))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amountWd, amountWd.mul(-1)]);
      await expect(automatorBase.connect(minter).transfer(owner.address, 1))
        .to.be.revertedWith("Automator: invalid transfer amount");
    });
    it("Should withdraw if pendingRedemption != 0", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      //await ethers.provider.send("evm_setNextBlockTimestamp", [1731178500+10]);
      const ts = await time.latest();
      const amountWd = await automatorBase.balanceOf(minter.address);
      await automatorBase.connect(minter).withdraw(amountWd);
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts+1)]);
    });
    it("Should withdraw when 10 days after withdraw ", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 10]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).withdraw(amount.div(2)))
        .to.emit(automatorBase, "Withdrawn").withArgs(minter.address, amount.div(2));
    });
    it("Should withdraw revert if shares > balance", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await expect(automatorBase.connect(minter).withdraw(amount.mul(2)))
        .to.be.revertedWith("Automator: insufficient shares");
    });
    it("Should claim when 7 days after withdraw", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      await automatorBase.connect(minter).deposit(amount);
      const shares = await collateral.convertToShares(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares.sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [0, amountWd.mul(-1)]);
      const bal = await collateral.convertToAssets(amountWd);
      expect(await crvUSD.balanceOf(minter.address)).to.equal(parseEther("600").add(bal));
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares.sub(1000).sub(amountWd));
      expect(await automatorBase.totalPendingRedemptions()).to.equal(0);
      expect(await automatorBase.totalCollateral()).to.equal(shares.sub(amountWd));
    });
    it("Should not claim when 10 days after withdraw", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automatorBase.connect(minter).deposit(amount);
      const shares = await collateral.convertToShares(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares.sub(1000));
      const ts = await time.latest();
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
      expect(await automatorBase.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 10]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: invalid redemption");
      //after claim
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
    });
    it("Should claim emit log", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.emit(automatorBase, "RedemptionsClaimed").withArgs(minter.address, (await collateral.convertToAssets(amountWd)), amountWd, amountWd);
    });
    it("Should claim revert if no pending redemption", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: no pending redemption");
    });
    it("Should claim revert if less than 7 days after withdraw", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      await automatorBase.connect(minter).withdraw(ethers.utils.parseEther("50"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 6]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: invalid redemption");
    });
    it("Should deposit, withdraw and claim by many people", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      const shares0 = await collateral.convertToShares(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automatorBase.connect(owner).deposit(amount);
      const shares1 = await collateral.convertToShares(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automatorBase.connect(minter).withdraw(shares0.sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automatorBase.connect(owner).withdraw(shares1);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [0, shares0.sub(1000).mul(-1)]);
      await expect(automatorBase.connect(owner).claimRedemptions())
        .to.changeTokenBalances(collateral, [owner, automatorBase], [0, shares1.mul(-1)]);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(0);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(0);
      expect(await automatorBase.totalCollateral()).to.equal(1000);
    });
  });
  
  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let productMintC: any;
    let productMintD: any;
    let productMintE: any;
    let expiry, anchorPrices, anchorPricesC;
    beforeEach(async function () {
      await automatorFactory.enableMakers([maker.address]);
      await automatorFactory.enableVaults([vaultA.address, vaultB.address]);
      const totalCollateral = parseEther("100");
      await automatorBase.connect(minter).deposit(parseEther("200"));
      const totalCollateralE = (await automatorBase.getUnredeemedCollateral()).add(parseEther("10"));
      //await ethers.provider.send("evm_setNextBlockTimestamp", [1723507680]);
      //console.log("before expiry:", await time.latest());
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const expiryC = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400*8;
      //console.log("expiry:", expiry);
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      anchorPricesC = [parseEther("40000"), parseEther("42000")];
      const makerCollateral = parseEther("10");
      const makerCollateralB = parseEther("100");//20
      const deadline = await time.latest() + 600;
      const deadlineC = await time.latest() + 60000000;
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
      const signatureB = await signMintParams(
        totalCollateral,
        expiry,
        anchorPrices,
        makerCollateralB,
        deadline,
        vaultB,
        automatorBase,
        maker,
        eip721DomainB
      );
      const signatureC = await signMintParams(
        totalCollateral,
        expiryC,
        anchorPrices,
        makerCollateral,
        deadlineC,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureD = await signMintParams(
        totalCollateral,
        expiry,
        anchorPricesC, //adj
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureE = await signMintParams(
        totalCollateralE,
        expiry,
        anchorPricesC, //adj
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      productMint = { //win +10 -fee
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
      productMintB = { //even
        vault: vaultB.address,
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
      productMintC = { //maxPeriod fail 
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiryC,
          anchorPrices: anchorPrices,
          makerCollateral: makerCollateral,
          deadline: deadlineC,
          maker: maker.address,
          makerSignature: signatureC
        }
      };
      productMintD = { //lose -90
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesC,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureD
        }
      };
      productMintE = { //lose all
        vault: vaultA.address,
        totalCollateral: totalCollateralE,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesC,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureE
        }
      };
    });
    
    it("should successfully mint products with valid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("90").mul(-1), parseEther("100")]);
    });
    it("should successfully mint products with two vaults", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMintD, productMint], maker);
      await expect(automatorBase.mintProducts([productMintD, productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("180").mul(-1), parseEther("200")]);
    });
    it("should get unredeemed collateral after mint products", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(shares);
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      const unredeem = shares.sub(parseEther("90"));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(unredeem);
      await automatorBase.connect(minter).withdraw(parseEther("110"));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(0);
    });
    it("should mint emit log", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.emit(automatorBase, "ProductsMinted");
    });
    it("Should revert if not the owner mint products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Should revert if period > maxPeriod", async function () {
      const signaturesSignature = await signSignatures([productMintC], maker);
      await expect(automatorBase.mintProducts([productMintC], signaturesSignature))
        .to.be.revertedWith("Automator: exceed maxPeriod");
    });
    it("should fail minting products with invalid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], minter);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should revert if a vault is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableVaults([vaultA.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid vault");
    });
    it("should revert if a maker is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableMakers([maker.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should revert if not enough collateral", async function () {
      const amountWd = parseEther("150");
      await automatorBase.connect(minter).withdraw(amountWd);
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: no enough collateral to redeem");
    });
    it("should withdraw zero", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).withdraw(parseEther("100").sub(1000))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(parseEther("100").sub(1000));
    });
    it("should claim revert if withdraw amount > Automator's balance", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      await automatorBase.connect(minter).withdraw(parseEther("150").sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: insufficient collateral to redeem");
    });
    //burn
    it("should successfully burn products", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("100"), parseEther("100").mul(-1)]);
      //automatorBase: +9.7(fee: 0.097)
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shares.sub(1000));
      expect(await automatorBase.totalFee()).to.equal(parseEther("0.2")); //0.3
      expect(await automatorBase.totalProtocolFee()).to.equal(parseEther("0.1"));
      //console.log("shares:", shares);
      //console.log("totalCollateral:", await automatorBase.totalCollateral());
      //console.log("totalSupply:", await automatorBase.totalSupply());
      const totalCol = shares.add(parseEther("10")).sub(parseEther("0.3"));
      const pps = totalCol.mul(ethers.constants.WeiPerEther).div(shares);
      expect(await automatorBase.getPricePerShare()).to.equal(pps);
      expect(await automatorBase.totalCollateral()).to.equal(totalCol);
      expect(await automatorBase.totalSupply()).to.equal(shares);
    });
    it("should successfully burn products and mint products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("100"), parseEther("100").mul(-1)]);
      const signaturesSignatureC = await signSignatures([productMintC], maker);
      await automatorBase.mintProducts([productMintC], signaturesSignatureC);
    });
    it("should revert mint products if not enough collateral after burn products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("100"), parseEther("100").mul(-1)]);
      const amountWd = parseEther("150");
      await automatorBase.connect(minter).withdraw(amountWd);
      const signaturesSignatureC = await signSignatures([productMintC], maker);
      await expect(automatorBase.mintProducts([productMintC], signaturesSignatureC))
        .to.be.revertedWith("Automator: no enough collateral to redeem");
    });
    it("should burn products with loss", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMintD], maker);
      const tx = await automatorBase.mintProducts([productMintD], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("0"); //loss
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [left, left.mul(-1)]);
      const totalCol = shares.sub(parseEther("90"));
      const pps = totalCol.mul(ethers.constants.WeiPerEther).div(shares);
      expect(await automatorBase.totalFee()).to.equal(parseEther("-1.8"));
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal(pps);
      expect(await automatorBase.totalCollateral()).to.equal(totalCol);
      expect(await automatorBase.totalSupply()).to.equal(shares);
    });
    it("should burn products with no loss and no profit", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMintB], maker);
      const tx = await automatorBase.mintProducts([productMintB], signaturesSignature);
      const productBurn  = {
        vault: vaultB.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("0");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultB], [left, left.mul(-1)]);
      //in 90; out 90
      expect(await automatorBase.totalFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1"));
      expect(await automatorBase.totalCollateral()).to.equal(shares);
      expect(await automatorBase.totalSupply()).to.equal(shares);
    });
    it("should burn products with all loss", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMintE], maker);
      const tx = await automatorBase.mintProducts([productMintE], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [0, 0]);
      const fee = shares.mul(parseEther("0.02")).div(ethers.constants.WeiPerEther).mul(-1);
      expect(await automatorBase.totalFee()).to.equal(fee);
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal(0);
      expect(await automatorBase.totalCollateral()).to.equal(0);
      //withdraw
      await expect(automatorBase.connect(minter).withdraw(parseEther("100").sub(1000))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automatorBase.totalSupply()).to.equal(shares);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("no shares to redeem");
    });
    it("should successfully mint/burn two products and collect fees", async function () {
      //await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMint, productMintB], maker);
      const tx = await automatorBase.mintProducts([productMint, productMintB], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      const productBurnB  = {
        vault: vaultB.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn, productBurnB]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("100").mul(1), parseEther("100").mul(-1)]);
      expect(await automatorBase.totalFee()).to.equal(parseEther("0.2"));
      expect(await automatorBase.totalProtocolFee()).to.equal(parseEther("0.1"));
      const totalCol = shares.add(parseEther("10")).sub(parseEther("0.3"));
      const pps = totalCol.mul(ethers.constants.WeiPerEther).div(shares);
      expect(await automatorBase.getPricePerShare()).to.equal(pps);
      expect(await automatorBase.totalCollateral()).to.equal(totalCol);
      expect(await automatorBase.totalSupply()).to.equal(shares);
      await expect(automatorBase.harvest()).to.changeTokenBalances(collateral, [feeCollector], [0]);
      const bal = await collateral.convertToAssets(parseEther("0.1"));
      expect(await crvUSD.balanceOf(feeCollector.address)).to.equal(bal);
      expect(await automatorBase.getPricePerShare()).to.equal(pps);
      expect(await automatorBase.totalFee()).to.equal(0);
    });
    it("should successfully mint/burn two products with gain&loss and collect fees", async function () {
      //await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMintD, productMint], maker);
      const tx = await automatorBase.mintProducts([productMintD, productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      const productBurnD  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn, productBurnD]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("100").mul(1), parseEther("100").mul(-1)]);
      const totalCol = shares.add(parseEther("10")).sub(parseEther("0.1")).sub(parseEther("90"));
      const pps = totalCol.mul(ethers.constants.WeiPerEther).div(shares);
      expect(await automatorBase.totalFee()).to.equal(parseEther("-1.6"));
      expect(await automatorBase.totalProtocolFee()).to.equal(parseEther("0.1"));
      expect(await automatorBase.getPricePerShare()).to.equal(pps);
      expect(await automatorBase.totalCollateral()).to.equal(totalCol);
      expect(await automatorBase.totalSupply()).to.equal(shares);
      await expect(automatorBase.harvest()).to.changeTokenBalances(collateral, [feeCollector], [0]);
      const bal = await collateral.convertToAssets(parseEther("0.1"));
      expect(await crvUSD.balanceOf(feeCollector.address)).to.equal(bal);
    });
    it("should claim pending redemptions", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const amountWd = parseEther("100").sub(1000);
      await expect(automatorBase.connect(minter).withdraw(amountWd)).to.changeTokenBalance(collateral, minter, 0);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.emit(automatorBase, "ProductsBurned");
      const totalCol = shares.add(parseEther("10")).sub(parseEther("0.3"));
      //console.log("totalCol:", totalCol, await automatorBase.totalCollateral());
      //console.log("totalSup:", shares, await automatorBase.totalSupply());

      //const pps = totalCol.mul(ethers.constants.WeiPerEther).div(shares);
      //const scrvUSDWd = pps.mul(amountWd).div(ethers.constants.WeiPerEther);
      const scrvUSDWd = totalCol.mul(amountWd).div(shares);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [0, scrvUSDWd.mul(-1)]);
      const bal = await collateral.convertToAssets(scrvUSDWd);
      expect(await crvUSD.balanceOf(minter.address)).to.equal(parseEther("500").add(bal));
    });
    it("should successfully deposit after growth in fund value", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      //console.log(await automatorBase.balanceOf(minter.address));
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [parseEther("100"), parseEther("100").mul(-1)]);
      const totalCol = shares.add(parseEther("10")).sub(parseEther("0.3"));
      expect(await automatorBase.totalCollateral()).to.equal(totalCol);
      //another deposit
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const scrvUSD = await collateral.convertToShares(parseEther("100"));
      const shares2 = scrvUSD.mul(shares).div(totalCol);
      const totalShares = shares.add(shares2);
      const pps = totalCol.add(scrvUSD).mul(ethers.constants.WeiPerEther).div(totalShares);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(totalShares.sub(1000));
      await automatorBase.connect(minter).withdraw(totalShares.sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      const amountWd = totalShares.sub(1000).mul(totalCol.add(scrvUSD)).div(totalShares);
      //console.log("pps before claimRedemptions:", await automatorBase.getPricePerShare());
      //await automatorBase.connect(minter).claimRedemptions();
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [0, amountWd.mul(-1)]);
      //console.log("pps after claimRedemptions:", await automatorBase.getPricePerShare());
      //expect(await automatorBase.getPricePerShare()).to.equal(pps);
      expect(await automatorBase.totalSupply()).to.equal(1000);
    });
    it("should claim if burn with loss", async function () {
      const shares = await collateral.convertToShares(parseEther("200"));
      const signaturesSignature = await signSignatures([productMintD], maker);
      const tx = await automatorBase.mintProducts([productMintD], signaturesSignature);
      const amountWd = parseEther("100").sub(1000);
      await automatorBase.connect(minter).withdraw(amountWd);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("0");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [left, left.mul(-1)]);
      const totalCol = shares.sub(parseEther("90"));
      //const pps = totalCol.mul(ethers.constants.WeiPerEther).div(shares);
      //const scrvUSDWd = pps.mul(amountWd).div(ethers.constants.WeiPerEther);
      const scrvUSDWd = totalCol.mul(amountWd).div(shares);
      //(100 - 90) / 100 * (100 - 10^(-15))
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [0, scrvUSDWd.mul(-1)]);
    });

  });
})
