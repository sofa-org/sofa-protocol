// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/RCHTreasury.sol";
import "contracts/mocks/MockERC20Mintable.sol";

contract MockRCHVault {
    function burn(uint256, uint256[2] calldata, uint256) external {}
}

contract MockRCHFactory {
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

contract MockZenRCH is IZenRCH, MockERC20Mintable {
    MockERC20Mintable public rchToken;
    
    constructor(string memory name, string memory symbol) MockERC20Mintable(name, symbol, 18) {}
    
    function setRCHToken(MockERC20Mintable _rchToken) external {
        rchToken = _rchToken;
    }

    function mint(uint256 amount) external returns (uint256) {
        _mint(msg.sender, amount);
        return amount;
    }

    function withdraw(address to, uint256 shares) external returns (uint256) {
        _burn(msg.sender, shares);
        if (address(rchToken) != address(0)) {
            rchToken.mint(to, shares);
        }
        return shares;
    }
}

contract RCHTreasuryFuzzTest is Test {
    RCHTreasury public treasury;
    MockERC20Mintable public rch;
    MockZenRCH public zenRCH;
    MockRCHFactory public factory;
    MockRCHVault public vault;
    address internal maker = makeAddr("maker");

    function setUp() public {
        rch = new MockERC20Mintable("Mock RCH", "mRCH", 18);
        zenRCH = new MockZenRCH("Mock ZenRCH", "mZenRCH");
        zenRCH.setRCHToken(rch);
        factory = new MockRCHFactory();
        treasury = new RCHTreasury(rch, zenRCH, IAutomatorFactory(address(factory)));
        vault = new MockRCHVault();

        factory.setVault(address(vault), true);
        factory.setMaker(maker, true);
        
        // Mint large amount for fuzzing
        rch.mint(address(this), type(uint128).max);
        rch.approve(address(treasury), type(uint256).max);
    }

    function invariant_rch_zenrch_consistency() public {
        // Treasury should have max approval to zenRCH
        assertEq(rch.allowance(address(treasury), address(zenRCH)), type(uint256).max, "treasury should have max approval to zenRCH");
        
        // Total assets should equal zenRCH balance plus positions
        uint256 zenRCHBalance = zenRCH.balanceOf(address(treasury));
        uint256 totalPositions = treasury.totalPositions();
        uint256 totalAssets = treasury.totalAssets();
        
        assertEq(totalAssets, zenRCHBalance + totalPositions, "totalAssets should equal zenRCH balance plus positions");
    }

    function invariant_asset_consistency() public {
        // The asset should be zenRCH
        assertEq(address(treasury.asset()), address(zenRCH), "asset should be zenRCH");
        assertEq(address(treasury.rch()), address(rch), "rch should be set correctly");
    }

    function testFuzz_rch_to_zenrch_conversion(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        uint256 initialRCHBalance = rch.balanceOf(address(this));
        uint256 initialZenRCHBalance = zenRCH.balanceOf(address(treasury));
        
        // Deposit RCH, should get zenRCH
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "shares should equal amount");
        assertEq(rch.balanceOf(address(this)), initialRCHBalance - amount, "RCH should be deducted");
        assertEq(zenRCH.balanceOf(address(treasury)), initialZenRCHBalance + amount, "treasury should receive zenRCH");
        assertEq(treasury.totalAssets(), initialZenRCHBalance + amount, "totalAssets should include zenRCH");
    }

    function testFuzz_zenrch_to_rch_conversion(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // First deposit to get shares
        uint256 shares = treasury.deposit(amount, address(this));
        
        uint256 initialRCHBalance = rch.balanceOf(address(this));
        uint256 initialZenRCHBalance = zenRCH.balanceOf(address(treasury));
        
        // Redeem shares, should get RCH back
        uint256 assets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(assets, amount, "redeemed assets should equal original amount");
        assertEq(rch.balanceOf(address(this)), initialRCHBalance + amount, "should receive RCH");
        assertEq(zenRCH.balanceOf(address(treasury)), initialZenRCHBalance - amount, "zenRCH should be withdrawn");
    }

    function testFuzz_position_creation_with_zenrch(uint256 depositAmount, uint256 positionAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        positionAmount = bound(positionAmount, 1e6, depositAmount);
        
        // Deposit RCH to get zenRCH
        treasury.deposit(depositAmount, address(this));
        
        uint256 initialZenRCHBalance = zenRCH.balanceOf(address(treasury));
        
        // Create position (should transfer zenRCH to vault)
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        assertEq(treasury.totalPositions(), positionAmount, "position amount");
        assertEq(zenRCH.balanceOf(address(treasury)), initialZenRCHBalance - positionAmount, "zenRCH transferred to vault");
        assertEq(zenRCH.balanceOf(address(vault)), positionAmount, "vault should receive zenRCH");
        assertEq(treasury.totalAssets(), depositAmount, "totalAssets should include position");
    }

    function testFuzz_multiple_users_rch_zenrch(uint256 amount1, uint256 amount2, uint256 amount3) public {
        amount1 = bound(amount1, 1e6, type(uint32).max);
        amount2 = bound(amount2, 1e6, type(uint32).max);
        amount3 = bound(amount3, 1e6, type(uint32).max);
        
        address user1 = makeAddr("user1");
        address user2 = makeAddr("user2");
        address user3 = makeAddr("user3");
        
        // Fund users with RCH
        rch.mint(user1, amount1);
        rch.mint(user2, amount2);
        rch.mint(user3, amount3);
        
        // Set up approvals
        vm.prank(user1);
        rch.approve(address(treasury), amount1);
        vm.prank(user2);
        rch.approve(address(treasury), amount2);
        vm.prank(user3);
        rch.approve(address(treasury), amount3);
        
        // Deposits (RCH -> zenRCH)
        vm.prank(user1);
        uint256 shares1 = treasury.deposit(amount1, user1);
        
        vm.prank(user2);
        uint256 shares2 = treasury.deposit(amount2, user2);
        
        vm.prank(user3);
        uint256 shares3 = treasury.deposit(amount3, user3);
        
        // Verify shares distribution
        assertEq(treasury.balanceOf(user1), shares1, "user1 shares");
        assertEq(treasury.balanceOf(user2), shares2, "user2 shares");
        assertEq(treasury.balanceOf(user3), shares3, "user3 shares");
        
        // Verify total zenRCH in treasury
        assertEq(zenRCH.balanceOf(address(treasury)), amount1 + amount2 + amount3, "total zenRCH");
        
        // Each user redeems (zenRCH -> RCH)
        vm.prank(user1);
        treasury.redeem(shares1, user1, user1);
        assertEq(rch.balanceOf(user1), amount1, "user1 should get RCH back");
        
        vm.prank(user2);
        treasury.redeem(shares2, user2, user2);
        assertEq(rch.balanceOf(user2), amount2, "user2 should get RCH back");
        
        vm.prank(user3);
        treasury.redeem(shares3, user3, user3);
        assertEq(rch.balanceOf(user3), amount3, "user3 should get RCH back");
    }

    function testFuzz_zenrch_yield_simulation(uint256 depositAmount, uint256 yieldAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        yieldAmount = bound(yieldAmount, 1e6, type(uint32).max);
        
        // Initial deposit
        uint256 shares = treasury.deposit(depositAmount, address(this));
        
        // Simulate zenRCH yield by minting additional zenRCH to treasury
        zenRCH.mint(address(treasury), yieldAmount);
        
        // Total assets should include yield
        assertEq(treasury.totalAssets(), depositAmount + yieldAmount, "totalAssets should include yield");
        
        // New deposit should get fewer shares due to increased exchange rate
        uint256 newDepositAmount = bound(depositAmount / 4, 1e6, type(uint32).max);
        uint256 totalAssetsBefore = treasury.totalAssets();
        uint256 totalSharesBefore = treasury.totalSupply();
        
        uint256 newShares = treasury.deposit(newDepositAmount, address(this));
        
        if (totalSharesBefore > 0) {
            uint256 expectedShares = (newDepositAmount * totalSharesBefore) / totalAssetsBefore;
            assertEq(newShares, expectedShares, "new shares should reflect yield-adjusted exchange rate");
        }
    }

    function testFuzz_rch_approval_management(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // Verify initial approval
        assertEq(rch.allowance(address(treasury), address(zenRCH)), type(uint256).max, "initial approval should be max");
        
        // Multiple operations should not affect approval
        for (uint256 i = 0; i < 3; i++) {
            uint256 depositAmount = amount / 3;
            if (depositAmount > 0) {
                treasury.deposit(depositAmount, address(this));
                assertEq(rch.allowance(address(treasury), address(zenRCH)), type(uint256).max, "approval should remain max");
            }
        }
        
        // Redeem operations should not affect approval
        uint256 totalShares = treasury.balanceOf(address(this));
        if (totalShares > 0) {
            treasury.redeem(totalShares / 2, address(this), address(this));
            assertEq(rch.allowance(address(treasury), address(zenRCH)), type(uint256).max, "approval should remain max after redeem");
        }
    }

    function testFuzz_disabled_operations(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // mint() should revert
        vm.expectRevert("RCHTreasury: minting is not supported, use deposit instead");
        treasury.mint(amount, address(this));
        
        // withdraw() should revert
        vm.expectRevert("RCHTreasury: withdrawing is not supported, use redeem instead");
        treasury.withdraw(amount, address(this), address(this));
    }

    function testFuzz_position_with_zenrch_yield(uint256 depositAmount, uint256 positionAmount, uint256 yieldAmount) public {
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
        
        // Add yield to remaining zenRCH
        zenRCH.mint(address(treasury), yieldAmount);
        
        // Total assets should include yield and position
        assertEq(
            treasury.totalAssets(),
            depositAmount - positionAmount + yieldAmount + positionAmount,
            "totalAssets should include yield and position"
        );
        
        // New deposit should work with yield-adjusted rate
        uint256 newDepositAmount = bound(depositAmount / 4, 1e6, type(uint32).max);
        uint256 newShares = treasury.deposit(newDepositAmount, address(this));
        
        assertGt(newShares, 0, "should receive shares with yield");
    }

    function testFuzz_large_amounts_rch_zenrch(uint256 amount) public {
        amount = bound(amount, type(uint64).max / 2, type(uint128).max);
        
        // Mint sufficient RCH
        rch.mint(address(this), amount);
        
        // Test large deposit (RCH -> zenRCH)
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "should handle large deposit amounts");
        assertEq(zenRCH.balanceOf(address(treasury)), amount, "should mint large zenRCH amounts");
        
        // Test large redeem (zenRCH -> RCH)
        uint256 initialRCHBalance = rch.balanceOf(address(this));
        uint256 assets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(assets, amount, "should handle large redeem");
        assertEq(rch.balanceOf(address(this)), initialRCHBalance + amount, "should receive large RCH amount");
    }

    function testFuzz_zero_amounts_rch_zenrch(uint256 nonZeroAmount) public {
        nonZeroAmount = bound(nonZeroAmount, 1e6, type(uint64).max);
        
        // Test zero amount operations
        uint256 zeroShares = treasury.deposit(0, address(this));
        assertEq(zeroShares, 0, "zero deposit should return zero shares");
        assertEq(zenRCH.balanceOf(address(treasury)), 0, "no zenRCH for zero deposit");
        
        uint256 zeroAssets = treasury.redeem(0, address(this), address(this));
        assertEq(zeroAssets, 0, "zero redeem should return zero assets");
        
        // Make actual deposit for subsequent tests
        treasury.deposit(nonZeroAmount, address(this));
        
        // Test zero operations with existing balance
        uint256 zeroSharesWithBalance = treasury.deposit(0, address(this));
        assertEq(zeroSharesWithBalance, 0, "zero deposit with balance should return zero shares");
    }

    function testFuzz_preview_functions_rch_zenrch(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        // Test preview functions on empty treasury
        uint256 previewDepositEmpty = treasury.previewDeposit(amount);
        assertEq(previewDepositEmpty, amount, "previewDeposit empty should be 1:1");
        
        // Make initial deposit
        uint256 actualShares = treasury.deposit(amount, address(this));
        assertEq(actualShares, previewDepositEmpty, "actual should match preview");
        
        // Test preview functions with existing deposits
        uint256 previewDepositFull = treasury.previewDeposit(amount);
        uint256 previewRedeemFull = treasury.previewRedeem(amount);
        
        assertEq(previewDepositFull, amount, "previewDeposit full should be 1:1");
        assertEq(previewRedeemFull, amount, "previewRedeem should be 1:1");
    }

    function testFuzz_recipient_different_from_owner_rch(uint256 amount, address recipient) public {
        amount = bound(amount, 1e6, type(uint64).max);
        vm.assume(recipient != address(0));
        vm.assume(recipient != address(this));
        
        // Deposit for different recipient
        uint256 shares = treasury.deposit(amount, recipient);
        
        assertEq(treasury.balanceOf(recipient), shares, "recipient should receive shares");
        assertEq(treasury.balanceOf(address(this)), 0, "sender should have no shares");
        assertEq(zenRCH.balanceOf(address(treasury)), amount, "treasury should have zenRCH");
        
        // Record initial RCH balance before redeem
        uint256 initialRCHBalance = rch.balanceOf(address(this));
        
        // Redeem from owner to different recipient
        vm.prank(recipient);
        treasury.redeem(shares / 2, address(this), recipient);
        
        // Check that the recipient received the correct amount of RCH (increment)
        assertEq(rch.balanceOf(address(this)), initialRCHBalance + amount / 2, "recipient should receive RCH increment");
    }

    function testFuzz_zenrch_direct_manipulation(uint256 depositAmount, uint256 directAmount) public {
        depositAmount = bound(depositAmount, 1e18, type(uint64).max);
        directAmount = bound(directAmount, 1e6, type(uint32).max);
        
        // Normal deposit
        treasury.deposit(depositAmount, address(this));
        
        // Direct zenRCH transfer to treasury (simulating external yield or donations)
        zenRCH.mint(address(treasury), directAmount);
        
        // This should increase totalAssets
        assertEq(treasury.totalAssets(), depositAmount + directAmount, "totalAssets should include direct transfers");
        
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
}