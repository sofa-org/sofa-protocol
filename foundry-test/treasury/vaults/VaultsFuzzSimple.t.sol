// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "forge-std/Test.sol";
import "contracts/treasury/vaults/SimpleSmartTrendVault.sol";
import "contracts/mocks/MockERC20Mintable.sol";
import "contracts/interfaces/ISmartTrendStrategy.sol";
import "contracts/interfaces/ISpotOracle.sol";
import "contracts/interfaces/ITreasury.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract MockSmartTrendStrategy is ISmartTrendStrategy {
    function getMakerPayoff(uint256[2] calldata, uint256, uint256 amount) external pure returns (uint256) {
        return amount / 2;
    }

    function getMinterPayoff(uint256[2] calldata, uint256, uint256 amount) external pure returns (uint256) {
        return amount / 2;
    }
}

contract MockSpotOracle is ISpotOracle {
    mapping(uint256 => uint256) public _settlePrices;

    function settlePrices(uint256 expiry) public view returns (uint256) {
        return _settlePrices[expiry];
    }

    function settle() external {}

    function setSettlePrice(uint256 expiry, uint256 price) external {
        _settlePrices[expiry] = price;
    }
}

contract MockTreasury is ITreasury, ERC1155Holder {
    function mintPosition(uint256, uint256[2] calldata, uint256, address) external {}
}

contract VaultsFuzzSimpleTest is Test, ERC1155Holder {
    SimpleSmartTrendVault public vault;
    MockERC20Mintable public collateral;
    MockSmartTrendStrategy public strategy;
    MockSpotOracle public oracle;
    MockTreasury public treasury;
    
    uint256 constant MINTER_TYPE = 0;
    uint256 constant MAKER_TYPE = 1;
    uint256 makerKey = 123;

    function setUp() public {
        collateral = new MockERC20Mintable("Mock Collateral", "mCOL", 18);
        strategy = new MockSmartTrendStrategy();
        oracle = new MockSpotOracle();
        treasury = new MockTreasury();

        vault = new SimpleSmartTrendVault();
        vault.initialize(
            "Simple Vault",
            "sVLT",
            strategy,
            address(collateral),
            oracle,
            treasury
        );

        collateral.mint(address(this), type(uint128).max);
    }

    function _mintTestPosition(uint256 expiry, uint256[2] memory anchorPrices) internal {
        uint256 totalCollateral = 1e18;
        uint256 makerCollateral = 5e17;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(this),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: abi.encodePacked(r, s, v)
        });

        collateral.approve(address(vault), totalCollateral - makerCollateral);
        vault.mint(totalCollateral, params, address(0));
    }

    function testFuzz_mint_amounts(uint256 totalCollateral, uint256 makerCollateral) public {
        totalCollateral = bound(totalCollateral, 1e6, type(uint32).max);
        makerCollateral = bound(makerCollateral, 0, totalCollateral);
        
        // Generate valid expiry time (8:00 UTC)
        uint256 dayOffset = bound(block.timestamp + 1 days, 1, 365);
        uint256 expiry = ((block.timestamp / 86400) + dayOffset) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 deadline = block.timestamp + 1 hours;
        uint256 minterCollateral = totalCollateral - makerCollateral;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(this),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: abi.encodePacked(r, s, v)
        });

        if (minterCollateral > 0) {
            collateral.approve(address(vault), minterCollateral);
        }
        
        vault.mint(totalCollateral, params, address(0));

        uint256 productId = vault.getProductId(expiry, anchorPrices, MINTER_TYPE);
        if (totalCollateral > 0) {
            assertGt(vault.balanceOf(address(this), productId), 0, "should mint tokens for positive collateral");
        }
    }

    function testFuzz_price_ranges(uint256 price1, uint256 price2) public {
        price1 = bound(price1, 1e6, type(uint32).max);
        price2 = bound(price2, price1 + 1, type(uint64).max);
        
        // Generate valid expiry time (8:00 UTC)
        uint256 dayOffset = bound(block.timestamp + 1 days, 1, 365);
        uint256 expiry = ((block.timestamp / 86400) + dayOffset) * 86400 + 28800;
        uint256[2] memory anchorPrices = [price1, price2];
        uint256 totalCollateral = 1e18;
        uint256 makerCollateral = 5e17;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(this),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: abi.encodePacked(r, s, v)
        });

        collateral.approve(address(vault), totalCollateral - makerCollateral);
        vault.mint(totalCollateral, params, address(0));

        uint256 productId = vault.getProductId(expiry, anchorPrices, MINTER_TYPE);
        assertGt(vault.balanceOf(address(this), productId), 0, "should mint with any valid price range");
    }

    function testFuzz_settle_prices(uint256 settlePrice) public {
        settlePrice = bound(settlePrice, 1e6, type(uint64).max);
        
        // Generate valid expiry time (8:00 UTC)
        uint256 expiry = ((block.timestamp / 86400) + bound(block.timestamp + 1 days, 1, 365)) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        _mintTestPosition(expiry, anchorPrices);

        uint256 productId = vault.getProductId(expiry, anchorPrices, MINTER_TYPE);

        vm.warp(expiry + 1);
        oracle.setSettlePrice(expiry, settlePrice);
        
        vault.burn(expiry, anchorPrices, MINTER_TYPE);
        
        uint256 balanceAfter = vault.balanceOf(address(this), productId);
        assertEq(balanceAfter, 0, "tokens should be burned regardless of settle price");
    }

    function testFuzz_product_id_consistency(uint256 expiry, uint256 price1, uint256 price2) public {
        expiry = bound(expiry, block.timestamp + 1 hours, type(uint32).max);
        price1 = bound(price1, 1e6, type(uint32).max);
        price2 = bound(price2, price1 + 1, type(uint64).max);
        
        uint256[2] memory anchorPrices = [price1, price2];
        
        uint256 productId1 = vault.getProductId(expiry, anchorPrices, MINTER_TYPE);
        uint256 productId2 = vault.getProductId(expiry, anchorPrices, MINTER_TYPE);
        uint256 productId3 = vault.getProductId(expiry, anchorPrices, MAKER_TYPE);
        
        assertEq(productId1, productId2, "same parameters should generate same ID");
        assertNotEq(productId1, productId3, "different types should generate different IDs");
    }

    function testFuzz_deadline_validation(uint256 timeSkip) public {
        timeSkip = bound(timeSkip, 1, 365 days);
        
        // Generate valid expiry time (8:00 UTC)
        uint256 dayOffset = bound(block.timestamp + 1 days, 1, 365);
        uint256 expiry = ((block.timestamp / 86400) + dayOffset) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 totalCollateral = 1e18;
        uint256 makerCollateral = 5e17;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(this),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: abi.encodePacked(r, s, v)
        });

        vm.warp(deadline + timeSkip);

        collateral.approve(address(vault), totalCollateral - makerCollateral);
        
        vm.expectRevert();
        vault.mint(totalCollateral, params, address(0));
    }

    function testFuzz_signature_validation(uint256 wrongKey) public {
        // Bound to valid secp256k1 range
        wrongKey = bound(wrongKey, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(wrongKey != makerKey);
        
        // Generate valid expiry time (8:00 UTC)
        uint256 dayOffset = bound(block.timestamp + 1 days, 1, 365);
        uint256 expiry = ((block.timestamp / 86400) + dayOffset) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 totalCollateral = 1e18;
        uint256 makerCollateral = 5e17;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(this),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: abi.encodePacked(r, s, v)
        });

        collateral.approve(address(vault), totalCollateral - makerCollateral);
        
        vm.expectRevert();
        vault.mint(totalCollateral, params, address(0));
    }

    function testFuzz_burn_before_expiry(uint256 timeBefore) public {
        timeBefore = bound(timeBefore, 1, 23 hours);
        
        // Generate valid expiry time (8:00 UTC)
        uint256 dayOffset = bound(block.timestamp + 1 days, 1, 365);
        uint256 expiry = ((block.timestamp / 86400) + dayOffset) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 totalCollateral = 1e18;
        uint256 makerCollateral = 5e17;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(this),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: abi.encodePacked(r, s, v)
        });

        collateral.approve(address(vault), totalCollateral - makerCollateral);
        vault.mint(totalCollateral, params, address(0));

        vm.warp(expiry - timeBefore);
        
        vm.expectRevert();
        vault.burn(expiry, anchorPrices, MINTER_TYPE);
    }
}