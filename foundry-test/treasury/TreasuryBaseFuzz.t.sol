// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/TreasuryBase.sol";
import "contracts/mocks/MockERC20Mintable.sol";

contract MockVault {
    function burn(uint256, uint256[2] calldata, uint256) external {}
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

contract TreasuryBaseFuzzTest is Test {
    MockTreasuryBase public treasury;
    MockERC20Mintable public asset;
    MockAutomatorFactory public factory;
    MockVault public vault;
    address internal maker = makeAddr("maker");

    function setUp() public {
        asset = new MockERC20Mintable("Mock Asset", "mAsset", 18);
        factory = new MockAutomatorFactory();
        treasury = new MockTreasuryBase(asset, factory);
        vault = new MockVault();

        factory.setVault(address(vault), true);
        factory.setMaker(maker, true);
        
        // Mint large amount for fuzzing
        asset.mint(address(this), type(uint128).max);
        asset.approve(address(treasury), type(uint256).max);
    }

    function invariant_totalAssets_gte_totalPositions() public {
        assertGe(treasury.totalAssets(), treasury.totalPositions(), "totalAssets must be >= totalPositions");
    }

    function invariant_totalSupply_consistency() public {
        // totalSupply should always be >= any individual balance
        assertGe(treasury.totalSupply(), treasury.balanceOf(address(this)), "totalSupply should be >= individual balance");
    }

    function testFuzz_deposit_redeem_roundtrip(uint256 amount) public {
        // Bound amount to reasonable range
        amount = bound(amount, 1, type(uint128).max);
        
        uint256 initialBalance = asset.balanceOf(address(this));
        uint256 shares = treasury.deposit(amount, address(this));
        
        assertEq(shares, amount, "shares should equal amount for first deposit");
        assertEq(treasury.balanceOf(address(this)), shares, "balance should equal shares");
        assertEq(asset.balanceOf(address(this)), initialBalance - amount, "asset balance should decrease");
        
        // Redeem shares
        uint256 assets = treasury.redeem(shares, address(this), address(this));
        
        assertEq(assets, amount, "redeemed assets should equal original amount");
        assertEq(treasury.balanceOf(address(this)), 0, "shares should be zero after redeem");
        assertEq(asset.balanceOf(address(this)), initialBalance, "asset balance should be restored");
    }

    function testFuzz_mintPosition_amount_bounds(uint256 amount) public {
        amount = bound(amount, 0, type(uint128).max);
        
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        // Fund treasury
        if (amount > 0) {
            treasury.deposit(amount, address(this));
        }
        
        uint256 positionsBefore = treasury.totalPositions();
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);
        
        assertEq(treasury.totalPositions(), positionsBefore + amount, "positions should increase by amount");
        if (amount > 0) {
            assertEq(treasury.minExpiry(), expiry, "minExpiry should be set");
        }
    }

    function testFuzz_mintPosition_expiry_bounds(uint256 expiry) public {
        expiry = bound(expiry, block.timestamp, type(uint64).max);
        
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 amount = 1e18;
        
        treasury.deposit(amount, address(this));
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);
        
        assertEq(treasury.minExpiry(), expiry, "minExpiry should be set to expiry");
    }

    function testFuzz_mintPosition_anchor_prices(uint256 price1, uint256 price2) public {
        price1 = bound(price1, 1e6, type(uint64).max);
        price2 = bound(price2, 1e6, type(uint64).max);
        
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [price1, price2];
        uint256 amount = 1e18;
        
        treasury.deposit(amount, address(this));
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, amount, maker);
        
        assertEq(treasury.totalPositions(), amount, "position should be created with any valid prices");
    }

    function testFuzz_multiple_deposits_shares_calculation(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1e6, type(uint64).max);
        amount2 = bound(amount2, 1e6, type(uint64).max);
        
        uint256 shares1 = treasury.deposit(amount1, address(this));
        uint256 shares2 = treasury.deposit(amount2, address(this));
        
        assertEq(shares1, amount1, "first deposit should be 1:1");
        assertEq(shares2, amount2, "second deposit should be 1:1 with no positions");
        assertEq(treasury.balanceOf(address(this)), shares1 + shares2, "total shares should sum");
    }

    function testFuzz_deposit_with_positions(uint256 depositAmount, uint256 positionAmount) public {
        depositAmount = bound(depositAmount, 1e6, type(uint64).max);
        positionAmount = bound(positionAmount, 1e6, type(uint64).max);
        
        // Initial deposit
        uint256 initialShares = treasury.deposit(depositAmount, address(this));
        
        // Add more for position
        treasury.deposit(positionAmount, address(this));
        
        // Create position
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        // Verify totalAssets includes position
        assertEq(
            treasury.totalAssets(), 
            depositAmount + positionAmount, 
            "totalAssets should include both deposits and positions"
        );
        
        // New deposit should work correctly
        uint256 newDepositAmount = bound(depositAmount / 2, 1e6, type(uint32).max);
        uint256 newShares = treasury.deposit(newDepositAmount, address(this));
        
        assertGt(newShares, 0, "new deposit should receive shares");
    }

    function testFuzz_redeem_partial_amounts(uint256 depositAmount, uint256 redeemRatio) public {
        depositAmount = bound(depositAmount, 1e6, type(uint64).max);
        redeemRatio = bound(redeemRatio, 1, 100);
        
        uint256 shares = treasury.deposit(depositAmount, address(this));
        uint256 redeemShares = (shares * redeemRatio) / 100;
        
        if (redeemShares > 0) {
            uint256 assets = treasury.redeem(redeemShares, address(this), address(this));
            assertGt(assets, 0, "should receive assets");
            assertEq(treasury.balanceOf(address(this)), shares - redeemShares, "remaining shares");
        }
    }

    function testFuzz_preview_functions_consistency(uint256 amount) public {
        amount = bound(amount, 1e6, type(uint64).max);
        
        uint256 previewDepositShares = treasury.previewDeposit(amount);
        uint256 previewMintAssets = treasury.previewMint(amount);
        
        uint256 actualShares = treasury.deposit(amount, address(this));
        
        assertEq(actualShares, previewDepositShares, "previewDeposit should match actual");
        
        uint256 previewRedeemAssets = treasury.previewRedeem(actualShares);
        uint256 previewWithdrawShares = treasury.previewWithdraw(amount);
        
        assertEq(previewRedeemAssets, amount, "previewRedeem should match deposit amount");
    }

    function testFuzz_expired_position_cleanup(uint256 positionAmount, uint256 timeSkip) public {
        positionAmount = bound(positionAmount, 1e6, type(uint64).max);
        timeSkip = bound(timeSkip, 1, 365 days);
        
        uint256 expiry = block.timestamp + 1 days;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        // Fund and create position
        treasury.deposit(positionAmount, address(this));
        
        vm.prank(address(vault));
        treasury.mintPosition(expiry, anchorPrices, positionAmount, maker);
        
        assertEq(treasury.totalPositions(), positionAmount, "position created");
        
        // Skip time past expiry
        vm.warp(expiry + timeSkip);
        
        // Trigger position cleanup via deposit
        treasury.deposit(1e6, address(this));
        
        assertEq(treasury.totalPositions(), 0, "expired positions should be cleaned up");
    }

    function testFuzz_max_functions_bounds(uint256 userShares) public {
        userShares = bound(userShares, 0, type(uint64).max);
        
        if (userShares > 0) {
            treasury.deposit(userShares, address(this));
        }
        
        assertEq(treasury.maxDeposit(address(this)), type(uint256).max, "maxDeposit should be unlimited");
        assertEq(treasury.maxMint(address(this)), type(uint256).max, "maxMint should be unlimited");
        assertEq(treasury.maxWithdraw(address(this)), userShares, "maxWithdraw should equal user assets");
        assertEq(treasury.maxRedeem(address(this)), userShares, "maxRedeem should equal user shares");
    }

    function testFuzz_burnPositions_array_sizes(uint8 numVaults, uint8 numPositions) public {
        numVaults = uint8(bound(numVaults, 1, 10));
        numPositions = uint8(bound(numPositions, 1, 5));
        
        // Create positions first
        uint256 totalAmount = uint256(numVaults) * uint256(numPositions) * 1e18;
        treasury.deposit(totalAmount, address(this));
        
        // Create multiple positions
        for (uint256 i = 0; i < numVaults; i++) {
            for (uint256 j = 0; j < numPositions; j++) {
                uint256 expiry = block.timestamp + 1 days + i * 1 hours + j * 10 minutes;
                uint256[2] memory anchorPrices = [uint256(100e18 + i * 10e18), uint256(200e18 + j * 10e18)];
                
                vm.prank(address(vault));
                treasury.mintPosition(expiry, anchorPrices, 1e18, maker);
            }
        }
        
        // Create burn array
        PositionBurn[] memory positionsToBurn = new PositionBurn[](numVaults);
        for (uint256 i = 0; i < numVaults; i++) {
            positionsToBurn[i].vault = address(vault);
            positionsToBurn[i].positions = new Position[](numPositions);
            
            for (uint256 j = 0; j < numPositions; j++) {
                uint256 expiry = block.timestamp + 1 days + i * 1 hours + j * 10 minutes;
                uint256[2] memory anchorPrices = [uint256(100e18 + i * 10e18), uint256(200e18 + j * 10e18)];
                
                positionsToBurn[i].positions[j] = Position({
                    expiry: expiry,
                    anchorPrices: anchorPrices
                });
            }
        }
        
        treasury.burnPositions(positionsToBurn);
        
        assertEq(treasury.totalPositions(), 0, "all positions should be burned");
    }

    function testFuzz_asset_transfer_amounts(uint256 transferAmount) public {
        transferAmount = bound(transferAmount, 1, type(uint64).max);
        
        uint256 initialTotalAssets = treasury.totalAssets();
        
        // Direct transfer to treasury
        asset.transfer(address(treasury), transferAmount);
        
        // Direct transfers DO affect totalAssets since it's based on ERC20 balance
        assertEq(treasury.totalAssets(), initialTotalAssets + transferAmount, "direct transfers should affect totalAssets");
        
        // Make an initial deposit to establish shares first
        uint256 initialDeposit = 1e18;
        treasury.deposit(initialDeposit, address(this));
        
        // Now test deposit with existing shares and direct transfers
        uint256 depositAmount = bound(transferAmount / 2, 1, type(uint32).max);
        uint256 totalSupplyBefore = treasury.totalSupply();
        uint256 totalAssetsBefore = treasury.totalAssets();
        
        uint256 shares = treasury.deposit(depositAmount, address(this));
        
        // With existing shares, exchange rate should be adjusted for direct transfers
        uint256 expectedShares = (depositAmount * totalSupplyBefore) / totalAssetsBefore;
        assertEq(shares, expectedShares, "shares should reflect exchange rate after direct transfer");
    }
}