// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "../../interfaces/ISmartTrendStrategy.sol";
import "../../interfaces/ISpotOracle.sol";
import "../../interfaces/ITreasury.sol";
import "../../utils/SignatureBitMap.sol";

contract RebaseSmartTrendVault is Initializable, ContextUpgradeable, ERC1155Upgradeable, ReentrancyGuardUpgradeable, SignatureBitMap {
    using SafeERC20 for IERC20Metadata;
    using SignatureCheckerUpgradeable for address;

    struct Product {
        uint256 expiry;
        uint256[2] anchorPrices;
        uint256 isMaker;
    }
    struct MintParams {
        uint256 expiry;
        uint256[2] anchorPrices;
        uint256 makerCollateral;
        uint256 deadline;
        address maker;
        bytes makerSignature;
    }

    bytes32 public DOMAIN_SEPARATOR;
    // bytes32 public constant EIP712DOMAIN_TYPEHASH = keccak256(
    //     "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    // );
    bytes32 public constant EIP712DOMAIN_TYPEHASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    // bytes32 public constant MINT_TYPEHASH = keccak256(
    //     "Mint(address minter,uint256 totalCollateral,uint256 expiry,uint256[2] anchorPrices,uint256 makerCollateral,uint256 deadline,address vault)"
    // );
    bytes32 public constant MINT_TYPEHASH = 0xe8015bbde99f68dcef36fec6eec1f414ef04b9f79422109663be9c2c47e3dc30;
    // Aave Share Multiplier
    uint256 private constant SHARE_MULTIPLIER = 1e18;

    string public name;
    string public symbol;

    ISmartTrendStrategy public strategy;
    IERC20Metadata public collateral;
    ISpotOracle public oracle;
    ITreasury public treasury;

    uint256 public totalSupply;

    // Events
    event Minted(address minter, address maker, address referral, uint256 totalCollateral, uint256 expiry, uint256[2] anchorPrices, uint256 makerCollateral);
    event Burned(address operator, uint256 productId, uint256 amount, uint256 payoff);
    event BatchBurned(address operator, uint256[] productIds, uint256[] amounts, uint256[] payoffs);

    receive() external payable {}

    function initialize(
        string memory name_,
        string memory symbol_,
        ISmartTrendStrategy strategy_,
        address collateral_,
        ISpotOracle oracle_,
        ITreasury treasury_
    ) initializer external {
        name = name_;
        symbol = symbol_;

        strategy = strategy_;

        collateral = IERC20Metadata(collateral_);
        oracle = oracle_;
        treasury = treasury_;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256("Vault"),
                keccak256("1.0"),
                block.chainid,
                address(this)
            )
        );

        __Context_init();
        __ERC1155_init("");
        __ReentrancyGuard_init();
    }

    function mint(
        uint256 totalCollateral,
        MintParams calldata params,
        address referral
    ) external {
        // transfer collateral
        uint256 depositAmount = totalCollateral - params.makerCollateral;
        collateral.safeTransferFrom(_msgSender(), address(this), depositAmount);
        _mint(totalCollateral, params, referral);
    }

    function _mint(uint256 totalCollateral, MintParams memory params, address referral) internal nonReentrant {
        require(block.timestamp < params.deadline, "Vault: deadline");
        require(block.timestamp < params.expiry, "Vault: expired");
        // require expiry must be 8:00 UTC
        require(params.expiry % 86400 == 28800, "Vault: invalid expiry");
        require(params.anchorPrices[0] < params.anchorPrices[1], "Vault: invalid strike prices");
        require(!isSignatureConsumed(params.makerSignature), "Vault: signature consumed");
        require(referral != _msgSender(), "Vault: invalid referral");

        {
        // verify maker's signature
        bytes32 digest =
            keccak256(abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(MINT_TYPEHASH,
                                     _msgSender(),
                                     totalCollateral,
                                     params.expiry,
                                     keccak256(abi.encodePacked(params.anchorPrices)),
                                     params.makerCollateral,
                                     params.deadline,
                                     address(this)))
        ));
        require(params.maker.isValidSignatureNow(digest, params.makerSignature), "Vault: invalid maker signature");
        consumeSignature(params.makerSignature);

        // transfer makerCollateral
        treasury.mintPosition(params.expiry, params.anchorPrices, params.makerCollateral, params.maker);
        }

        // calculate atoken shares
        {
        uint256 rebaseTokenShare;
        uint256 rebaseTokenBalance = collateral.balanceOf(address(this));
        if (totalSupply > 0) {
            rebaseTokenShare = totalCollateral * totalSupply / (rebaseTokenBalance - totalCollateral);
        } else {
            rebaseTokenShare = totalCollateral * SHARE_MULTIPLIER;
        }
        totalSupply += rebaseTokenShare;

        // mint product
        uint256 productId = getProductId(params.expiry, params.anchorPrices, uint256(0));
        uint256 makerProductId = getProductId(params.expiry, params.anchorPrices, uint256(1));

        _mint(_msgSender(), productId, rebaseTokenShare, "");
        _mint(params.maker, makerProductId, rebaseTokenShare, "");
        }

        emit Minted(_msgSender(), params.maker, referral, totalCollateral, params.expiry, params.anchorPrices, params.makerCollateral);
    }

    function burn(uint256 expiry, uint256[2] calldata anchorPrices, uint256 isMaker) external {
        uint256 payoff = _burn(expiry, anchorPrices, isMaker);
        if (payoff > 0) {
            collateral.safeTransfer(_msgSender(), payoff);
        }
    }

    function _burn(uint256 expiry, uint256[2] memory anchorPrices, uint256 isMaker) internal nonReentrant returns (uint256 payoff) {
        require(block.timestamp >= expiry, "Vault: not expired");
        uint256 productId = getProductId(expiry, anchorPrices, isMaker);
        uint256 amount = balanceOf(_msgSender(), productId);
        require(amount > 0, "Vault: zero amount");

        // check if settled
        require(oracle.settlePrices(expiry) > 0, "Vault: not settled");

        // calculate payoff by strategy
        uint256 payoffShare;
        if (isMaker == 1) {
            payoffShare = getMakerPayoff(expiry, anchorPrices, amount);
        } else {
            payoffShare = getMinterPayoff(expiry, anchorPrices, amount);
        }

        // check self balance of collateral and transfer payoff
        if (payoffShare > 0) {
            payoff = payoffShare * collateral.balanceOf(address(this)) / totalSupply;
            totalSupply -= payoffShare;
            emit Burned(_msgSender(), productId, amount, payoff);
        } else {
            emit Burned(_msgSender(), productId, amount, 0);
        }

        // burn product
        _burn(_msgSender(), productId, amount);
    }

    function burnBatch(Product[] calldata products) external {
        uint256 totalPayoff = _burnBatch(products);
        if (totalPayoff > 0) {
            collateral.safeTransfer(_msgSender(), totalPayoff);
        }
    }

    function _burnBatch(Product[] calldata products) internal nonReentrant returns (uint256 totalPayoff) {
        uint256 totalPayoffShare = 0;
        uint256[] memory productIds = new uint256[](products.length);
        uint256[] memory amounts = new uint256[](products.length);
        uint256[] memory payoffs = new uint256[](products.length);
        uint256 rebaseTokenBalance = collateral.balanceOf(address(this));
        for (uint256 i = 0; i < products.length; i++) {
            Product memory product = products[i];
            uint256 productId = getProductId(product.expiry, product.anchorPrices, product.isMaker);
            uint256 amount = balanceOf(_msgSender(), productId);
            require(amount > 0, "Vault: zero amount");
            require(block.timestamp >= product.expiry, "Vault: not expired");
            // check if settled
            require(oracle.settlePrices(product.expiry) > 0, "Vault: not settled");
            // calculate payoff by strategy
            uint256 payoffShare;
            if (product.isMaker == 1) {
                payoffShare = getMakerPayoff(product.expiry, product.anchorPrices, amount);
            } else {
                payoffShare = getMinterPayoff(product.expiry, product.anchorPrices, amount);
            }
            if (payoffShare > 0) {
                totalPayoffShare += payoffShare;
            }

            productIds[i] = productId;
            amounts[i] = amount;
            payoffs[i] = payoffShare * rebaseTokenBalance / totalSupply;
        }
        // check self balance of collateral and transfer payoff
        if (totalPayoffShare > 0) {
            totalPayoff = totalPayoffShare * rebaseTokenBalance / totalSupply;
            totalSupply -= totalPayoffShare;
        }

        // burn product
        _burnBatch(_msgSender(), productIds, amounts);
        emit BatchBurned(_msgSender(), productIds, amounts, payoffs);
    }

    function getMakerPayoff(uint256 expiry, uint256[2] memory anchorPrices, uint256 amount) public view returns (uint256 payoffShare) {
        payoffShare = strategy.getMakerPayoff(anchorPrices, oracle.settlePrices(expiry), amount);
    }

    function getMinterPayoff(uint256 expiry, uint256[2] memory anchorPrices, uint256 amount) public view returns (uint256 payoffShare) {
        payoffShare = strategy.getMinterPayoff(anchorPrices, oracle.settlePrices(expiry), amount);
    }

    // get product id by parameters
    function getProductId(uint256 expiry, uint256[2] memory anchorPrices, uint256 isMaker) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(expiry, anchorPrices, isMaker)));
    }

    // get decimals
    function decimals() external view returns (uint8) {
        return collateral.decimals();
    }

    uint256[50] private __gap;
}
