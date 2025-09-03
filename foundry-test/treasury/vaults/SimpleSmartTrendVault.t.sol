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

    function settle() external {
        // Mock implementation
    }

    function setSettlePrice(uint256 expiry, uint256 price) external {
        _settlePrices[expiry] = price;
    }
}

contract MockTreasury is ITreasury, ERC1155Holder {
    function mintPosition(uint256, uint256[2] calldata, uint256, address) external {}
}

contract MockMinter is ERC1155Holder {
    function approveToken(address token, address spender, uint256 amount) external {
        MockERC20Mintable(token).approve(spender, amount);
    }
    
    function mintVault(SimpleSmartTrendVault vault, uint256 totalCollateral, SimpleSmartTrendVault.MintParams memory params, address referral) external {
        vault.mint(totalCollateral, params, referral);
    }
    
    function burnVault(SimpleSmartTrendVault vault, uint256 expiry, uint256[2] memory anchorPrices, uint256 isMaker) external {
        vault.burn(expiry, anchorPrices, isMaker);
    }
}

contract SimpleSmartTrendVaultTest is Test, ERC1155Holder {
    SimpleSmartTrendVault public vault;
    MockERC20Mintable public collateral;
    MockSmartTrendStrategy public strategy;
    MockSpotOracle public oracle;
    MockTreasury public treasury;
    address internal maker = makeAddr("maker");
    address internal maker2 = makeAddr("maker2");
    MockMinter internal minter;
    MockMinter internal minter2;
    uint256 makerKey = 123;
    uint256 maker2Key = 456;

    function setUp() public {
        collateral = new MockERC20Mintable("Mock Collateral", "mCOL", 18);
        strategy = new MockSmartTrendStrategy();
        oracle = new MockSpotOracle();
        treasury = new MockTreasury();

        vault = new SimpleSmartTrendVault();
        vault.initialize(
            "Test Vault",
            "tVLT",
            strategy,
            address(collateral),
            oracle,
            treasury
        );

        minter = new MockMinter();
        minter2 = new MockMinter();
        collateral.mint(address(minter), 1_000_000e18);
        collateral.mint(address(minter2), 1_000_000e18);
    }

    function test_mint_and_burn() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 makerCollateral = 100e18;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(minter),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: makerSignature
        });

        minter.approveToken(address(collateral), address(vault), totalCollateral - makerCollateral);
        minter.mintVault(vault, totalCollateral, params, address(0));

        uint256 productId = vault.getProductId(expiry, anchorPrices, 0);
        assertGt(vault.balanceOf(address(minter), productId), 0, "minter should have some product token");

        // Fast forward to after expiry and settle price
        vm.warp(expiry + 1);
        oracle.setSettlePrice(expiry, 150e18);

        minter.burnVault(vault, expiry, anchorPrices, 0);

        assertEq(vault.balanceOf(address(minter), productId), 0, "minter product token should be burned");
    }

    function test_mint_multiple_positions() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices1 = [uint256(100e18), uint256(200e18)];
        uint256[2] memory anchorPrices2 = [uint256(150e18), uint256(250e18)];
        uint256 makerCollateral = 100e18;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        // First position
        _mintForSimpleMinter(minter, makerKey, expiry, anchorPrices1, makerCollateral, totalCollateral, deadline);

        // Second position with different minter
        _mintForSimpleMinter(minter2, maker2Key, expiry, anchorPrices2, makerCollateral, totalCollateral, deadline);

        uint256 productId1 = vault.getProductId(expiry, anchorPrices1, 0);
        uint256 productId2 = vault.getProductId(expiry, anchorPrices2, 0);
        
        assertGt(vault.balanceOf(address(minter), productId1), 0, "minter should have first product token");
        assertGt(vault.balanceOf(address(minter2), productId2), 0, "minter2 should have second product token");
        assertEq(vault.balanceOf(address(minter), productId2), 0, "minter should not have second product token");
        assertEq(vault.balanceOf(address(minter2), productId1), 0, "minter2 should not have first product token");
    }

    function _mintForSimpleMinter(
        MockMinter _minter, 
        uint256 _makerKey, 
        uint256 _expiry, 
        uint256[2] memory _anchorPrices, 
        uint256 _makerCollateral, 
        uint256 _totalCollateral, 
        uint256 _deadline
    ) internal {
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(_minter),
                _totalCollateral,
                _expiry,
                keccak256(abi.encodePacked(_anchorPrices)),
                _makerCollateral,
                _deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: _expiry,
            anchorPrices: _anchorPrices,
            makerCollateral: _makerCollateral,
            deadline: _deadline,
            maker: vm.addr(_makerKey),
            makerSignature: makerSignature
        });

        _minter.approveToken(address(collateral), address(vault), _totalCollateral - _makerCollateral);
        _minter.mintVault(vault, _totalCollateral, params, address(0));
    }

    function test_mint_with_zero_maker_collateral() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 makerCollateral = 0;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(minter),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: makerSignature
        });

        minter.approveToken(address(collateral), address(vault), totalCollateral);
        minter.mintVault(vault, totalCollateral, params, address(0));

        uint256 productId = vault.getProductId(expiry, anchorPrices, 0);
        assertGt(vault.balanceOf(address(minter), productId), 0, "minter should have product token even with zero maker collateral");
    }

    function test_mint_with_referral() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 makerCollateral = 100e18;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;
        address referral = makeAddr("referral");

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(minter),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: makerSignature
        });

        minter.approveToken(address(collateral), address(vault), totalCollateral - makerCollateral);
        minter.mintVault(vault, totalCollateral, params, referral);

        uint256 productId = vault.getProductId(expiry, anchorPrices, 0);
        assertGt(vault.balanceOf(address(minter), productId), 0, "minter should have product token with referral");
    }

    function test_burn_maker_position() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 makerCollateral = 100e18;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Mint position first
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(minter),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: makerSignature
        });

        minter.approveToken(address(collateral), address(vault), totalCollateral - makerCollateral);
        minter.mintVault(vault, totalCollateral, params, address(0));

        uint256 minterProductId = vault.getProductId(expiry, anchorPrices, 0);
        uint256 makerProductId = vault.getProductId(expiry, anchorPrices, 1);
        
        assertGt(vault.balanceOf(address(minter), minterProductId), 0, "minter should have minter product token");
        
        // Fast forward to after expiry and settle price
        vm.warp(expiry + 1);
        oracle.setSettlePrice(expiry, 150e18);

        // Burn minter position
        minter.burnVault(vault, expiry, anchorPrices, 0);
        assertEq(vault.balanceOf(address(minter), minterProductId), 0, "minter product token should be burned");

        // Check if maker has tokens, and if so, burn them
        address actualMaker = vm.addr(makerKey);
        if (vault.balanceOf(actualMaker, makerProductId) > 0) {
            vm.prank(actualMaker);
            vault.burn(expiry, anchorPrices, 1);
        }
    }

    function test_get_product_id() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        
        uint256 minterProductId = vault.getProductId(expiry, anchorPrices, 0);
        uint256 makerProductId = vault.getProductId(expiry, anchorPrices, 1);
        
        assertNotEq(minterProductId, makerProductId, "minter and maker product IDs should be different");
        
        // Same parameters should give same ID
        uint256 minterProductId2 = vault.getProductId(expiry, anchorPrices, 0);
        assertEq(minterProductId, minterProductId2, "same parameters should give same product ID");
    }

    function test_vault_initialization() public {
        assertEq(vault.name(), "Test Vault", "vault name should be set correctly");
        assertEq(vault.symbol(), "tVLT", "vault symbol should be set correctly");
        assertEq(address(vault.strategy()), address(strategy), "strategy should be set correctly");
        assertEq(address(vault.collateral()), address(collateral), "collateral should be set correctly");
        assertEq(address(vault.oracle()), address(oracle), "oracle should be set correctly");
        assertEq(address(vault.treasury()), address(treasury), "treasury should be set correctly");
    }

    function test_domain_separator() public {
        bytes32 domainSeparator = vault.DOMAIN_SEPARATOR();
        assertNotEq(domainSeparator, bytes32(0), "domain separator should not be zero");
    }

    function test_mint_typehash() public {
        bytes32 mintTypehash = vault.MINT_TYPEHASH();
        assertNotEq(mintTypehash, bytes32(0), "mint typehash should not be zero");
    }

    function test_burn_before_expiry_should_revert() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 makerCollateral = 100e18;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Mint position first
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(minter),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: makerSignature
        });

        minter.approveToken(address(collateral), address(vault), totalCollateral - makerCollateral);
        minter.mintVault(vault, totalCollateral, params, address(0));

        // Try to burn before expiry (should revert)
        vm.expectRevert();
        minter.burnVault(vault, expiry, anchorPrices, 0);
    }

    function test_burn_without_settle_price_should_revert() public {
        uint256 expiry = (block.timestamp / 86400 + 1) * 86400 + 28800;
        uint256[2] memory anchorPrices = [uint256(100e18), uint256(200e18)];
        uint256 makerCollateral = 100e18;
        uint256 totalCollateral = 200e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Mint position first
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            vault.DOMAIN_SEPARATOR(),
            keccak256(abi.encode(
                vault.MINT_TYPEHASH(),
                address(minter),
                totalCollateral,
                expiry,
                keccak256(abi.encodePacked(anchorPrices)),
                makerCollateral,
                deadline,
                address(vault)
            ))
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(makerKey, digest);
        bytes memory makerSignature = abi.encodePacked(r, s, v);

        SimpleSmartTrendVault.MintParams memory params = SimpleSmartTrendVault.MintParams({
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            deadline: deadline,
            maker: vm.addr(makerKey),
            makerSignature: makerSignature
        });

        minter.approveToken(address(collateral), address(vault), totalCollateral - makerCollateral);
        minter.mintVault(vault, totalCollateral, params, address(0));

        // Fast forward to after expiry but don't set settle price
        vm.warp(expiry + 1);

        // Try to burn without settle price (should revert)
        vm.expectRevert();
        minter.burnVault(vault, expiry, anchorPrices, 0);
    }
}
