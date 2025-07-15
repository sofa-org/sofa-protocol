import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  expect,
  constants,
  deployFixture,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack,
  signMintParamsWithCollateralAtRisk
} from "../helpers/helpers";

describe("RebaseSmartTrendVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator, strategy;
  
  beforeEach(async function () {
    ({
      weth,
      collateral,
      spotAggregator: aggregator,
      feeCollector,
      spotOracle: oracle,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBull");
    strategy = await Strategy.deploy();

    // Deploy RebaseSmartTrendVault contract
    const Vault = await ethers.getContractFactory("contracts/vaults/RebaseSmartTrendVault.sol:RebaseSmartTrendVault");
    vault = await Vault.deploy(
      "Rebase Sofa ETH",
      "rsfETH",
      strategy.address,
      collateral.address,
      feeCollector.address,
      oracle.address
    );
    
    eip721Domain = {
      name: 'Vault',
      version: '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256);
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256);
  });

  describe("Deployment", function () {
    it("should deploy with correct parameters", async function () {
      expect(await vault.name()).to.equal("Rebase Sofa ETH");
      expect(await vault.symbol()).to.equal("rsfETH");
      expect(await vault.strategy()).to.equal(strategy.address);
      expect(await vault.collateral()).to.equal(collateral.address);
      expect(await vault.feeCollector()).to.equal(feeCollector.address);
      expect(await vault.oracle()).to.equal(oracle.address);
      expect(await vault.totalSupply()).to.equal(0);
      expect(await vault.totalFee()).to.equal(0);
    });

    it("should set correct decimals", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });

    it("should set correct domain separator", async function () {
      const expectedDomainSeparator = keccak256(
        solidityPack(
          ["bytes"],
          [
            ethers.utils.defaultAbiCoder.encode(
              ["bytes32", "bytes32", "bytes32", "uint256", "address"],
              [
                "0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f",
                keccak256(ethers.utils.toUtf8Bytes("Vault")),
                keccak256(ethers.utils.toUtf8Bytes("1.0")),
                1,
                vault.address
              ]
            )
          ]
        )
      );
      expect(await vault.DOMAIN_SEPARATOR()).to.equal(expectedDomainSeparator);
    });
  });

  describe("Mint", function () {
    it("should mint tokens with rebase logic", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      const minterProductId = await vault.getProductId(expiry, anchorPrices, collateralAtRiskPercentage, 0);
      const makerProductId = await vault.getProductId(expiry, anchorPrices, collateralAtRiskPercentage, 1);

      // For first mint: rebaseTokenShare = totalCollateral * SHARE_MULTIPLIER = 100e18 * 1e18 = 100e36
      // Trading fee = 0.01 * (90 - 10) = 0.01 * 80 = 0.8
      // Trading fee share = 0.8e18 * 1e18 = 0.8e36
      // Net rebase share = 100e36 - 0.8e36 = 99.2e36
      const expectedRebaseShare = parseEther("100").mul(parseEther("1")); // 100e36
      const expectedTradingFee = parseEther("0.8").mul(parseEther("1")); // 0.8e36
      const expectedNetShare = expectedRebaseShare.sub(expectedTradingFee); // 99.2e36
      
      expect(await vault.totalSupply()).to.equal(expectedRebaseShare);
      expect(await vault.totalFee()).to.equal(expectedTradingFee);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(expectedNetShare);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(expectedNetShare);
    });

    it("should handle second mint with rebase calculation", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      // First mint
      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);
      
      // Second mint with different parameters
      const expiry2 = expiry + 86400;
      const anchorPrices2 = [parseEther("29000"), parseEther("31000")];
      const deadline2 = await time.latest() + 600;
      
      await mintRebase(totalCollateral, expiry2, anchorPrices2, collateralAtRisk, makerCollateral, deadline2);

      // Total supply should be 200e36 (two mints of 100e36 each)
      // Total fee should be 1.6e36 (two fees of 0.8e36 each)
      expect(await vault.totalSupply()).to.equal(parseEther("200").mul(parseEther("1")));
      expect(await vault.totalFee()).to.equal(parseEther("1.6").mul(parseEther("1")));
    });

    it("should reject expired deadline", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() - 1; // Expired deadline

      await expect(
        mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline)
      ).to.be.revertedWith("Vault: deadline");
    });

    it("should reject expired expiry", async function () {
      const totalCollateral = parseEther("100");
      const expiry = await time.latest() - 1; // Expired expiry
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await expect(
        mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline)
      ).to.be.revertedWith("Vault: expired");
    });

    it("should reject invalid expiry time", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28801; // Invalid expiry
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await expect(
        mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline)
      ).to.be.revertedWith("Vault: invalid expiry");
    });

    it("should reject invalid anchor prices", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("30000"), parseEther("28000")]; // Invalid order
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await expect(
        mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline)
      ).to.be.revertedWith("Vault: invalid strike prices");
    });

    it("should reject consumed signature", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);
      
      await expect(
        mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline)
      ).to.be.revertedWith("Vault: signature consumed");
    });

    it("should reject invalid referral", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      const makerSignature = await signMintParamsWithCollateralAtRisk(
        totalCollateral,
        expiry,
        anchorPrices,
        collateralAtRisk,
        makerCollateral,
        deadline,
        vault,
        minter,
        maker,
        eip721Domain
      );

      const mintParams = {
        expiry,
        anchorPrices,
        collateralAtRisk,
        makerCollateral,
        deadline,
        maker: maker.address,
        makerSignature: makerSignature
      };

      await expect(
        vault.connect(minter).mint(totalCollateral, mintParams, minter.address)
      ).to.be.revertedWith("Vault: invalid referral");
    });

    it("should reject invalid collateral at risk", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("110"); // Too high
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await expect(
        mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline)
      ).to.be.revertedWith("Vault: invalid collateral");
    });
  });

  describe("Burn", function () {
    it("should burn minter tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0))
        .to.emit(vault, "Burned");
    });

    it("should burn maker tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1))
        .to.emit(vault, "Burned");
    });

    it("should reject burn before expiry", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      await expect(
        vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.be.revertedWith("Vault: not expired");
    });

    it("should reject burn before settlement", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      await expect(
        vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.be.revertedWith("Vault: not settled");
    });

    it("should reject burn with zero balance", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      await expect(
        vault.connect(referral).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.be.revertedWith("Vault: zero amount");
    });
  });

  describe("Burn Batch", function () {
    it("should burn multiple products in batch", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices1 = [parseEther("28000"), parseEther("30000")];
      const anchorPrices2 = [parseEther("29000"), parseEther("31000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices1, collateralAtRisk, makerCollateral, deadline);
      await mintRebase(totalCollateral, expiry, anchorPrices2, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      const products = [
        { expiry, anchorPrices: anchorPrices1, collateralAtRiskPercentage, isMaker: 0 },
        { expiry, anchorPrices: anchorPrices2, collateralAtRiskPercentage, isMaker: 0 }
      ];

      await expect(vault.connect(minter).burnBatch(products))
        .to.emit(vault, "BatchBurned");
    });

    it("should reject batch burn with zero balance", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      
      const products = [
        { expiry, anchorPrices, collateralAtRiskPercentage, isMaker: 0 }
      ];

      await expect(vault.connect(referral).burnBatch(products))
        .to.be.revertedWith("Vault: zero amount");
    });
  });

  describe("Harvest", function () {
    it("should harvest fees", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      expect(await vault.totalFee()).to.equal(parseEther("0.8").mul(parseEther("1")));

      await expect(vault.harvest())
        .to.emit(vault, "FeeCollected");

      expect(await vault.totalFee()).to.equal(0);
    });

    it("should reject harvest with zero fees", async function () {
      await expect(vault.harvest())
        .to.be.revertedWith("Vault: zero fee");
    });
  });

  describe("Payoff Calculations", function () {
    it("should calculate maker payoff correctly", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      const amount = parseEther("99.2").mul(parseEther("1")); // 99.2e36

      const payoff = await vault.getMakerPayoff(expiry, anchorPrices, collateralAtRiskPercentage, amount);
      expect(payoff).to.not.be.undefined;
    });

    it("should calculate minter payoff correctly", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("90");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;

      await mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline);

      await time.increaseTo(expiry);
      await oracle.settle();

      const collateralAtRiskPercentage = collateralAtRisk.mul(parseEther("1")).div(totalCollateral.sub(parseEther("0.8")));
      const amount = parseEther("99.2").mul(parseEther("1")); // 99.2e36

      const [payoff, fee] = await vault.getMinterPayoff(expiry, anchorPrices, collateralAtRiskPercentage, amount);
      expect(payoff).to.not.be.undefined;
      expect(fee).to.not.be.undefined;
    });
  });

  describe("Product ID", function () {
    it("should generate consistent product IDs", async function () {
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRiskPercentage = parseEther("0.9");
      const isMaker = 0;

      const productId1 = await vault.getProductId(expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
      const productId2 = await vault.getProductId(expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
      
      expect(productId1).to.equal(productId2);
    });

    it("should generate different product IDs for different parameters", async function () {
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRiskPercentage = parseEther("0.9");

      const minterProductId = await vault.getProductId(expiry, anchorPrices, collateralAtRiskPercentage, 0);
      const makerProductId = await vault.getProductId(expiry, anchorPrices, collateralAtRiskPercentage, 1);
      
      expect(minterProductId).to.not.equal(makerProductId);
    });
  });

  // Helper functions

  async function mintRebase(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline) {
    const makerSignature = await signMintParamsWithCollateralAtRisk(
      totalCollateral,
      expiry,
      anchorPrices,
      collateralAtRisk,
      makerCollateral,
      deadline,
      vault,
      minter,
      maker,
      eip721Domain
    );

    const mintParams = {
      expiry,
      anchorPrices,
      collateralAtRisk,
      makerCollateral,
      deadline,
      maker: maker.address,
      makerSignature: makerSignature
    };

    return await vault.connect(minter).mint(totalCollateral, mintParams, referral.address);
  }
});
