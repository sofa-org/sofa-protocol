// test/AAVEDNTVaultTest.ts

import { expect } from "chai";
import { ethers } from "hardhat";
import { constants } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
const { parseEther } = ethers.utils;

describe("RCH", function () {
  async function deployFixture() {
    const UNI_ROUTERV2_ADDR = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
    const uniRouterV2 = await ethers.getContractAt("IUniswapV2Router", UNI_ROUTERV2_ADDR);

    const UNI_FACTORY_ADDR = await uniRouterV2.factory();
    const uniFactory = await ethers.getContractAt("IUniswapV2Factory", UNI_FACTORY_ADDR);

    // mock weth
    const WETH = await ethers.getContractFactory("MockWETH9");
    const weth = await WETH.deploy();

    // tomorrow timestmap
    const tradingStartTime = Math.floor(new Date().getTime() / 1000 + 60 * 60 * 24); // 1 day later
    // rch contract
    const RCH = await ethers.getContractFactory("RCH");
    const rch = await RCH.deploy(tradingStartTime);

    await uniFactory.createPair(weth.address, rch.address);

    const [owner, user] = await ethers.getSigners();
    weth.mint(owner.address, parseEther("100000"));
    weth.mint(user.address, parseEther("100000"));
    rch.mint(owner.address, parseEther("100000"));
    rch.mint(user.address, parseEther("100000"));

    await weth.connect(owner).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await rch.connect(owner).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await weth.connect(user).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await rch.connect(user).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

    await uniRouterV2.connect(owner).addLiquidity(
      weth.address,
      rch.address,
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      owner.address,
      constants.MaxUint256
    );

    return { rch, weth, owner, user, uniRouterV2, tradingStartTime };
  }

  it("Should not trade before tradingStartTime", async function () {
    const { rch, weth, owner, user, uniRouterV2 } = await loadFixture(deployFixture);
    await expect(rch.connect(owner).transfer(user.address, parseEther("1"))).emit(rch, "Transfer");
    await expect(rch.connect(user).transfer(owner.address, parseEther("1"))).to.be.revertedWith("RCH: token transfer not allowed before trading starts");
    await expect(uniRouterV2.connect(user).swapExactTokensForTokens(parseEther("1"), 0, [rch.address, weth.address], user.address, constants.MaxUint256)).to.be.revertedWith("TransferHelper: TRANSFER_FROM_FAILED");
    await expect(uniRouterV2.connect(user).swapExactTokensForTokens(parseEther("1"), 0, [weth.address, rch.address], user.address, constants.MaxUint256)).to.be.reverted;
    await expect(uniRouterV2.connect(owner).swapExactTokensForTokens(parseEther("1"), 0, [rch.address, weth.address], owner.address, constants.MaxUint256)).emit(rch, "Transfer");
    await expect(uniRouterV2.connect(owner).swapExactTokensForTokens(parseEther("1"), 0, [weth.address, rch.address], owner.address, constants.MaxUint256)).emit(rch, "Transfer");
  });

  it("Should trade after tradingStartTime", async function () {
    const { rch, weth, owner, user, uniRouterV2, tradingStartTime } = await loadFixture(deployFixture);
    await time.increaseTo(tradingStartTime + 60); // 1 day later
    await expect(rch.connect(owner).transfer(user.address, parseEther("1"))).emit(rch, "Transfer");
    await expect(rch.connect(user).transfer(owner.address, parseEther("1"))).emit(rch, "Transfer");
    await expect(uniRouterV2.connect(user).swapExactTokensForTokens(parseEther("1"), 0, [rch.address, weth.address], user.address, constants.MaxUint256)).emit(rch, "Transfer");
    await expect(uniRouterV2.connect(user).swapExactTokensForTokens(parseEther("1"), 0, [weth.address, rch.address], user.address, constants.MaxUint256)).emit(rch, "Transfer");
    await expect(uniRouterV2.connect(owner).swapExactTokensForTokens(parseEther("1"), 0, [rch.address, weth.address], owner.address, constants.MaxUint256)).emit(rch, "Transfer");
    await expect(uniRouterV2.connect(owner).swapExactTokensForTokens(parseEther("1"), 0, [weth.address, rch.address], owner.address, constants.MaxUint256)).emit(rch, "Transfer");
  });

  it("Should not mint after exceeding cap", async function () {
    const { rch, owner } = await loadFixture(deployFixture);
    await rch.connect(owner).mint(owner.address, parseEther("36800000"));
    expect(await rch.balanceOf(owner.address)).to.equal(parseEther("36890000"));
    await expect(rch.burn(parseEther("10000"))).to.changeTokenBalance(rch, owner, parseEther("-10000"));
    await expect(rch.connect(owner).mint(owner.address, parseEther("10000"))).to.be.revertedWith("RCH: cap exceeded");
  });
});
