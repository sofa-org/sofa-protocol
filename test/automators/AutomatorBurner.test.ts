import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";

describe("AutomatorBurner", function () {
  let AutomatorBurner: Contract;
  let MockERC20Burnable: Contract;
  let owner: any;
  let user: any;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy a mock ERC20Burnable token
    const MockERC20BurnableFactory = await ethers.getContractFactory("RCH");
    MockERC20Burnable = await MockERC20BurnableFactory.deploy(0);
    await MockERC20Burnable.deployed();

    // Deploy the AutomatorBurner contract
    const AutomatorBurnerFactory = await ethers.getContractFactory("AutomatorBurner");
    AutomatorBurner = await AutomatorBurnerFactory.deploy(MockERC20Burnable.address);
    await AutomatorBurner.deployed();
  });

  it("should correctly set the immutable rch token address", async function () {
    expect(await AutomatorBurner.rch()).to.equal(MockERC20Burnable.address);
  });

  it("should burn tokens and emit Burned event", async function () {
    const burnAmount = ethers.utils.parseEther("10");
    const chainId = 1;
    const collateral = ethers.constants.AddressZero;

    // Mint tokens to the user
    await MockERC20Burnable.mint(user.address, burnAmount);
    expect(await MockERC20Burnable.balanceOf(user.address)).to.equal(burnAmount);

    // Approve AutomatorBurner to burn tokens
    await MockERC20Burnable.connect(user).approve(AutomatorBurner.address, burnAmount);

    // Burn tokens through the AutomatorBurner contract
    await expect(
      AutomatorBurner.connect(user).burn(burnAmount, chainId, collateral)
    )
      .to.emit(AutomatorBurner, "Burned")
      .withArgs(user.address, burnAmount, chainId, collateral);

    // Verify tokens were burned
    expect(await MockERC20Burnable.balanceOf(user.address)).to.equal(0);
  });
});
