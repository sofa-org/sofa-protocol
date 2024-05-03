// test/DNTVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PERMIT2_ADDRESS,
  expect,
  constants,
  deployFixture,
  mint,
  mintBatch,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("DNTVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      weth,
      collateral,
      hlAggregator: aggregator,
      feeCollector,
      hlOracle:oracle,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("DNT");
    const strategy = await Strategy.deploy();

    // Deploy DNTVault contract
    const Vault = await ethers.getContractFactory("DNTVault");
    vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      PERMIT2_ADDRESS, // Mock permit contract
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
      collateral.address,
      feeCollector.address,
      oracle.address
    ]);
    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      let minterNonce = 0;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      minterNonce = 1;
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.1"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
    });
  });

  describe("MintBatch", function () {
    it("should batch mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const minterNonce = 0;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker }
      ], deadline, minterNonce, collateral, vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], deadline, minterNonce, collateral, vault, minter, referral, eip721Domain);
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.1").mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.1").mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

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
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.1"), 0);
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.1"), parseEther("99.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("0.9"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089.1"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.reverted;

      // strike case
      minterNonce = 1;
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await expect(oracle.settle()).to.be.revertedWith("Oracle: not updated");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.1"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.1"));
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.1"), parseEther("98.109"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.1"), 0);
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("2.791"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99918.109"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100079.1"));

      // burnable when not expired
      minterNonce = 2;
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 3;
      deadline = await time.latest() + 600;
      term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry - 86400 * 2);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.1"), 0);
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.1"), parseEther("99.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("3.691"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99828.109"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100168.2"));


      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("3.691"));
    });

    it("should burn tokens if knock-out", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 2;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);

      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.1"), 0);
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.1"), parseEther("99.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("0.9"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089.1"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
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
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99918.109"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100079.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("2.791"));
    });

    it("should batch burn tokens if knock-out", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)

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
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100178.2"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.8"));
    });
  });

  describe("Settle", function () {
    it("should settle the price", async function () {
      // Call settle function
      await expect(oracle.settle()).emit(oracle, "Settled");
    });
  });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });

  describe("Upgrade Proxy", function () {
    it("should upgrade the proxy", async function () {
      const VaultV2 = await ethers.getContractFactory("DNTVault");
      await upgrades.upgradeProxy(vault.address, VaultV2);
    });
  });
});
