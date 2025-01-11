import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { beforeEach } from "mocha";
import {
  expect,
  constants,
  deployFixture,
  dualMint as mint,
  dualMintBatch as mintBatch,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("CrvUSDDualTrendVault", function () {
  let weth, scrvUSD, collateral, feeCollector, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      weth,
      feeCollector,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    //start from ethereum block number: 21152000
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
    //tokens
    const contractToken = await ethers.getContractFactory("MockERC20Mintable");
    let crvUSD = contractToken.attach(crvUSDAddr);
    crvUSD = crvUSD.connect(minter);
    scrvUSD = new ethers.Contract(scrvUSDAddr, scrvUSDABI);
    scrvUSD = scrvUSD.connect(minter);
    collateral = crvUSD;
    //deploy contract
    const Vault = await ethers.getContractFactory("CrvUSDDualVault");
    vault = await upgrades.deployProxy(Vault, [
      "Dual crvUSD",
      "dcrvUSDT",
      crvUSD.address,
      weth.address,
      feeCollector.address,
      scrvUSD.address
    ]);
    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    const eoa = await ethers.getImpersonatedSigner("0xAAc0aa431c237C2C0B5f041c8e59B3f1a43aC78F"); //mainnet real EOA with crvUSD
    await crvUSD.connect(eoa).transfer(minter.address, parseEther("100000"));
    await crvUSD.connect(eoa).transfer(maker.address, parseEther("100000"));
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256);
    await weth.connect(maker).approve(vault.address, constants.MaxUint256);
  });
  
  describe ("Initialize", function () {
    it("should revert if initialize twice", async function () {
      await expect(vault.initialize("Dual crvUSD", "dcrvUSDT", collateral.address, weth.address, feeCollector.address, scrvUSD.address))
        .to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe ("Decimals", function () {
    it("should get deciamls", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });
  
  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], 
        [expiry, anchorPrice, makerCollateral.mul(parseEther("1")).div(totalCollateral)]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      const productId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(vault.address)).to.equal(0);
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      const shares = await scrvUSD.convertToShares(totalCollateral);
      expect(await scrvUSD.balanceOf(vault.address)).to.equal(shares);
      expect(await vault.totalPositions(productId)).to.equal(parseEther("100"));
      expect(await vault.totalDeposit()).to.equal(parseEther("100"));
    });
    it("should revert if past deadline", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest(); //change
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain))
        .to.be.revertedWith("Vault: deadline");
    });
    it("should revert if past expiry", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.floor(await time.latest() / 86400) * 86400; //change
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain))
        .to.be.revertedWith("Vault: expired");
    });
    it("should revert if mint with the same signatures", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain))
        .to.be.revertedWith("Vault: signature consumed");
    });
    it("should revert if referral is the msg sender", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const ref = minter;  //change
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, ref, eip721Domain))
        .to.be.revertedWith("Vault: invalid referral");
    });
    it("should revert if signature is not correct", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71d";
      maker = maker.address;
      await expect(vault.connect(minter).mint(
        totalCollateral, 
        {expiry, anchorPrice, makerCollateral, deadline, maker, makerSignature},
        referral.address))
        .to.be.revertedWith("Vault: invalid maker signature");
    });
  });
  
  describe("MintBatch", function () {
    it("should batch mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, referral, eip721Domain);
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], 
        [expiry, anchorPrice, makerCollateral.mul(parseEther("1")).div(totalCollateral)]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      const productId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100").mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100").mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("0"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
      const shares = await scrvUSD.convertToShares(totalCollateral.mul(2));
      expect(await scrvUSD.balanceOf(vault.address)).to.equal(shares);
      expect(await vault.totalPositions(productId)).to.equal(parseEther("100").mul(2));
      expect(await vault.totalDeposit()).to.equal(parseEther("100").mul(2));
    });
    it("should revert if input arrays length mismatch", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      maker = maker.address;
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71c";
      const paramsArray = [{expiry, anchorPrice, makerCollateral, deadline, maker, makerSignature}];
      await expect(vault.mintBatch(
        [totalCollateral, totalCollateral],
        paramsArray,
        referral.address)).to.be.revertedWith("Vault: invalid params length");
    });
    it("should revert if past deadline", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest(); //change
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: deadline");
    });
    it("should revert if past expiry", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.floor(await time.latest() / 86400) * 86400 ; //change
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: expired");
    });
    it("should revert if mint with the same signatures", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
    });
    it("should revert if referral is the msg sender", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, minter, eip721Domain)).to.be.revertedWith("Vault: invalid referral");
    });
    it("should revert if signature is not correct", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.floor(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71d";
      maker = maker.address;
      await expect(vault.connect(minter).mintBatch([totalCollateral], 
        [{expiry, anchorPrice, makerCollateral, deadline, maker, makerSignature}], referral.address))
        .to.be.revertedWith("Vault: invalid maker signature");
    });

  });
  
  describe("Quote", function () {
    let expiry, anchorPrice;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
    });
    it("should quote tokens", async function () {
      const amount = parseEther("100");
      await expect(vault.connect(maker).quote(amount, {expiry: expiry, anchorPrice: anchorPrice}))
        .to.emit(vault, "Quoted").withArgs(maker.address, solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]), amount, amount.div(100));
      expect(await collateral.balanceOf(vault.address)).to.equal(0);
      expect(await scrvUSD.balanceOf(vault.address)).to.be.gt(0);
      expect(await weth.balanceOf(vault.address)).to.equal(parseEther("1"));
      expect(await vault.quotePositions(solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]))).to.equal(amount);
      expect(await vault.totalDeposit()).to.equal(0);
    });
    it("should revert if past expiry + 2 hours", async function () {
      const amount = parseEther("100");
      await time.increaseTo(expiry + 2 * 3600);
      await expect(vault.connect(maker).quote(amount, {expiry: expiry, anchorPrice: anchorPrice}))
        .to.be.revertedWith("Vault: expired");
    });
    it("should revert if maker balance insufficient", async function () {
      const amount = parseEther("100").add(1);
      await expect(vault.connect(maker).quote(amount, {expiry: expiry, anchorPrice: anchorPrice}))
        .to.be.revertedWith("Vault: insufficient balance");
    });

  });
  describe("QuoteBatch", function () {
    let expiry, anchorPriceA, anchorPriceB;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
    });
    it("should batch quote tokens", async function () {
      const amount = parseEther("100");
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
      expect(await collateral.balanceOf(vault.address)).to.equal(0);
      expect(await scrvUSD.balanceOf(vault.address)).to.be.gt(0);
      expect(await weth.balanceOf(vault.address)).to.equal(parseEther("2"));
      expect(await vault.quotePositions(solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceA, 1]))).to.equal(amount);
      expect(await vault.quotePositions(solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, 1]))).to.equal(amount.div(2));
      expect(await vault.totalDeposit()).to.equal(amount.div(2));
    });
    it("should revert if input arrays length mismatch", async function () {
      const amount = parseEther("100");
      await expect(vault.connect(maker).quoteBatch(
        [amount],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      )).to.be.revertedWith("Vault: invalid length");
    });
    it("should revert if past expiry + 2 hours", async function () {
      const amount = parseEther("100");
      await time.increaseTo(expiry + 2 * 3600);
      await expect(vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      )).to.be.revertedWith("Vault: expired");
    });
    it("should revert if maker balance insufficient", async function () {
      const amount = parseEther("100").add(1);
      await expect(vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      )).to.be.revertedWith("Vault: insufficient balance");
    });
  });
  
  describe("Burn", function () {
    let expiry, anchorPriceA, anchorPriceB, anchorPriceC, premiumPercentage;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      anchorPriceC = parseEther("0.03").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote all
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote half
      await mint(totalCollateral, expiry, anchorPriceC, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote 0
      const amount = totalCollateral;
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
    });

    it("should burn tokens", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceA, premiumPercentage]);
      await expect(vault.connect(minter).burn(expiry, anchorPriceA, premiumPercentage)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), 0, parseEther("1"));
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99730"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001"));
      expect(await vault.totalDeposit()).to.equal(parseEther("150"));
    });
    it("should burn tokens if not quote all", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      await expect(vault.connect(minter).burn(expiry, anchorPriceB, premiumPercentage)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), parseEther("50"), parseEther("1"));
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99780"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001"));
      expect(await vault.totalDeposit()).to.equal(parseEther("100"));
    });
    it("should burn tokens if no quote", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceC, premiumPercentage]);
      const fee = parseEther("100").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await expect(vault.connect(minter).burn(expiry, anchorPriceC, premiumPercentage)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), parseEther("100"), 0);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99830"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await vault.totalDeposit()).to.equal(parseEther("50"));
    });
    it("should revert if not past expiry + 2 hours", async function () {
      //await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      await expect(vault.connect(minter).burn(expiry, anchorPriceA, premiumPercentage))
        .to.be.revertedWith("Vault: not expired");
    });
    it("should revert if balance == 0", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      await expect(vault.connect(maker).burn(expiry, anchorPriceA, premiumPercentage))
        .to.be.revertedWith("Vault: zero amount");
    });
  });
  
  describe("BurnBatch", function () {
    let expiry, anchorPriceA, anchorPriceB, anchorPriceC, premiumPercentage,
        minterProductIdA, minterProductIdB, minterProductIdC;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      anchorPriceC = parseEther("0.03").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceC, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const amount = totalCollateral;
      minterProductIdA = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceA, premiumPercentage]);
      minterProductIdB = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      minterProductIdC = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceC, premiumPercentage]);
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
    });

    it("should batch burn tokens", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage}
      ]);
      expect(await vault.balanceOf(minter.address, minterProductIdA)).to.equal(0);
      expect(await vault.balanceOf(minter.address, minterProductIdB)).to.equal(0);
      expect(await vault.balanceOf(minter.address, minterProductIdC)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99780"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100002"));
      expect(await vault.totalDeposit()).to.equal(parseEther("100"));
    });
    it("should batch burn tokens if quote all", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage}
      ]);
      expect(await vault.balanceOf(minter.address, minterProductIdA)).to.equal(0);
      expect(await vault.balanceOf(minter.address, minterProductIdB)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(minter.address, minterProductIdC)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99730"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001"));
      expect(await vault.totalDeposit()).to.equal(parseEther("150"));
    });
    it("should batch burn tokens if no quote", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceC, premiumPercentage: premiumPercentage}
      ]);
      expect(await vault.balanceOf(minter.address, minterProductIdA)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(minter.address, minterProductIdB)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(minter.address, minterProductIdC)).to.equal(0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99830"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await vault.totalDeposit()).to.equal(parseEther("50"));
    });
    it("should batch burn tokens with different quotes", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceC, premiumPercentage: premiumPercentage}
      ]);
      expect(await vault.balanceOf(minter.address, minterProductIdA)).to.equal(0);
      expect(await vault.balanceOf(minter.address, minterProductIdB)).to.equal(0);
      expect(await vault.balanceOf(minter.address, minterProductIdC)).to.equal(0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99880"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100002"));
      expect(await vault.totalDeposit()).to.equal(0);
    });
    it("should revert if balance == 0", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await expect (vault.connect(maker).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage}
      ])).to.be.revertedWith("Vault: zero amount");
    });
    it("should revert if not past expiry + 2 hours", async function () {
      //await time.increaseTo(expiry + 2 * 3600);
      await expect (vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage}
      ])).to.be.revertedWith("Vault: not expired");
    });
  });
  
  describe("Harvest", function () {
    it("should collect fee", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const shares = await scrvUSD.convertToShares(totalCollateral);
      await time.increaseTo(expiry);
      await vault.connect(minter).harvest();
      const amount = await scrvUSD.convertToAssets(shares);
      const fee = amount.sub(totalCollateral);
      expect(await collateral.balanceOf(feeCollector.address)).to.equal(fee);
    });
    it("should collect fee after burn", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await vault.connect(maker).quote(totalCollateral, {expiry: expiry, anchorPrice: anchorPrice});
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burn(expiry, anchorPrice, premiumPercentage);
      expect(await vault.totalFee()).to.be.gt(0);
      await expect(vault.connect(minter).harvest())
        .to.emit(vault, "FeeCollected");
      expect(await collateral.balanceOf(feeCollector.address)).to.be.gt(0);
      expect(await vault.totalFee()).to.equal(0);
    });
    it("should revert if totalFee is 0", async function () {
      expect(await vault.totalFee()).to.equal(0);
      await expect(vault.connect(minter).harvest())
        .to.be.revertedWith("Vault: zero fee");
    });
  });
  
  describe("Application", function () {
    let expiry, anchorPrice, userA, userB, premiumPercentage;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      userA = minter;
      userB = maker;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, userA, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, userB, maker, referral, eip721Domain);
      const amount = totalCollateral;
      await vault.connect(maker).quoteBatch(
        [amount], //half of the totalPositions
        [
          {expiry: expiry, anchorPrice: anchorPrice}
        ]
      );
    });

    it("two users with the same product ID", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await expect(vault.connect(userA).burn(expiry, anchorPrice, premiumPercentage))
        .to.changeTokenBalances(collateral, [userA, vault], [parseEther("50"), 0]);
      expect(await weth.balanceOf(userA.address)).to.equal(parseEther("100000.5"));
      await expect(vault.connect(userB).burn(expiry, anchorPrice, premiumPercentage))
        .to.changeTokenBalances(collateral, [userB, vault], [parseEther("50"), 0]);
      expect(await weth.balanceOf(userB.address)).to.equal(parseEther("99999.5"));
    });
    it("balances after burn", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(userA).burn(expiry, anchorPrice, premiumPercentage);
      await vault.connect(userB).burn(expiry, anchorPrice, premiumPercentage);
      //1155
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, premiumPercentage]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      const productId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      expect(await vault.balanceOf(userA.address, minterProductId)).to.equal(0);
      expect(await vault.balanceOf(userB.address, minterProductId)).to.equal(0);
      expect(await vault.balanceOf(userA.address, makerProductId)).to.equal(0);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      //status variables
      expect(await vault.totalPositions(productId)).to.equal(parseEther("200"));
      expect(await vault.quotePositions(makerProductId)).to.equal(parseEther("100"));
    });
  });

});