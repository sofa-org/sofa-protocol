// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/Treasury.sol";
import "contracts/mocks/MockERC20Mintable.sol";

contract MockTreasuryVault {
    function burn(uint256, uint256[2] calldata, uint256) external {}
}

contract MockTreasuryFactory {
    mapping(address => bool) public vaults;
    mapping(address => bool) public makers;
    
    function addVault(address vault) external {
        vaults[vault] = true;
    }
    
    function addMaker(address maker) external {
        makers[maker] = true;
    }
}

contract TreasuryTest is Test {
    Treasury treasury;
    MockERC20Mintable asset;
    MockTreasuryFactory factory;
    MockTreasuryVault vault;
    MockTreasuryVault vault2;
    address maker = makeAddr("maker");
    address maker2 = makeAddr("maker2");
    address user = makeAddr("user");

    function setUp() public {
        asset = new MockERC20Mintable("Mock Asset", "mASS", 18);
        factory = new MockTreasuryFactory();
        treasury = new Treasury(asset, IAutomatorFactory(address(factory)));
        vault = new MockTreasuryVault();
        vault2 = new MockTreasuryVault();

        factory.addVault(address(vault));
        factory.addVault(address(vault2));
        factory.addMaker(address(this));
        factory.addMaker(maker);
        factory.addMaker(maker2);
        
        // Fund test accounts
        asset.mint(address(this), 1_000_000e18);
        asset.mint(user, 1_000_000e18);
        // Don't pre-fund treasury to test proper ERC4626 behavior
        
        // Set up approvals
        asset.approve(address(treasury), type(uint256).max);
        vm.prank(user);
        asset.approve(address(treasury), type(uint256).max);
    }

    function test_Constructor() public {
        assertEq(address(treasury.asset()), address(asset));
        assertEq(address(treasury.factory()), address(factory));
    }

    function test_MintPosition() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100), uint256(200)];
        uint256 amount = 1e18;

        // Fund treasury with assets for transfer
        asset.mint(address(treasury), amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, address(this));

        assertEq(treasury.totalPositions(), amount);
        assertEq(treasury.minExpiry(), expiry);
    }

    function test_BurnPositions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100), uint256(200)];
        uint256 amount = 1e18;

        // Fund treasury with assets for transfer
        asset.mint(address(treasury), amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, address(this));

        PositionBurn[] memory positionsToBurn = new PositionBurn[](1);
        positionsToBurn[0].vault = address(vault);
        positionsToBurn[0].positions = new Position[](1);
        positionsToBurn[0].positions[0].expiry = expiry;
        positionsToBurn[0].positions[0].anchorPrices = anchorPrices;

        treasury.burnPositions(positionsToBurn);

        assertEq(treasury.totalPositions(), 0);
    }

    function test_Deposit() public {
        uint256 amount = 1e18;
        
        uint256 shares = treasury.deposit(amount, address(this));
        assertEq(shares, amount, "shares should equal amount deposited");
        assertEq(treasury.totalAssets(), amount, "totalAssets should equal amount deposited");
        assertEq(treasury.balanceOf(address(this)), shares, "user should have shares");
        assertEq(asset.balanceOf(address(treasury)), amount, "treasury should have assets");
    }

    function test_Deposit_multiple_users() public {
        uint256 amount1 = 1e18;
        uint256 amount2 = 2e18;
        
        uint256 shares1 = treasury.deposit(amount1, address(this));
        
        vm.prank(user);
        uint256 shares2 = treasury.deposit(amount2, user);
        
        assertEq(shares1, amount1, "first user shares should equal amount deposited");
        assertEq(shares2, amount2, "second user shares should equal amount deposited");
        assertEq(treasury.totalAssets(), amount1 + amount2, "totalAssets should be sum of deposits");
        assertEq(treasury.balanceOf(address(this)), shares1, "first user should have correct shares");
        assertEq(treasury.balanceOf(user), shares2, "second user should have correct shares");
    }

    function test_Mint() public {
        uint256 shares = 1e18;
        
        uint256 assets = treasury.mint(shares, address(this));
        assertEq(assets, shares, "assets should equal shares minted");
        assertEq(treasury.balanceOf(address(this)), shares, "user should have shares");
        assertEq(treasury.totalAssets(), shares, "totalAssets should equal shares");
    }

    function test_Withdraw() public {
        uint256 amount = 1e18;
        
        // First deposit
        treasury.deposit(amount, address(this));
        
        uint256 initialBalance = asset.balanceOf(address(this));
        uint256 shares = treasury.withdraw(amount, address(this), address(this));
        
        assertEq(shares, amount, "shares burned should equal amount withdrawn");
        assertEq(treasury.balanceOf(address(this)), 0, "user should have no shares left");
        assertEq(asset.balanceOf(address(this)), initialBalance + amount, "user should receive assets");
        assertEq(treasury.totalAssets(), 0, "treasury should have no assets left");
    }

    function test_Redeem() public {
        uint256 amount = 1e18;
        
        // First deposit
        uint256 shares = treasury.deposit(amount, address(this));
        
        uint256 initialBalance = asset.balanceOf(address(this));
        uint256 assets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(assets, amount, "assets received should equal original deposit");
        assertEq(treasury.balanceOf(address(this)), 0, "user should have no shares left");
        assertEq(asset.balanceOf(address(this)), initialBalance + amount, "user should receive assets");
        assertEq(treasury.totalAssets(), 0, "treasury should have no assets left");
    }

    function test_MintPosition_with_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100), uint256(200)];
        uint256 positionAmount = 1e18;
        uint256 depositAmount = 2e18;
        
        // First deposit some assets
        treasury.deposit(depositAmount, address(this));
        
        // Treasury now has depositAmount assets. For position, it needs positionAmount more
        // The mintPosition function transfers assets from treasury to vault
        // Create position
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, address(this));
        
        assertEq(treasury.totalPositions(), positionAmount, "totalPositions should be updated");
        assertEq(treasury.totalAssets(), depositAmount, "totalAssets should remain same (balance decreases, positions increase)");
        assertEq(asset.balanceOf(address(vault)), positionAmount, "vault should receive position assets");
    }

    function test_BurnPositions_multiple_positions() public {
        uint256 expiry1 = block.timestamp + 1 days;
        uint256 expiry2 = block.timestamp + 2 days;
        uint256[2] memory anchorPrices1 = [uint256(100), uint256(200)];
        uint256[2] memory anchorPrices2 = [uint256(150), uint256(250)];
        uint256 amount1 = 1e18;
        uint256 amount2 = 2e18;
        
        // Fund treasury with enough assets for both positions
        treasury.deposit(amount1 + amount2, address(this));
        
        // Create multiple positions
        vm.prank(address(vault));
        treasury.mintPosition(expiry1, anchorPrices1, amount1, address(this));
        
        vm.prank(address(vault2));
        treasury.mintPosition(expiry2, anchorPrices2, amount2, maker);
        
        // Burn all positions
        PositionBurn[] memory positionsToBurn = new PositionBurn[](2);
        positionsToBurn[0].vault = address(vault);
        positionsToBurn[0].positions = new Position[](1);
        positionsToBurn[0].positions[0].expiry = expiry1;
        positionsToBurn[0].positions[0].anchorPrices = anchorPrices1;
        
        positionsToBurn[1].vault = address(vault2);
        positionsToBurn[1].positions = new Position[](1);
        positionsToBurn[1].positions[0].expiry = expiry2;
        positionsToBurn[1].positions[0].anchorPrices = anchorPrices2;
        
        treasury.burnPositions(positionsToBurn);
        
        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after burn");
    }

    function test_ERC4626_preview_functions() public {
        uint256 amount = 1e18;
        
        // Test preview functions before any deposits
        assertEq(treasury.previewDeposit(amount), amount, "previewDeposit should return same amount");
        assertEq(treasury.previewMint(amount), amount, "previewMint should return same amount");
        assertEq(treasury.previewWithdraw(amount), amount, "previewWithdraw should return same amount");
        assertEq(treasury.previewRedeem(amount), amount, "previewRedeem should return same amount");
        
        // Test after deposit
        treasury.deposit(amount, address(this));
        
        assertEq(treasury.previewDeposit(amount), amount, "previewDeposit should still return same amount");
        assertEq(treasury.previewMint(amount), amount, "previewMint should still return same amount");
        assertEq(treasury.previewWithdraw(amount), amount, "previewWithdraw should still return same amount");
        assertEq(treasury.previewRedeem(amount), amount, "previewRedeem should still return same amount");
    }

    function test_ERC4626_max_functions() public {
        uint256 amount = 1e18;
        
        // Test max functions before any deposits
        assertEq(treasury.maxDeposit(address(this)), type(uint256).max, "maxDeposit should be max uint256");
        assertEq(treasury.maxMint(address(this)), type(uint256).max, "maxMint should be max uint256");
        assertEq(treasury.maxWithdraw(address(this)), 0, "maxWithdraw should be 0 with no deposits");
        assertEq(treasury.maxRedeem(address(this)), 0, "maxRedeem should be 0 with no shares");
        
        // Test after deposit
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(treasury.maxWithdraw(address(this)), amount, "maxWithdraw should equal deposited amount");
        assertEq(treasury.maxRedeem(address(this)), shares, "maxRedeem should equal shares owned");
    }

    function test_deposit_zero_amount() public {
        uint256 shares = treasury.deposit(0, address(this));
        assertEq(shares, 0, "depositing zero should return zero shares");
        assertEq(treasury.totalAssets(), 0, "totalAssets should remain zero");
    }

    function test_mint_zero_shares() public {
        uint256 assets = treasury.mint(0, address(this));
        assertEq(assets, 0, "minting zero shares should cost zero assets");
        assertEq(treasury.balanceOf(address(this)), 0, "user should have zero shares");
    }

    function test_withdraw_revert_insufficient_balance() public {
        uint256 amount = 1e18;
        
        vm.expectRevert();
        treasury.withdraw(amount, address(this), address(this));
    }

    function test_redeem_revert_insufficient_shares() public {
        uint256 shares = 1e18;
        
        vm.expectRevert();
        treasury.redeem(shares, address(this), address(this));
    }

    function test_asset_transfer_on_position_mint() public {
        uint256 amount = 1e18;
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100), uint256(200)];
        
        // First fund treasury with assets so it can transfer to vault
        treasury.deposit(amount, address(this));
        
        uint256 treasuryBalanceBefore = asset.balanceOf(address(treasury));
        uint256 vaultBalanceBefore = asset.balanceOf(address(vault));
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, address(this));
        
        assertEq(asset.balanceOf(address(treasury)), treasuryBalanceBefore - amount, "treasury should lose assets");
        assertEq(asset.balanceOf(address(vault)), vaultBalanceBefore + amount, "vault should gain assets");
    }
}
