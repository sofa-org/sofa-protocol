// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "../utils/SignatureBitMap.sol";

interface IScrvUSD {
    function balanceOf(address account) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract CrvUSDDualVault is Initializable, ContextUpgradeable, ERC1155Upgradeable, ReentrancyGuardUpgradeable, SignatureBitMap {
    using SafeERC20 for IERC20Metadata;
    using SignatureCheckerUpgradeable for address;

    struct Product {
        uint256 expiry;
        uint256 anchorPrice;
    }
    struct MinterProduct {
        uint256 expiry;
        uint256 anchorPrice;
        uint256 premiumPercentage;
    }
    struct MintParams {
        uint256 expiry;
        uint256 anchorPrice;
        uint256 makerCollateral;
        uint256 deadline;
        address maker;
        bytes makerSignature;
    }

    bytes32 public DOMAIN_SEPARATOR;
    uint256 public constant PRICE_DECIMALS = 1e8;
    // bytes32 public constant EIP712DOMAIN_TYPEHASH = keccak256(
    //     "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    // );
    bytes32 public constant EIP712DOMAIN_TYPEHASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    // bytes32 public constant MINT_TYPEHASH = keccak256(
    //     "Mint(address minter,uint256 totalCollateral,uint256 expiry,uint256 anchorPrice,uint256 makerCollateral,uint256 deadline,address vault)"
    // );
    bytes32 public constant MINT_TYPEHASH = 0xadc8ab1b9b31223fe0b8ae794dc96fe3ad50967c62e34e24108ef68cfa512ec2;

    string public name;
    string public symbol;

    IScrvUSD public scrvUSD;
    IERC20Metadata public collateral;
    IERC20Metadata public quoteAsset;
    uint256 public totalDeposit;

    address public feeCollector;
    mapping(uint256 => uint256) public quotePositions;
    mapping(uint256 => uint256) public totalPositions;

    // Events
    event Minted(address minter, address maker, address referral, uint256 totalCollateral, uint256 expiry, uint256 anchorPrice, uint256 makerCollateral, uint256 premiumPercentage);
    event Quoted(address operator, uint256 productId, uint256 amount, uint256 quoteAmount);
    event Burned(address operator, uint256 productId, uint256 amount, uint256 collateralPayoff, uint256 quoteAssetPayoff);
    event BatchBurned(address operator, uint256[] productIds, uint256[] amounts, uint256[] collateralPayoffs, uint256[] quoteAssetPayoffs);
    event FeeCollected(address feeCollector, uint256 fee);

    function initialize(
        string memory name_,
        string memory symbol_,
        address collateral_,
        address quoteAsset_,
        address feeCollector_,
        address scrvUSD_
    ) initializer external {
        name = name_;
        symbol = symbol_;

        collateral = IERC20Metadata(collateral_);
        quoteAsset = IERC20Metadata(quoteAsset_);

        scrvUSD = IScrvUSD(scrvUSD_);
        collateral.safeApprove(address(scrvUSD), type(uint256).max);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712DOMAIN_TYPEHASH,
                keccak256("Vault"),
                keccak256("1.0"),
                block.chainid,
                address(this)
            )
        );
        feeCollector = feeCollector_;

        __Context_init();
        __ERC1155_init("");
        __ReentrancyGuard_init();
    }

    function mint(
        uint256 totalCollateral,
        MintParams calldata params,
        address referral
    ) external nonReentrant {
        // transfer collateral
        uint256 depositAmount = totalCollateral - params.makerCollateral;
        collateral.safeTransferFrom(_msgSender(), address(this), depositAmount);
        _mint(totalCollateral, params, referral);
    }

    function _mint(uint256 totalCollateral, MintParams memory params, address referral) internal {
        require(block.timestamp < params.deadline, "Vault: deadline");
        require(block.timestamp < params.expiry, "Vault: expired");
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
                                     params.anchorPrice,
                                     params.makerCollateral,
                                     params.deadline,
                                     address(this)))
        ));
        require(params.maker.isValidSignatureNow(digest, params.makerSignature), "Vault: invalid maker signature");
        consumeSignature(params.makerSignature);

        // transfer makerCollateral
        collateral.safeTransferFrom(params.maker, address(this), params.makerCollateral);
        }
        // mint product
        uint256 productId = getProductId(params.expiry, params.anchorPrice, 0);
        uint256 premiumPercentage = params.makerCollateral * 1e18 / totalCollateral;
        uint256 minterProductId = getMinterProductId(params.expiry, params.anchorPrice, premiumPercentage);
        uint256 makerProductId = getProductId(params.expiry, params.anchorPrice, 1);
        _mint(_msgSender(), minterProductId, totalCollateral, "");
        _mint(params.maker, makerProductId, totalCollateral, "");
        totalPositions[productId] += totalCollateral;

        scrvUSD.deposit(totalCollateral, address(this));
        totalDeposit += totalCollateral;
        emit Minted(_msgSender(), params.maker, referral, totalCollateral, params.expiry, params.anchorPrice, params.makerCollateral, premiumPercentage);
    }

    function mintBatch(
        uint256[] calldata totalCollaterals,
        MintParams[] calldata paramsArray,
        address referral
    ) external nonReentrant {
        require(totalCollaterals.length == paramsArray.length, "Vault: invalid params length");
        // transfer collateral
        uint256 depositAmount;
        for (uint256 i = 0; i < paramsArray.length; i++) {
            depositAmount += totalCollaterals[i] - paramsArray[i].makerCollateral;
        }
        collateral.safeTransferFrom(_msgSender(), address(this), depositAmount);
        _mintBatch(totalCollaterals, paramsArray, referral);
    }

    function _mintBatch(uint256[] calldata totalCollaterals, MintParams[] calldata paramsArray, address referral) internal {
        require(referral != _msgSender(), "Vault: invalid referral");
        uint256 totalCollateral;
        uint256[] memory minterProductIds = new uint256[](paramsArray.length);
        for (uint256 i = 0; i < paramsArray.length; i++) {
            MintParams memory params = paramsArray[i];
            require(block.timestamp < params.deadline, "Vault: deadline");
            require(block.timestamp < params.expiry, "Vault: expired");
            require(!isSignatureConsumed(params.makerSignature), "Vault: signature consumed");

            {
            // verify maker's signature
            bytes32 digest =
                keccak256(abi.encodePacked(
                                           "\x19\x01",
                                           DOMAIN_SEPARATOR,
                                           keccak256(abi.encode(MINT_TYPEHASH,
                                                                _msgSender(),
                                                                totalCollaterals[i],
                                                                params.expiry,
                                                                params.anchorPrice,
                                                                params.makerCollateral,
                                                                params.deadline,
                                                                address(this)))
                          ));
            require(params.maker.isValidSignatureNow(digest, params.makerSignature), "Vault: invalid maker signature");
            consumeSignature(params.makerSignature);

            // transfer makercollateral
            collateral.safeTransferFrom(params.maker, address(this), params.makerCollateral);
            }

            // mint product
            uint256 productId = getProductId(params.expiry, params.anchorPrice, 0);
            uint256 premiumPercentage = params.makerCollateral * 1e18 / totalCollaterals[i];
            minterProductIds[i] = getMinterProductId(params.expiry, params.anchorPrice, premiumPercentage);
            uint256 makerProductId = getProductId(params.expiry, params.anchorPrice, 1);
            _mint(params.maker, makerProductId, totalCollaterals[i], "");
            totalPositions[productId] += totalCollaterals[i];

            totalCollateral += totalCollaterals[i];
            emit Minted(_msgSender(), params.maker, referral, totalCollaterals[i], params.expiry, params.anchorPrice, params.makerCollateral, premiumPercentage);
        }
        scrvUSD.deposit(totalCollateral, address(this));
        totalDeposit += totalCollateral;
        _mintBatch(_msgSender(), minterProductIds, totalCollaterals, "");
    }

    function quote(uint256 amount, Product calldata product) external nonReentrant {
        require(block.timestamp < product.expiry + 2 hours, "Vault: expired");
        uint256 productId = getProductId(product.expiry, product.anchorPrice, 1);
        require(balanceOf(_msgSender(), productId) >= amount, "Vault: insufficient balance");
        uint256 quoteAmount = amount * product.anchorPrice * quoteAsset.decimals() / collateral.decimals() / PRICE_DECIMALS;
        quoteAsset.safeTransferFrom(_msgSender(), address(this), quoteAmount);

        scrvUSD.withdraw(amount, _msgSender(), address(this));
        totalDeposit -= amount;
        _burn(_msgSender(), productId, amount);
        quotePositions[productId] += amount;

        emit Quoted(_msgSender(), productId, amount, quoteAmount);
    }

    function quoteBatch(uint256[] calldata amounts, Product[] calldata products) external nonReentrant {
        require(amounts.length == products.length, "Vault: invalid length");
        uint256 totalQuoteAmount;
        uint256 totalCollateralAmount;
        uint256[] memory productIds = new uint256[](products.length);
        for (uint256 i = 0; i < products.length; i++) {
            Product calldata product = products[i];
            require(block.timestamp < product.expiry + 2 hours, "Vault: expired");
            uint256 productId = getProductId(product.expiry, product.anchorPrice, 1);
            require(balanceOf(_msgSender(), productId) >= amounts[i], "Vault: insufficient balance");
            totalCollateralAmount += amounts[i];
            uint256 quoteAmount = amounts[i] * product.anchorPrice * quoteAsset.decimals() / collateral.decimals() / PRICE_DECIMALS;
            totalQuoteAmount += quoteAmount;
            quotePositions[productId] += amounts[i];
            productIds[i] = productId;

            emit Quoted(_msgSender(), productId, amounts[i], quoteAmount);
        }
        _burnBatch(_msgSender(), productIds, amounts);
        quoteAsset.safeTransferFrom(_msgSender(), address(this), totalQuoteAmount);
        scrvUSD.withdraw(totalCollateralAmount, _msgSender(), address(this));
        totalDeposit -= totalCollateralAmount;
    }

    function burn(uint256 expiry, uint256 anchorPrice, uint256 premiumPercentage) external {
        (uint256 collateralPayoff, uint256 quoteAssetPayoff) = _burn(expiry, anchorPrice, premiumPercentage);
        if (collateralPayoff > 0) {
            scrvUSD.withdraw(collateralPayoff, _msgSender(), address(this));
            totalDeposit -= collateralPayoff;
        }
        if (quoteAssetPayoff > 0) {
            quoteAsset.safeTransfer(_msgSender(), quoteAssetPayoff);
        }
    }

    function _burn(uint256 expiry, uint256 anchorPrice, uint256 premiumPercentage) internal nonReentrant returns (uint256 collateralPayoff, uint256 quoteAssetPayoff) {
        require(block.timestamp >= expiry + 2 hours, "Vault: not expired");
        uint256 productId = getProductId(expiry, anchorPrice, 0);
        uint256 minterProductId = getMinterProductId(expiry, anchorPrice, premiumPercentage);
        uint256 amount = balanceOf(_msgSender(), minterProductId);
        require(amount > 0, "Vault: zero amount");

        uint256 totalPosition = totalPositions[productId];
        uint256 makerPosition = quotePositions[getProductId(expiry, anchorPrice, 1)];
        collateralPayoff = amount - amount * makerPosition / totalPosition;
        quoteAssetPayoff = (amount - collateralPayoff) * anchorPrice * quoteAsset.decimals() / collateral.decimals() / PRICE_DECIMALS;

        // burn product
        _burn(_msgSender(), minterProductId, amount);

        emit Burned(_msgSender(), minterProductId, amount, collateralPayoff, quoteAssetPayoff);
    }

    function burnBatch(MinterProduct[] calldata products) external {
        (uint256 totalCollateralPayoff, uint256 totalQuoteAssetPayoff) = _burnBatch(products);

        // check self balance of collateral and transfer payoff
        if (totalCollateralPayoff > 0) {
            scrvUSD.withdraw(totalCollateralPayoff, _msgSender(), address(this));
            totalDeposit -= totalCollateralPayoff;
        }
        if (totalQuoteAssetPayoff > 0) {
            quoteAsset.safeTransfer(_msgSender(), totalQuoteAssetPayoff);
        }
    }

    function _burnBatch(MinterProduct[] calldata products) internal nonReentrant returns (uint256 totalCollateralPayoff, uint256 totalQuoteAssetPayoff) {
        uint256[] memory minterProductIds = new uint256[](products.length);
        uint256[] memory amounts = new uint256[](products.length);
        for (uint256 i = 0; i < products.length; i++) {
            (uint256 minterProductId, uint256 amount, uint256 collateralPayoff, uint256 quoteAssetPayoff) = _processProduct(products[i]);
            minterProductIds[i] = minterProductId;
            amounts[i] = amount;
            totalCollateralPayoff += collateralPayoff;
            totalQuoteAssetPayoff += quoteAssetPayoff;
            emit Burned(_msgSender(), minterProductId, amount, collateralPayoff, quoteAssetPayoff);
        }
        // burn product
        _burnBatch(_msgSender(), minterProductIds, amounts);
    }

    function _processProduct(MinterProduct memory product) internal view returns (uint256 minterProductId, uint256 amount, uint256 collateralPayoff, uint256 quoteAssetPayoff) {
        minterProductId = getMinterProductId(product.expiry, product.anchorPrice, product.premiumPercentage);
        amount = balanceOf(_msgSender(), minterProductId);
        require(amount > 0, "Vault: zero amount");
        require(block.timestamp >= product.expiry + 2 hours, "Vault: not expired");
        uint256 totalPosition = totalPositions[getProductId(product.expiry, product.anchorPrice, 0)];
        uint256 makerPosition = quotePositions[getProductId(product.expiry, product.anchorPrice, 1)];
        collateralPayoff = amount - (amount * makerPosition / totalPosition);
        quoteAssetPayoff = (amount - collateralPayoff) * product.anchorPrice * quoteAsset.decimals() / collateral.decimals() / PRICE_DECIMALS;
    }

    function harvest() external nonReentrant {
        uint256 fee = scrvUSD.balanceOf(address(this)) - totalDeposit;
        require(fee > 0, "Vault: zero fee");
        scrvUSD.withdraw(fee, feeCollector, address(this));

        emit FeeCollected(feeCollector, fee);
    }

    function totalFee() external view returns (uint256) {
       return scrvUSD.balanceOf(address(this)) - totalDeposit;
    }

    // get product id by parameters
    function getProductId(uint256 expiry, uint256 anchorPrice, uint256 isMaker) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(expiry, anchorPrice, isMaker)));
    }

    function getMinterProductId(uint256 expiry, uint256 anchorPrice, uint256 premiumPercentage) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(expiry, anchorPrice, premiumPercentage)));
    }

    // get decimals
    function decimals() external view returns (uint8) {
        return collateral.decimals();
    }

    uint256[50] private __gap;
}
