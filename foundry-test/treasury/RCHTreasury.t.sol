// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/RCHTreasury.sol";
import "contracts/mocks/MockERC20Mintable.sol";
contract MockRCHVault {
    function burn(uint256, uint256[2] calldata, uint256) external {}
}

contract MockRCHFactory {
    mapping(address => bool) public vaults;
    mapping(address => bool) public makers;
    
    function addVault(address vault) external {
        vaults[vault] = true;
    }
    
    function addMaker(address maker) external {
        makers[maker] = true;
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
        // Transfer equivalent RCH to the recipient
        if (address(rchToken) != address(0)) {
            rchToken.mint(to, shares);
        }
        return shares;
    }
}

contract RCHTreasuryTest is Test {
    RCHTreasury treasury;
    MockERC20Mintable rch;
    MockZenRCH zenRCH;
    MockRCHFactory factory;
    MockRCHVault vault;
    MockRCHVault vault2;
    address maker = makeAddr("maker");
    address maker2 = makeAddr("maker2");
    address user = makeAddr("user");

    function setUp() public {
        rch = new MockERC20Mintable("Mock RCH", "mRCH", 18);
        zenRCH = new MockZenRCH("Mock ZenRCH", "mZenRCH");
        zenRCH.setRCHToken(rch);
        factory = new MockRCHFactory();
        treasury = new RCHTreasury(rch, zenRCH, IAutomatorFactory(address(factory)));
        vault = new MockRCHVault();
        vault2 = new MockRCHVault();

        factory.addVault(address(vault));
        factory.addVault(address(vault2));
        factory.addMaker(address(this));
        factory.addMaker(maker);
        factory.addMaker(maker2);

        // Fund accounts
        rch.mint(address(this), 10000e18);
        rch.mint(user, 10000e18);
        rch.mint(address(treasury), 10000e18);
        
        // Set up approvals
        rch.approve(address(treasury), type(uint256).max);
        vm.prank(user);
        rch.approve(address(treasury), type(uint256).max);
    }

    function test_Constructor() public {
        assertEq(address(treasury.rch()), address(rch));
        assertEq(address(treasury.asset()), address(zenRCH));
        assertEq(address(treasury.factory()), address(factory));
        assertEq(rch.allowance(address(treasury), address(zenRCH)), type(uint256).max);
    }

    function test_Deposit() public {
        uint256 amount = 100e18;
        treasury.deposit(amount, address(this));

        assertEq(treasury.balanceOf(address(this)), amount);
        assertEq(zenRCH.balanceOf(address(treasury)), amount);
        assertEq(treasury.totalAssets(), amount);
    }

    function test_Redeem() public {
        uint256 depositAmount = 100e18;
        treasury.deposit(depositAmount, address(this));

        uint256 redeemShares = treasury.balanceOf(address(this));
        uint256 initialRCHBalance = rch.balanceOf(address(this));

        treasury.redeem(redeemShares, address(this), address(this));

        assertEq(treasury.balanceOf(address(this)), 0);
        assertEq(zenRCH.balanceOf(address(treasury)), 0);
        // The mock withdraw returns the shares amount, not the deposit amount
        assertEq(rch.balanceOf(address(this)), initialRCHBalance + depositAmount);
    }

    function test_Reverts() public {
        vm.expectRevert("RCHTreasury: minting is not supported, use deposit instead");
        treasury.mint(1, address(this));

        vm.expectRevert("RCHTreasury: withdrawing is not supported, use redeem instead");
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
        assertEq(zenRCH.balanceOf(address(treasury)), amount1 + amount2, "treasury should have zenRCH");
    }

    function test_Redeem_partial() public {
        uint256 depositAmount = 100e18;
        uint256 redeemShares = 50e18;
        
        uint256 totalShares = treasury.deposit(depositAmount, address(this));
        uint256 initialRCHBalance = rch.balanceOf(address(this));
        
        uint256 assets = treasury.redeem(redeemShares, address(this), address(this));
        
        assertEq(assets, redeemShares, "assets should equal redeemed shares");
        assertEq(treasury.balanceOf(address(this)), totalShares - redeemShares, "user should have remaining shares");
        assertEq(rch.balanceOf(address(this)), initialRCHBalance + redeemShares, "user should receive RCH tokens");
        assertEq(treasury.totalAssets(), depositAmount - redeemShares, "treasury should have remaining assets");
    }

    function test_MintPosition_multiple_positions() public {
        uint256 expiry1 = block.timestamp + 1 days;
        uint256 expiry2 = block.timestamp + 2 days;
        uint256[2] memory anchorPrices1 = [uint256(100e18), uint256(200e18)];
        uint256[2] memory anchorPrices2 = [uint256(150e18), uint256(250e18)];
        uint256 amount1 = 50e18;
        uint256 amount2 = 75e18;
        
        // Pre-fund treasury with zenRCH
        zenRCH.mint(address(treasury), amount1 + amount2);
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry1, anchorPrices1, amount1, address(this));
        
        vm.prank(address(vault2));
        treasury.mintPosition(expiry2, anchorPrices2, amount2, maker);
        
        assertEq(treasury.totalPositions(), amount1 + amount2, "total positions should be sum of both");
        assertEq(zenRCH.balanceOf(address(vault)), amount1, "vault should have zenRCH");
        assertEq(zenRCH.balanceOf(address(vault2)), amount2, "vault2 should have zenRCH");
    }

    function test_MintPosition_insufficient_balance() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 50e18;
        
        // Don't pre-fund treasury with zenRCH
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

    function test_RCH_to_ZenRCH_conversion() public {
        uint256 amount = 100e18;
        
        // Test that deposits convert RCH to zenRCH
        uint256 rchBalanceBefore = rch.balanceOf(address(this));
        treasury.deposit(amount, address(this));
        
        assertEq(rch.balanceOf(address(this)), rchBalanceBefore - amount, "RCH should be transferred from user");
        assertEq(zenRCH.balanceOf(address(treasury)), amount, "treasury should receive zenRCH");
        
        // Test that redeems convert zenRCH back to RCH
        uint256 shares = treasury.balanceOf(address(this));
        uint256 rchBalanceBeforeRedeem = rch.balanceOf(address(this));
        
        treasury.redeem(shares, address(this), address(this));
        
        assertEq(rch.balanceOf(address(this)), rchBalanceBeforeRedeem + amount, "user should receive RCH from zenRCH withdrawal");
        assertEq(zenRCH.balanceOf(address(treasury)), 0, "treasury should have no zenRCH left");
    }

    function test_totalAssets_includes_zenRCH_balance() public {
        uint256 depositAmount = 100e18;
        uint256 positionAmount = 50e18;
        
        // Deposit assets
        treasury.deposit(depositAmount, address(this));
        
        // Mint zenRCH directly to treasury (simulating yield)
        zenRCH.mint(address(treasury), 25e18);
        
        // Create position
        zenRCH.mint(address(treasury), positionAmount);
        vm.prank(address(vault));
        treasury.mintPosition(block.timestamp + 1 days, [uint256(100e18), uint256(200e18)], positionAmount, address(this));
        
        // totalAssets should include both zenRCH balance and positions
        assertEq(treasury.totalAssets(), depositAmount + 25e18 + positionAmount, "totalAssets should include zenRCH balance and positions");
    }

    function test_preview_functions_with_positions() public {
        uint256 depositAmount = 100e18;
        uint256 positionAmount = 50e18;
        
        // Deposit assets first to establish initial shares
        treasury.deposit(depositAmount, address(this));
        
        // Create position (which uses zenRCH in treasury)
        zenRCH.mint(address(treasury), positionAmount);
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

    function test_RCH_approval_to_zenRCH() public {
        assertEq(rch.allowance(address(treasury), address(zenRCH)), type(uint256).max, "treasury should have max approval to zenRCH");
    }

    function test_zenRCH_integration() public {
        uint256 amount = 100e18;
        
        // Test deposit flow through zenRCH
        uint256 zenRCHBalanceBefore = zenRCH.balanceOf(address(treasury));
        treasury.deposit(amount, address(this));
        
        assertEq(zenRCH.balanceOf(address(treasury)), zenRCHBalanceBefore + amount, "treasury should receive zenRCH from deposit");
        
        // Test redeem flow through zenRCH
        uint256 shares = treasury.balanceOf(address(this));
        uint256 rchBalanceBefore = rch.balanceOf(address(this));
        
        treasury.redeem(shares, address(this), address(this));
        
        assertEq(rch.balanceOf(address(this)), rchBalanceBefore + amount, "user should receive RCH from zenRCH withdrawal");
        assertEq(zenRCH.balanceOf(address(treasury)), zenRCHBalanceBefore, "treasury should have original zenRCH balance");
    }

    function test_deposit_with_different_recipients() public {
        uint256 amount = 100e18;
        
        // Deposit for different recipient
        treasury.deposit(amount, user);
        
        assertEq(treasury.balanceOf(user), amount, "recipient should receive shares");
        assertEq(treasury.balanceOf(address(this)), 0, "sender should have no shares");
        assertEq(zenRCH.balanceOf(address(treasury)), amount, "treasury should have zenRCH");
    }

    function test_redeem_with_different_recipients() public {
        uint256 amount = 100e18;
        
        // First deposit
        uint256 shares = treasury.deposit(amount, address(this));
        
        // Redeem to different recipient
        uint256 userRCHBefore = rch.balanceOf(user);
        treasury.redeem(shares, user, address(this));
        
        assertEq(rch.balanceOf(user), userRCHBefore + amount, "recipient should receive RCH");
        assertEq(treasury.balanceOf(address(this)), 0, "owner should have no shares left");
    }
}