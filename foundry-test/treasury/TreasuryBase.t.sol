// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/TreasuryBase.sol";
import "contracts/mocks/MockERC20Mintable.sol";

interface IMockVault {
    function setTreasury(address) external;
    function burn(uint256, uint256[2] calldata, uint256) external;
}

contract MockVault is IMockVault {
    address public treasury;

    function burn(uint256, uint256[2] calldata, uint256) external {
        // mock burn
    }

    function setTreasury(address treasury_) external {
        treasury = treasury_;
    }
}

contract MockAutomatorFactory {
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

contract MockTreasuryBase is TreasuryBase {
    constructor(
        IERC20 asset,
        MockAutomatorFactory factory_
    ) TreasuryBase(asset, IAutomatorFactory(address(factory_))) {}
}

contract TreasuryBaseTest is Test {
    MockTreasuryBase public treasury;
    MockERC20Mintable public asset;
    MockAutomatorFactory public factory;
    MockVault public vault;
    MockVault public vault2;
    address internal maker = makeAddr("maker");
    address internal maker2 = makeAddr("maker2");
    address internal nonMaker = makeAddr("nonMaker");

    function setUp() public {
        asset = new MockERC20Mintable("Mock Asset", "mAsset", 18);
        factory = new MockAutomatorFactory();
        treasury = new MockTreasuryBase(asset, factory);
        vault = new MockVault();
        vault2 = new MockVault();

        factory.setVault(address(vault), true);
        factory.setVault(address(vault2), true);
        factory.setMaker(maker, true);
        factory.setMaker(maker2, true);
        asset.mint(address(this), 1_000_000e18);
        // Don't pre-fund treasury to test proper ERC4626 behavior
        asset.approve(address(treasury), type(uint256).max);
    }

    function _fundTreasuryForPositions(uint256 amount) internal {
        treasury.deposit(amount, address(this));
    }

    function test_mintPosition() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        // Fund treasury with assets for position transfer
        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        assertEq(treasury.totalPositions(), amount, "totalPositions should be updated");
        assertEq(treasury.minExpiry(), expiry, "minExpiry should be updated");
    }

    function test_mintPosition_revert_not_vault() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        vm.expectRevert("Treasury: caller is not a vault");
        treasury.mintPosition(expiry, anchorPrices, amount, maker);
    }

    function test_mintPosition_revert_not_maker() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;
        address notMaker = makeAddr("notMaker");

        vm.prank(address(vault));
        vm.expectRevert("Treasury: signer is not a maker");
        treasury.mintPosition(expiry, anchorPrices, amount, notMaker);
    }

    function test_burnPositions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        PositionBurn[] memory positionsToBurn = new PositionBurn[](1);
        positionsToBurn[0].vault = address(vault);
        positionsToBurn[0].positions = new Position[](1);
        positionsToBurn[0].positions[0] = Position({
            expiry: expiry,
            anchorPrices: anchorPrices
        });

        treasury.burnPositions(positionsToBurn);

        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after burn");
    }

    function test_deposit_burns_expired_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        vm.warp(expiry + 1); // fast forward time to after expiry

        treasury.deposit(1e18, address(this));

        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after expired positions are burned");
    }

    function test_mintPosition_multiple_positions() public {
        uint256 expiry1 = block.timestamp + 1 days;
        uint256 expiry2 = block.timestamp + 2 days;
        uint256[2] memory anchorPrices1 = [uint256(100e18), uint256(200e18)];
        uint256[2] memory anchorPrices2 = [uint256(150e18), uint256(250e18)];
        uint256 amount1 = 100e18;
        uint256 amount2 = 200e18;

        _fundTreasuryForPositions(amount1 + amount2);

        vm.prank(address(vault));
        treasury.mintPosition(expiry1, anchorPrices1, amount1, maker);

        vm.prank(address(vault2));
        treasury.mintPosition(expiry2, anchorPrices2, amount2, maker2);

        assertEq(treasury.totalPositions(), amount1 + amount2, "totalPositions should be sum of both positions");
        assertEq(treasury.minExpiry(), expiry1, "minExpiry should be the earliest expiry");
    }

    function test_mintPosition_zero_amount() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 0;

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        assertEq(treasury.totalPositions(), 0, "totalPositions should remain zero");
        assertEq(treasury.minExpiry(), expiry, "minExpiry should still be set");
    }

    function test_mintPosition_updates_min_expiry() public {
        uint256 expiry1 = block.timestamp + 2 days;
        uint256 expiry2 = block.timestamp + 1 days; // earlier expiry
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        _fundTreasuryForPositions(amount * 2);

        vm.prank(address(vault));
        treasury.mintPosition(expiry1, anchorPrices, amount, maker);
        assertEq(treasury.minExpiry(), expiry1, "minExpiry should be expiry1");

        vm.prank(address(vault));
        treasury.mintPosition(expiry2, anchorPrices, amount, maker);
        assertEq(treasury.minExpiry(), expiry2, "minExpiry should be updated to earlier expiry2");
    }

    function test_burnPositions_multiple_vaults() public {
        uint256 expiry1 = block.timestamp + 1 days;
        uint256 expiry2 = block.timestamp + 2 days;
        uint256[2] memory anchorPrices1 = [uint256(100e18), uint256(200e18)];
        uint256[2] memory anchorPrices2 = [uint256(150e18), uint256(250e18)];
        uint256 amount1 = 100e18;
        uint256 amount2 = 200e18;

        _fundTreasuryForPositions(amount1 + amount2);

        vm.prank(address(vault));
        treasury.mintPosition(expiry1, anchorPrices1, amount1, maker);

        vm.prank(address(vault2));
        treasury.mintPosition(expiry2, anchorPrices2, amount2, maker2);

        PositionBurn[] memory positionsToBurn = new PositionBurn[](2);
        positionsToBurn[0].vault = address(vault);
        positionsToBurn[0].positions = new Position[](1);
        positionsToBurn[0].positions[0] = Position({expiry: expiry1, anchorPrices: anchorPrices1});
        
        positionsToBurn[1].vault = address(vault2);
        positionsToBurn[1].positions = new Position[](1);
        positionsToBurn[1].positions[0] = Position({expiry: expiry2, anchorPrices: anchorPrices2});

        treasury.burnPositions(positionsToBurn);

        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after burning all positions");
    }

    function test_burnPositions_empty_array() public {
        PositionBurn[] memory positionsToBurn = new PositionBurn[](0);
        treasury.burnPositions(positionsToBurn);
        assertEq(treasury.totalPositions(), 0, "totalPositions should remain zero");
    }

    function test_mint_burns_expired_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        vm.warp(expiry + 1); // fast forward time to after expiry

        treasury.mint(1e18, address(this));

        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after expired positions are burned");
    }

    function test_redeem_burns_expired_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;
        uint256 depositAmount = 1e18;

        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        // First deposit to get shares
        uint256 shares = treasury.deposit(depositAmount, address(this));
        
        vm.warp(expiry + 1); // fast forward time to after expiry

        treasury.redeem(shares, address(this), address(this));

        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after expired positions are burned");
    }

    function test_withdraw_burns_expired_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;
        uint256 depositAmount = 1e18;

        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        // First deposit to get shares
        treasury.deposit(depositAmount, address(this));
        
        vm.warp(expiry + 1); // fast forward time to after expiry

        treasury.withdraw(depositAmount, address(this), address(this));

        assertEq(treasury.totalPositions(), 0, "totalPositions should be zero after expired positions are burned");
    }

    function test_deposit_doesnt_burn_non_expired_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 100e18;

        _fundTreasuryForPositions(amount);

        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);

        // Don't fast forward past expiry
        treasury.deposit(1e18, address(this));

        assertEq(treasury.totalPositions(), amount, "totalPositions should remain unchanged for non-expired positions");
    }

    function test_erc4626_functions() public {
        uint256 depositAmount = 1e18;
        
        // Test maxDeposit
        assertEq(treasury.maxDeposit(address(this)), type(uint256).max, "maxDeposit should be max uint256");
        
        // Test maxMint
        assertEq(treasury.maxMint(address(this)), type(uint256).max, "maxMint should be max uint256");
        
        // Test previewDeposit
        assertEq(treasury.previewDeposit(depositAmount), depositAmount, "previewDeposit should return same amount");
        
        // Test previewMint
        assertEq(treasury.previewMint(depositAmount), depositAmount, "previewMint should return same amount");
        
        // Deposit some assets
        uint256 shares = treasury.deposit(depositAmount, address(this));
        
        // Test maxWithdraw
        assertEq(treasury.maxWithdraw(address(this)), depositAmount, "maxWithdraw should equal deposited amount");
        
        // Test maxRedeem
        assertEq(treasury.maxRedeem(address(this)), shares, "maxRedeem should equal shares owned");
        
        // Test previewWithdraw
        assertEq(treasury.previewWithdraw(depositAmount), depositAmount, "previewWithdraw should return same amount");
        
        // Test previewRedeem
        assertEq(treasury.previewRedeem(shares), shares, "previewRedeem should return same amount");
    }

    function test_totalAssets_includes_positions() public {
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 positionAmount = 100e18;
        uint256 depositAmount = 50e18;

        // Deposit some assets
        treasury.deposit(depositAmount, address(this));
        uint256 totalAssetsAfterDeposit = treasury.totalAssets();
        
        // Fund more for position (total needed = depositAmount + positionAmount)
        treasury.deposit(positionAmount, address(this));
        
        // Create a position
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        // totalAssets should include both deposited assets and position amounts
        // After position creation: balance decreases by positionAmount, totalPositions increases by positionAmount
        assertEq(treasury.totalAssets(), totalAssetsAfterDeposit + positionAmount, "totalAssets should include position amounts");
    }

    function test_constructor_sets_correct_values() public {
        assertEq(address(treasury.asset()), address(asset), "asset should be set correctly");
        assertEq(address(treasury.factory()), address(factory), "factory should be set correctly");
        assertEq(treasury.totalPositions(), 0, "totalPositions should start at zero");
        assertEq(treasury.minExpiry(), 0, "minExpiry should start at zero");
    }
}
