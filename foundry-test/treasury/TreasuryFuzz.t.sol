// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/Treasury.sol";
import "contracts/mocks/MockERC20Mintable.sol";

contract MockTreasuryVault {
    function burn(uint256, uint256[2] calldata, uint256) external {}
}

contract MockTreasuryFactory {
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

contract TreasuryFuzzTest is Test {
    Treasury public treasury;
    MockERC20Mintable public asset;
    MockTreasuryFactory public factory;
    MockTreasuryVault public vault;
    address internal maker = makeAddr("maker");

    function setUp() public {
        asset = new MockERC20Mintable("Mock Asset", "mAsset", 18);
        factory = new MockTreasuryFactory();
        treasury = new Treasury(asset, IAutomatorFactory(address(factory)));
        vault = new MockTreasuryVault();

        factory.setVault(address(vault), true);
        factory.setMaker(maker, true);
        
        // Mint large amount for fuzzing
        asset.mint(address(this), type(uint128).max);
        asset.approve(address(treasury), type(uint256).max);
    }

    function invariant_erc4626_compliance() public {
        uint256 totalAssets = treasury.totalAssets();
        uint256 totalShares = treasury.totalSupply();
        
        if (totalShares > 0) {
            assertGe(totalAssets, totalShares, "assets should be >= shares when shares exist");
        }
        
        // Test preview functions consistency
        if (totalShares > 0 && totalAssets > 0) {
            uint256 testAmount = 1e18;
            uint256 previewShares = treasury.previewDeposit(testAmount);
            uint256 previewAssets = treasury.previewWithdraw(testAmount);
            
            assertGt(previewShares, 0, "previewDeposit should return positive shares");
            assertGt(previewAssets, 0, "previewWithdraw should return positive assets");
        }
    }

    function invariant_total_assets_consistency() public {
        assertEq(
            treasury.totalAssets(),
            asset.balanceOf(address(treasury)) + treasury.totalPositions(),
            "totalAssets should equal asset balance plus positions"
        );
    }

    function testFuzz_deposit_withdrawal_roundtrip(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        uint256 initialBalance = asset.balanceOf(address(this));
        
        // Deposit
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "shares should equal amount for first deposit");
        assertEq(asset.balanceOf(address(this)), initialBalance - amount, "asset balance should decrease");
        
        // Withdraw
        uint256 withdrawnAssets = treasury.withdraw(amount, address(this), address(this));
        
        assertEq(withdrawnAssets, amount, "withdrawn assets should equal deposited amount");
        assertEq(asset.balanceOf(address(this)), initialBalance, "asset balance should be restored");
        assertEq(treasury.balanceOf(address(this)), 0, "shares should be zero after withdrawal");
    }

    function testFuzz_mint_redeem_roundtrip(uint256 shares) public {
        shares = bound(shares, 1e6, type(uint64).max);
        
        uint256 initialBalance = asset.balanceOf(address(this));
        
        // Mint shares
        uint256 assets = treasury.mint(shares, address(this));
        
        assertEq(assets, shares, "assets should equal shares for first mint");
        assertEq(treasury.balanceOf(address(this)), shares, "should have minted shares");
        
        // Redeem shares
        uint256 redeemedAssets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(redeemedAssets, assets, "redeemed assets should equal minted assets");
        assertEq(asset.balanceOf(address(this)), initialBalance, "asset balance should be restored");
        assertEq(treasury.balanceOf(address(this)), 0, "shares should be zero after redeem");
    }

    function testFuzz_multiple_users_deposits(uint256 amount1, uint256 amount2, uint256 amount3) public {
        amount1 = bound(amount1, 1e6, type(uint32).max);
        amount2 = bound(amount2, 1e6, type(uint32).max);
        amount3 = bound(amount3, 1e6, type(uint32).max);
        
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");
        address user3 = makeAddr("user3");
        
        // Fund users
        asset.mint(user1, amount1);
        asset.mint(user2, amount2);
        asset.mint(user3, amount3);
        
        // Set up approvals
        vm.prank(user1);
        asset.approve(address(treasury), amount1);
        vm.prank(user2);
        asset.approve(address(treasury), amount2);
        vm.prank(user3);
        asset.approve(address(treasury), amount3);
        
        // Deposits
        vm.prank(user1);
        uint256 shares1 = treasury.deposit(amount1, user1);
        
        vm.prank(user2);
        uint256 shares2 = treasury.deposit(amount2, user2);
        
        vm.prank(user3);
        uint256 shares3 = treasury.deposit(amount3, user3);
        
        // Verify individual balances
        assertEq(treasury.balanceOf(user1), shares1, "user1 shares");
        assertEq(treasury.balanceOf(user2), shares2, "user2 shares");
        assertEq(treasury.balanceOf(user3), shares3, "user3 shares");
        
        // Verify total supply
        assertEq(treasury.totalSupply(), shares1 + shares2 + shares3, "total supply");
        
        // Verify total assets
        assertEq(treasury.totalAssets(), amount1 + amount2 + amount3, "total assets");
    }

    function testFuzz_position_creation_with_deposits(uint256 depositAmount, uint256 positionAmount) public {
        depositAmount = bound(depositAmount, 1e6, type(uint64).max);
        positionAmount = bound(positionAmount, 1e6, depositAmount);
        
        // Initial deposit
        uint256 shares = treasury.deposit(depositAmount, address(this));
        
        // Create position
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        // Verify state
        assertEq(treasury.totalPositions(), positionAmount, "position amount");
        assertEq(treasury.totalAssets(), depositAmount, "total assets includes position");
        assertEq(asset.balanceOf(address(treasury)), depositAmount - positionAmount, "remaining asset balance");
        
        // New deposit should work
        uint256 newDepositAmount = bound(depositAmount / 4, 1e6, type(uint32).max);
        uint256 newShares = treasury.deposit(newDepositAmount, address(this));
        
        assertGt(newShares, 0, "should receive new shares");
        assertEq(treasury.balanceOf(address(this)), shares + newShares, "total user shares");
    }

    function testFuzz_exchange_rate_with_positions(uint256 initialDeposit, uint256 positionAmount, uint256 secondDeposit) public {
        initialDeposit = bound(initialDeposit, 1e18, type(uint64).max);
        positionAmount = bound(positionAmount, 1e6, initialDeposit);
        secondDeposit = bound(secondDeposit, 1e6, type(uint32).max);
        
        // First deposit establishes 1:1 ratio
        uint256 shares1 = treasury.deposit(initialDeposit, address(this));
        assertEq(shares1, initialDeposit, "first deposit 1:1 ratio");
        
        // Create position (moves assets but maintains totalAssets)
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        // Second deposit - exchange rate should remain 1:1 since totalAssets unchanged
        uint256 shares2 = treasury.deposit(secondDeposit, address(this));
        assertEq(shares2, secondDeposit, "second deposit should maintain 1:1 ratio");
        
        // Verify total shares and assets
        assertEq(treasury.totalSupply(), shares1 + shares2, "total supply");
        assertEq(treasury.totalAssets(), initialDeposit + secondDeposit, "total assets");
    }

    function testFuzz_partial_withdrawals(uint256 depositAmount, uint256 withdrawRatio) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        withdrawRatio = bound(withdrawRatio, 1, 99);
        
        uint256 shares = treasury.deposit(depositAmount, address(this));
        uint256 withdrawAmount = (depositAmount * withdrawRatio) / 100;
        
        uint256 initialAssetBalance = asset.balanceOf(address(this));
        uint256 withdrawnShares = treasury.withdraw(withdrawAmount, address(this), address(this));
        
        assertEq(withdrawnShares, withdrawAmount, "withdrawn shares should equal amount");
        assertEq(treasury.balanceOf(address(this)), shares - withdrawAmount, "remaining shares");
        assertEq(asset.balanceOf(address(this)), initialAssetBalance + withdrawAmount, "received assets");
    }

    function testFuzz_preview_functions_accuracy(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // Test preview functions on empty treasury
        uint256 previewDepositEmpty = treasury.previewDeposit(amount);
        uint256 previewMintEmpty = treasury.previewMint(amount);
        
        assertEq(previewDepositEmpty, amount, "previewDeposit empty should be 1:1");
        assertEq(previewMintEmpty, amount, "previewMint empty should be 1:1");
        
        // Make initial deposit
        uint256 actualShares = treasury.deposit(amount, address(this));
        assertEq(actualShares, previewDepositEmpty, "actual should match preview");
        
        // Test preview functions with existing deposits
        uint256 previewDepositFull = treasury.previewDeposit(amount);
        uint256 previewRedeemFull = treasury.previewRedeem(amount);
        uint256 previewWithdrawFull = treasury.previewWithdraw(amount);
        
        assertEq(previewDepositFull, amount, "previewDeposit full should be 1:1");
        assertEq(previewRedeemFull, amount, "previewRedeem should be 1:1");
        assertEq(previewWithdrawFull, amount, "previewWithdraw should be 1:1");
    }

    function testFuzz_max_functions_accuracy(uint256 userDeposit) public {
        userDeposit = bound(userDeposit, 0, type(uint64).max);
        
        if (userDeposit > 0) {
            treasury.deposit(userDeposit, address(this));
        }
        
        uint256 userShares = treasury.balanceOf(address(this));
        uint256 userAssets = treasury.previewRedeem(userShares);
        
        assertEq(treasury.maxDeposit(address(this)), type(uint256).max, "maxDeposit unlimited");
        assertEq(treasury.maxMint(address(this)), type(uint256).max, "maxMint unlimited");
        assertEq(treasury.maxWithdraw(address(this)), userAssets, "maxWithdraw equals user assets");
        assertEq(treasury.maxRedeem(address(this)), userShares, "maxRedeem equals user shares");
    }

    function testFuzz_edge_case_zero_amounts(uint256 nonZeroAmount) public {
        nonZeroAmount = bound(nonZeroAmount, 1e6, type(uint64).max);
        
        // Test zero amount operations
        uint256 zeroShares = treasury.deposit(0, address(this));
        assertEq(zeroShares, 0, "zero deposit should return zero shares");
        
        uint256 zeroAssets = treasury.mint(0, address(this));
        assertEq(zeroAssets, 0, "zero mint should return zero assets");
        
        uint256 zeroWithdraw = treasury.withdraw(0, address(this), address(this));
        assertEq(zeroWithdraw, 0, "zero withdraw should return zero shares");
        
        uint256 zeroRedeem = treasury.redeem(0, address(this), address(this));
        assertEq(zeroRedeem, 0, "zero redeem should return zero assets");
        
        // Make actual deposit for subsequent tests
        treasury.deposit(nonZeroAmount, address(this));
        
        // Test zero operations with existing balance
        uint256 zeroSharesWithBalance = treasury.deposit(0, address(this));
        assertEq(zeroSharesWithBalance, 0, "zero deposit with balance should return zero shares");
    }

    function testFuzz_recipient_different_from_owner(uint256 amount, address recipient) public {
        amount = bound(amount, 1e6, type(uint64).max);
        vm.assume(recipient != address(0));
        vm.assume(recipient != address(this));
        
        // Deposit for different recipient
        uint256 shares = treasury.deposit(amount, recipient);
        
        assertEq(treasury.balanceOf(recipient), shares, "recipient should receive shares");
        assertEq(treasury.balanceOf(address(this)), 0, "sender should have no shares");
        
        // Withdraw from owner to different recipient
        uint256 withdrawAmount = amount / 2;
        uint256 initialAssetBalance = asset.balanceOf(address(this));
        
        vm.prank(recipient);
        treasury.withdraw(withdrawAmount, address(this), recipient);
        
        assertEq(asset.balanceOf(address(this)), initialAssetBalance + withdrawAmount, "recipient should receive assets");
    }

    function testFuzz_large_number_handling(uint256 amount) public {
        // Test with very large amounts
        amount = bound(amount, type(uint64).max / 2, type(uint128).max);
        
        // Mint sufficient tokens
        asset.mint(address(this), amount);
        
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "should handle large amounts");
        assertEq(treasury.totalSupply(), amount, "total supply should match");
        assertEq(treasury.totalAssets(), amount, "total assets should match");
        
        // Test withdrawal of large amount
        uint256 withdrawnAssets = treasury.withdraw(amount, address(this), address(this));
        
        assertEq(withdrawnAssets, amount, "should withdraw large amount");
        assertEq(treasury.totalSupply(), 0, "supply should be zero after withdrawal");
    }

    function testFuzz_position_expiry_cleanup(uint256 positionAmount, uint256 timeAdvance) public {
        positionAmount = bound(positionAmount, 1e6, type(uint64).max);
        timeAdvance = bound(timeAdvance, 1, 365 days);
        
        // Fund treasury and create position
        treasury.deposit(positionAmount, address(this));
        
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        assertEq(treasury.totalPositions(), positionAmount, "position created");
        
        // Advance time past expiry
        vm.warp(expiry + timeAdvance);
        
        // Any operation should trigger cleanup
        treasury.deposit(1e6, address(this));
        
        assertEq(treasury.totalPositions(), 0, "expired positions should be cleaned up");
    }
}