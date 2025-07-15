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
    mapping(address => bool) public _vaults;
    mapping(address => bool) public _makers;

    function vaults(address vault) external view returns (bool) {
        return _vaults[vault];
    }

    function makers(address maker) external view returns (bool) {
        return _makers[maker];
    }

    function setVault(address vault, bool isVault) external {
        _vaults[vault] = isVault;
    }

    function setMaker(address maker, bool isMaker) external {
        _makers[maker] = isMaker;
    }
}

contract AAVETreasuryFuzzTest is Test {
    AAVETreasury public treasury;
    MockERC20Mintable public asset;
    MockATokenMintable public aToken;
    MockAavePool public pool;
    MockAAVEFactory public factory;
    MockAAVEVault public vault;
    address internal maker = makeAddr("maker");

    function setUp() public {
        asset = new MockERC20Mintable("Mock Asset", "mAsset", 18);
        aToken = new MockATokenMintable(address(asset), "Mock aAsset", "maASS", 18);
        pool = new MockAavePool(IERC20(address(asset)), aToken);
        factory = new MockAAVEFactory();
        treasury = new AAVETreasury(asset, IPool(address(pool)), IAutomatorFactory(address(factory)));
        vault = new MockAAVEVault();

        factory.setVault(address(vault), true);
        factory.setMaker(maker, true);
        
        // Mint large amount for fuzzing
        asset.mint(address(this), type(uint128).max);
        asset.approve(address(treasury), type(uint256).max);
    }

    function test_aave_integration_consistency() public view {
        // aToken balance should represent deposits minus positions
        uint256 aTokenBalance = aToken.balanceOf(address(treasury));
        uint256 totalPositions = treasury.totalPositions();
        uint256 totalAssets = treasury.totalAssets();
        
        assertEq(totalAssets, aTokenBalance + totalPositions, "totalAssets should equal aToken balance plus positions");
    }

    function test_pool_asset_consistency() public view {
        // Assets deposited to pool should be backed by aTokens
        uint256 poolAssets = asset.balanceOf(address(pool));
        uint256 totalATokens = aToken.totalSupply();
        
        assertEq(poolAssets, totalATokens, "pool assets should equal total aTokens");
    }

    function testFuzz_deposit_aave_integration(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        uint256 initialPoolBalance = asset.balanceOf(address(pool));
        uint256 initialATokenBalance = aToken.balanceOf(address(treasury));
        
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "shares should equal amount");
        assertEq(asset.balanceOf(address(pool)), initialPoolBalance + amount, "assets should go to pool");
        assertEq(aToken.balanceOf(address(treasury)), initialATokenBalance + amount, "treasury should receive aTokens");
        assertEq(treasury.totalAssets(), initialATokenBalance + amount, "totalAssets should include aTokens");
    }

    function testFuzz_redeem_aave_integration(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // First deposit
        uint256 shares = treasury.deposit(amount, address(this));
        
        uint256 initialAssetBalance = asset.balanceOf(address(this));
        uint256 initialPoolBalance = asset.balanceOf(address(pool));
        
        // Redeem all shares
        uint256 assets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(assets, amount, "redeemed assets should equal deposited amount");
        assertEq(asset.balanceOf(address(this)), initialAssetBalance + amount, "user should receive assets");
        assertEq(asset.balanceOf(address(pool)), initialPoolBalance - amount, "assets should leave pool");
        assertEq(aToken.balanceOf(address(treasury)), 0, "treasury should have no aTokens");
    }

    function testFuzz_position_creation_with_aave(uint256 depositAmount, uint256 positionAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        positionAmount = bound(positionAmount, 1e6, depositAmount);
        
        // Deposit to get aTokens
        treasury.deposit(depositAmount, address(this));
        
        uint256 initialATokenBalance = aToken.balanceOf(address(treasury));
        
        // Create position
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        assertEq(treasury.totalPositions(), positionAmount, "position amount");
        assertEq(aToken.balanceOf(address(treasury)), initialATokenBalance - positionAmount, "aTokens transferred to vault");
        assertEq(aToken.balanceOf(address(vault)), positionAmount, "vault should receive aTokens");
        assertEq(treasury.totalAssets(), depositAmount, "totalAssets should include position");
    }

    function testFuzz_multiple_deposits_aave_yield(uint256 amount1, uint256 amount2, uint256 yieldAmount) public {
        amount1 = bound(amount1, 1e6, 1e18 * 1000);  // 1000 tokens max
        amount2 = bound(amount2, 1e6, 1e18 * 1000);  // 1000 tokens max  
        yieldAmount = bound(yieldAmount, 1e6, 1e18 * 100);  // 100 tokens max yield
        
        // First deposit
        uint256 shares1 = treasury.deposit(amount1, address(this));
        
        // Simulate AAVE yield by minting additional aTokens
        aToken.mint(address(treasury), yieldAmount);
        
        // Second deposit should account for increased aToken balance
        uint256 totalAssetsBeforeSecond = treasury.totalAssets();
        uint256 totalSharesBeforeSecond = treasury.totalSupply();
        
        uint256 shares2 = treasury.deposit(amount2, address(this));
        
        // Exchange rate should reflect the yield
        if (totalSharesBeforeSecond > 0) {
            uint256 expectedShares = (amount2 * totalSharesBeforeSecond) / totalAssetsBeforeSecond;
            // Allow for 1% precision difference due to rounding with ERC4626 math
            uint256 tolerance = expectedShares / 100;
            if (tolerance == 0) tolerance = 1;
            assertApproxEqAbs(shares2, expectedShares, tolerance, "shares should reflect exchange rate with yield");
        }
        
        assertEq(treasury.totalSupply(), shares1 + shares2, "total shares");
        assertEq(treasury.totalAssets(), amount1 + amount2 + yieldAmount, "total assets including yield");
    }

    function testFuzz_aave_pool_interactions(uint256 depositAmount, uint256 withdrawAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        withdrawAmount = bound(withdrawAmount, 1e6, depositAmount);
        
        // Track pool state
        uint256 initialPoolAssets = asset.balanceOf(address(pool));
        
        // Deposit
        treasury.deposit(depositAmount, address(this));
        
        assertEq(asset.balanceOf(address(pool)), initialPoolAssets + depositAmount, "pool should receive assets");
        assertEq(aToken.balanceOf(address(treasury)), depositAmount, "treasury should have aTokens");
        
        // Partial redemption (AAVETreasury doesn't support withdraw)
        uint256 redeemShares = (withdrawAmount * treasury.totalSupply()) / treasury.totalAssets();
        uint256 withdrawnAssets = treasury.redeem(redeemShares, address(this), address(this));
        
        assertEq(asset.balanceOf(address(pool)), initialPoolAssets + depositAmount - withdrawnAssets, "pool assets after redemption");
        assertEq(aToken.balanceOf(address(treasury)), depositAmount - withdrawnAssets, "remaining aTokens");
        assertEq(treasury.balanceOf(address(this)), depositAmount - redeemShares, "remaining shares");
    }

    function testFuzz_position_with_aave_yield(uint256 depositAmount, uint256 positionAmount, uint256 yieldAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        positionAmount = bound(positionAmount, 1e6, depositAmount / 2);
        yieldAmount = bound(yieldAmount, 1e6, type(uint32).max);
        
        // Initial deposit
        treasury.deposit(depositAmount, address(this));
        
        // Create position
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        // Simulate yield on remaining aTokens
        aToken.mint(address(treasury), yieldAmount);
        
        // Total assets should include yield
        assertEq(
            treasury.totalAssets(),
            depositAmount - positionAmount + yieldAmount + positionAmount,
            "totalAssets should include yield and position"
        );
        
        // New deposit should work with yield-adjusted exchange rate
        uint256 newDepositAmount = bound(depositAmount / 4, 1e6, type(uint32).max);
        uint256 newShares = treasury.deposit(newDepositAmount, address(this));
        
        assertGt(newShares, 0, "should receive shares even with yield");
    }

    function testFuzz_atoken_direct_transfers(uint256 depositAmount, uint256 transferAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        transferAmount = bound(transferAmount, 1e6, type(uint32).max);
        
        // Make deposit to get aTokens
        treasury.deposit(depositAmount, address(this));
        
        // Direct aToken transfer to treasury (simulating external yield)
        aToken.mint(address(treasury), transferAmount);
        
        // This should increase totalAssets
        assertEq(treasury.totalAssets(), depositAmount + transferAmount, "totalAssets should include direct transfers");
        
        // New deposits should work with updated exchange rate
        uint256 newDepositAmount = bound(depositAmount / 4, 1e6, type(uint32).max);
        uint256 totalAssetsBefore = treasury.totalAssets();
        uint256 totalSharesBefore = treasury.totalSupply();
        
        uint256 newShares = treasury.deposit(newDepositAmount, address(this));
        
        if (totalSharesBefore > 0) {
            uint256 expectedShares = (newDepositAmount * totalSharesBefore) / totalAssetsBefore;
            assertEq(newShares, expectedShares, "new shares should reflect updated exchange rate");
        }
    }

    function testFuzz_large_amounts_aave(uint256 amount) public {
        amount = bound(amount, type(uint64).max / 2, type(uint128).max);
        
        // Mint sufficient tokens
        asset.mint(address(this), amount);
        
        // Test large deposit
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "should handle large deposit amounts");
        assertEq(aToken.balanceOf(address(treasury)), amount, "should mint large aToken amounts");
        assertEq(asset.balanceOf(address(pool)), amount, "pool should handle large amounts");
        
        // Test large withdrawal
        uint256 assets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(assets, amount, "should handle large withdrawal");
        assertEq(aToken.balanceOf(address(treasury)), 0, "should burn all aTokens");
    }

    function testFuzz_pool_approval_handling(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // Verify treasury has max approval to pool
        assertEq(asset.allowance(address(treasury), address(pool)), type(uint256).max, "should have max approval");
        
        // Multiple deposits should work without approval issues
        for (uint256 i = 0; i < 3; i++) {
            uint256 depositAmount = amount / 3;
            if (depositAmount > 0) {
                treasury.deposit(depositAmount, address(this));
            }
        }
        
        // Approval should still be max
        assertEq(asset.allowance(address(treasury), address(pool)), type(uint256).max, "approval should remain max");
    }

    function testFuzz_aave_position_edge_cases(uint256 positionAmount) public {
        positionAmount = bound(positionAmount, 0, type(uint64).max);
        
        // Fund treasury
        uint256 fundAmount = positionAmount + 1e18;
        treasury.deposit(fundAmount, address(this));
        
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        if (positionAmount == 0) {
            // Zero amount position
            vm.prank(address(vault));
            treasury.mintPosition(expiry, anchorPrices, 0, maker);
            
            assertEq(treasury.totalPositions(), 0, "zero position amount");
            assertEq(aToken.balanceOf(address(vault)), 0, "no aTokens transferred for zero amount");
        } else {
            // Non-zero position
            vm.prank(address(vault));
            treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
            
            assertEq(treasury.totalPositions(), positionAmount, "position amount set");
            assertEq(aToken.balanceOf(address(vault)), positionAmount, "aTokens transferred to vault");
        }
    }

    function testFuzz_preview_functions_with_aave_yield(uint256 depositAmount, uint256 yieldAmount, uint256 testAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        yieldAmount = bound(yieldAmount, 1e6, type(uint32).max);
        testAmount = bound(testAmount, 1e6, type(uint32).max);
        
        // Initial deposit
        treasury.deposit(depositAmount, address(this));
        
        // Add yield
        aToken.mint(address(treasury), yieldAmount);
        
        // Test preview functions
        uint256 previewDeposit = treasury.previewDeposit(testAmount);
        uint256 previewMint = treasury.previewMint(testAmount);
        uint256 previewWithdraw = treasury.previewWithdraw(testAmount);
        uint256 previewRedeem = treasury.previewRedeem(testAmount);
        
        // All preview functions should return reasonable values
        assertGt(previewDeposit, 0, "previewDeposit should be positive");
        assertGt(previewMint, 0, "previewMint should be positive");
        assertGt(previewWithdraw, 0, "previewWithdraw should be positive");
        assertGt(previewRedeem, 0, "previewRedeem should be positive");
        
        // Test actual deposit matches preview
        uint256 actualShares = treasury.deposit(testAmount, address(this));
        assertEq(actualShares, previewDeposit, "actual deposit should match preview");
    }

    function testFuzz_concurrent_operations(uint256 depositSeed, uint256 positionSeed) public {
        // Use small, well-controlled amounts to avoid overflow
        uint256 amount1 = 1e18 + (depositSeed % 100) * 1e18;    // 1-100 tokens 
        uint256 amount2 = 1e18 + (depositSeed % 50) * 1e18;     // 1-50 tokens
        uint256 positionAmount = 1e6 + (positionSeed % 1e18);    // Small position amount
        
        address user2 = makeAddr("user2");
        asset.mint(user2, amount2);
        vm.prank(user2);
        asset.approve(address(treasury), amount2);
        
        // User 1 deposit
        treasury.deposit(amount1, address(this));
        
        // User 2 deposit
        vm.prank(user2);
        treasury.deposit(amount2, user2);
        
        // Create position
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        // Both users should be able to withdraw their proportional shares
        uint256 user1Shares = treasury.balanceOf(address(this));
        uint256 user2Shares = treasury.balanceOf(user2);
        
        if (user1Shares > 0) {
            uint256 redeemAmount = user1Shares / 2;
            if (redeemAmount > 0) {
                uint256 user1Assets = treasury.redeem(redeemAmount, address(this), address(this));
                assertGt(user1Assets, 0, "user1 should receive assets");
            }
        }
        
        if (user2Shares > 0) {
            vm.prank(user2);
            uint256 redeemAmount = user2Shares / 2;
            if (redeemAmount > 0) {
                uint256 user2Assets = treasury.redeem(redeemAmount, user2, user2);
                assertGt(user2Assets, 0, "user2 should receive assets");
            }
        }
    }
}