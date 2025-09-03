// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/AAVETreasury.sol";
import "contracts/mocks/MockERC20Mintable.sol";
import "contracts/mocks/MockAavePool.sol";
import "contracts/mocks/MockATokenMintable.sol";
contract MockAAVEVault {
    function burn(uint256, uint256[2] calldata, uint256) external {}
}

contract MockAAVEFactory {
    mapping(address => bool) public vaults;
    mapping(address => bool) public makers;
    
    function addVault(address vault) external {
        vaults[vault] = true;
    }
    
    function addMaker(address maker) external {
        makers[maker] = true;
    }
}

contract AAVETreasuryTest is Test {
    AAVETreasury treasury;
    MockERC20Mintable asset;
    MockATokenMintable aToken;
    MockAavePool pool;
    MockAAVEFactory factory;
    MockAAVEVault vault;
    MockAAVEVault vault2;
    address maker = makeAddr("maker");
    address maker2 = makeAddr("maker2");
    address user = makeAddr("user");

    function setUp() public {
        asset = new MockERC20Mintable("Mock Asset", "mASS", 18);
        aToken = new MockATokenMintable(address(asset), "Mock aAsset", "maASS", 18);
        pool = new MockAavePool(IERC20(address(asset)), aToken);
        factory = new MockAAVEFactory();
        treasury = new AAVETreasury(asset, IPool(address(pool)), IAutomatorFactory(address(factory)));
        vault = new MockAAVEVault();
        vault2 = new MockAAVEVault();

        factory.addVault(address(vault));
        factory.addVault(address(vault2));
        factory.addMaker(address(this));
        factory.addMaker(maker);
        factory.addMaker(maker2);

        // Fund accounts
        asset.mint(address(this), 10000e18);
        asset.mint(user, 10000e18);
        asset.mint(address(treasury), 10000e18);
        
        // Set up approvals
        asset.approve(address(treasury), type(uint256).max);
        vm.prank(user);
        asset.approve(address(treasury), type(uint256).max);
    }

    function test_Constructor() public {
        assertEq(address(treasury.asset()), address(asset));
        assertEq(address(treasury.pool()), address(pool));
        assertEq(address(treasury.aToken()), address(aToken));
        assertEq(address(treasury.factory()), address(factory));
        assertEq(asset.allowance(address(treasury), address(pool)), type(uint256).max);
    }

    function test_Deposit() public {
        uint256 amount = 100e18;
        treasury.deposit(amount, address(this));

        assertEq(treasury.balanceOf(address(this)), amount);
        assertEq(aToken.balanceOf(address(treasury)), amount);
        assertEq(treasury.totalAssets(), amount);
    }

    function test_Redeem() public {
        uint256 depositAmount = 100e18;
        treasury.deposit(depositAmount, address(this));

        uint256 redeemShares = treasury.balanceOf(address(this));
        uint256 initialAssetBalance = asset.balanceOf(address(this));

        treasury.redeem(redeemShares, address(this), address(this));

        assertEq(treasury.balanceOf(address(this)), 0);
        assertEq(aToken.balanceOf(address(treasury)), 0);
        assertEq(asset.balanceOf(address(this)), initialAssetBalance + depositAmount);
    }

    function test_MintPosition() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 50e18;

        // Pre-fund the treasury with aTokens by minting them directly
        aToken.mint(address(treasury), amount);
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, address(this));

        assertEq(treasury.totalPositions(), amount);
        assertEq(aToken.balanceOf(address(vault)), amount);
    }

    function test_Reverts() public {
        vm.expectRevert("AAVETreasury: minting shares is not supported");
        treasury.mint(1, address(this));

        vm.expectRevert("AAVETreasury: withdrawing assets is not supported, use redeem instead");
        treasury.withdraw(1, address(this), address(this));
    }

    function test_Deposit_multiple_users() public {
        uint256 amount1 = 100e18;
        uint256 amount2 = 200e18;
        
        uint256 shares1 = treasury.deposit(amount1, address(this));
        
        vm.prank(user);
        uint256 shares2 = treasury.deposit(amount2, user);
        
        assertEq(shares1, amount1, "first user should receive correct shares");
        assertEq(shares2, amount2, "second user should receive correct shares");
        assertEq(treasury.balanceOf(address(this)), shares1, "first user should own shares");
        assertEq(treasury.balanceOf(user), shares2, "second user should own shares");
        assertEq(treasury.totalAssets(), amount1 + amount2, "total assets should be sum of deposits");
        assertEq(aToken.balanceOf(address(treasury)), amount1 + amount2, "treasury should have aTokens");
    }

    function test_Redeem_partial() public {
        uint256 depositAmount = 100e18;
        uint256 redeemAmount = 50e18;
        
        uint256 shares = treasury.deposit(depositAmount, address(this));
        uint256 initialAssetBalance = asset.balanceOf(address(this));
        
        uint256 assets = treasury.redeem(redeemAmount, address(this), address(this));
        
        assertEq(assets, redeemAmount, "assets should equal redeemed amount");
        assertEq(treasury.balanceOf(address(this)), shares - redeemAmount, "user should have remaining shares");
        assertEq(asset.balanceOf(address(this)), initialAssetBalance + redeemAmount, "user should receive assets");
        assertEq(treasury.totalAssets(), depositAmount - redeemAmount, "treasury should have remaining assets");
    }

    function test_MintPosition_multiple_positions() public {
        uint256 expiry1 = block.timestamp + 1 days;
        uint256 expiry2 = block.timestamp + 2 days;
        uint256[2] memory anchorPrices1 = [uint256(100e18), uint256(200e18)];
        uint256[2] memory anchorPrices2 = [uint256(150e18), uint256(250e18)];
        uint256 amount1 = 50e18;
        uint256 amount2 = 75e18;
        
        // Pre-fund treasury with aTokens
        aToken.mint(address(treasury), amount1 + amount2);
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry1, anchorPrices1, amount1, address(this));
        
        vm.prank(address(vault2));
        treasury.mintPosition(expiry2, anchorPrices2, amount2, maker);
        
        assertEq(treasury.totalPositions(), amount1 + amount2, "total positions should be sum of both");
        assertEq(aToken.balanceOf(address(vault)), amount1, "vault should have aTokens");
        assertEq(aToken.balanceOf(address(vault2)), amount2, "vault2 should have aTokens");
    }

    function test_MintPosition_insufficient_balance() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 50e18;
        
        // Don't pre-fund treasury with aTokens
        vm.prank(address(vault));
        vm.expectRevert("ERC20: transfer amount exceeds balance");
        treasury.mintPosition(expiry, anchorPrices, amount, address(this));
    }

    function test_Deposit_zero_amount() public {
        uint256 shares = treasury.deposit(0, address(this));
        assertEq(shares, 0, "depositing zero should return zero shares");
        assertEq(treasury.totalAssets(), 0, "total assets should remain zero");
    }

    function test_Redeem_zero_shares() public {
        uint256 assets = treasury.redeem(0, address(this), address(this));
        assertEq(assets, 0, "redeeming zero shares should return zero assets");
    }

    function test_Redeem_insufficient_shares() public {
        uint256 shares = 100e18;
        
        vm.expectRevert();
        treasury.redeem(shares, address(this), address(this));
    }

    function test_AAVE_integration() public {
        uint256 amount = 100e18;
        
        // Test that deposits go to AAVE
        uint256 poolBalanceBefore = asset.balanceOf(address(pool));
        treasury.deposit(amount, address(this));
        
        assertEq(asset.balanceOf(address(pool)), poolBalanceBefore + amount, "pool should receive assets");
        assertEq(aToken.balanceOf(address(treasury)), amount, "treasury should receive aTokens");
        
        // Test that redeems come from AAVE
        uint256 shares = treasury.balanceOf(address(this));
        uint256 userBalanceBefore = asset.balanceOf(address(this));
        
        treasury.redeem(shares, address(this), address(this));
        
        assertEq(asset.balanceOf(address(this)), userBalanceBefore + amount, "user should receive assets from AAVE");
        assertEq(aToken.balanceOf(address(treasury)), 0, "treasury should have no aTokens left");
    }

    function test_totalAssets_includes_aToken_balance() public {
        uint256 depositAmount = 100e18;
        uint256 positionAmount = 50e18;
        
        // Deposit assets
        treasury.deposit(depositAmount, address(this));
        
        // Mint aTokens directly to treasury (simulating AAVE yield)
        aToken.mint(address(treasury), 25e18);
        
        // Create position
        aToken.mint(address(treasury), positionAmount);
        vm.prank(address(vault));
        treasury.mintPosition(block.timestamp + 1 days, [uint256(100e18), uint256(200e18)], positionAmount, address(this));
        
        // totalAssets should include both aToken balance and positions
        assertEq(treasury.totalAssets(), depositAmount + 25e18 + positionAmount, "totalAssets should include aToken balance and positions");
    }

    function test_preview_functions_with_positions() public {
        uint256 depositAmount = 100e18;
        uint256 positionAmount = 50e18;
        
        // Deposit assets first to establish initial shares
        treasury.deposit(depositAmount, address(this));
        
        // Create position (which uses aTokens in treasury)
        aToken.mint(address(treasury), positionAmount);
        vm.prank(address(vault));
        treasury.mintPosition(block.timestamp + 1 days, [uint256(100e18), uint256(200e18)], positionAmount, address(this));
        
        // Preview functions should work correctly even with positions
        // Since we already have shares and assets, preview should reflect the current exchange rate
        uint256 expectedShares = treasury.previewDeposit(depositAmount);
        uint256 expectedAssets = treasury.previewRedeem(depositAmount);
        
        assertGt(expectedShares, 0, "previewDeposit should return positive shares");
        assertGt(expectedAssets, 0, "previewRedeem should return positive assets");
    }

    function test_max_functions_with_positions() public {
        uint256 depositAmount = 100e18;
        
        // Test max functions
        assertEq(treasury.maxDeposit(address(this)), type(uint256).max, "maxDeposit should be max uint256");
        assertEq(treasury.maxRedeem(address(this)), 0, "maxRedeem should be 0 with no shares");
        
        // After deposit
        uint256 shares = treasury.deposit(depositAmount, address(this));
        assertEq(treasury.maxRedeem(address(this)), shares, "maxRedeem should equal shares owned");
    }

    function test_asset_approval_to_pool() public {
        assertEq(asset.allowance(address(treasury), address(pool)), type(uint256).max, "treasury should have max approval to pool");
    }
}