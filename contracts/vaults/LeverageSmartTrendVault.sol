// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "hardhat/console.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "../interfaces/IWETH.sol";
import "../interfaces/IPermit2.sol";
import "../interfaces/ISmartTrendStrategy.sol";
import "../interfaces/ISpotOracle.sol";
import "../interfaces/IFeeCollector.sol";
import "../libs/SignatureDecoding.sol";
import "../utils/SignatureBitMap.sol";

contract LeverageSmartTrendVault is Initializable, ContextUpgradeable, ERC1155Upgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, SignatureBitMap {
    using SafeERC20 for IERC20Metadata;
    using SignatureDecoding for bytes;

    struct Product {
        uint256 expiry;
        uint256[2] anchorPrices;
        uint256 collateralAtRiskPercentage;
        uint256 isMaker;
    }
    struct MintParams {
        uint256 expiry;
        uint256[2] anchorPrices;
        uint256 collateralAtRisk;
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
    //     "Mint(address minter,uint256 totalCollateral,uint256 expiry,uint256[2] anchorPrices,uint256 collateralAtRisk,uint256 makerCollateral,uint256 deadline,address vault)"
    // );
    bytes32 public constant MINT_TYPEHASH = 0xbbb96bd81b8359e3021ab4bd0188b2fb99443a6debe51f7cb0a925a398f17117;
    uint256 public constant LEVERAGE_RATIO = 9; // 9x
    uint256 internal constant APR_BASE = 1e18;
    uint256 internal constant SECONDS_IN_YEAR = 365 days;

    string public name;
    string public symbol;

    IWETH public WETH;
    IPermit2 public PERMIT2;
    ISmartTrendStrategy public STRATEGY;
    IERC20Metadata public COLLATERAL;
    ISpotOracle public ORACLE;

    uint256 public borrowAPR;
    uint256 public spreadAPR;
    uint256 public totalFee;
    address public feeCollector;

    // Events
    event Minted(address minter, address maker, address referral, uint256 totalCollateral, uint256 expiry, uint256[2] anchorPrices, uint256 makerCollateral, uint256 collateralAtRiskPercentage);
    event Burned(address burner, uint256 productId, uint256 amount, uint256 payoff);
    event BatchBurned(address operator, uint256[] productIds, uint256[] amounts, uint256[] payoffs);
    event FeeCollected(address collector, uint256 amount);

    modifier onlyETHVault() {
        require(address(COLLATERAL) == address(WETH), "Vault: only ETH vault");
        _;
    }

    receive() external payable {}

    function initialize(
        string memory name_,
        string memory symbol_,
        IPermit2 permit_,
        ISmartTrendStrategy strategy_,
        address weth_,
        address collateral_,
        address feeCollector_,
        uint256 borrowAPR_,
        uint256 spreadAPR_,
        ISpotOracle oracle_
    ) initializer external {
        name = name_;
        symbol = symbol_;

        WETH = IWETH(weth_);
        PERMIT2 = permit_;
        STRATEGY = strategy_;

        COLLATERAL = IERC20Metadata(collateral_);
        ORACLE = oracle_;

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
        borrowAPR = borrowAPR_;
        spreadAPR = spreadAPR_;

        __Context_init();
        __ERC1155_init("");
        __ReentrancyGuard_init();
        __Ownable_init();
    }

    function mint(
        uint256 totalCollateral,
        MintParams calldata params,
        bytes calldata minterPermitSignature,
        uint256 nonce,
        address referral
    ) external {
        // transfer collateral
        uint256 depositAmount = totalCollateral - params.makerCollateral;
        PERMIT2.permitTransferFrom(
            IPermit2.PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({
                    token: COLLATERAL,
                    amount: depositAmount
                }),
                nonce: nonce,
                deadline: params.deadline
            }),
            IPermit2.SignatureTransferDetails({
                to: address(this),
                requestedAmount: depositAmount
            }),
            _msgSender(),
            minterPermitSignature
        );
        _mint(totalCollateral, params, referral);
    }

    function mint(
        MintParams calldata params,
        address referral
    ) external payable onlyETHVault {
        WETH.deposit{value: msg.value}();
        _mint(
            params.makerCollateral + msg.value,
            params,
            referral
        );
    }

    function _mint(uint256 totalCollateral, MintParams memory params, address referral) internal {
        require(block.timestamp < params.deadline, "Vault: deadline");
        require(block.timestamp < params.expiry, "Vault: expired");
        // require expiry must be 8:00 UTC
        require(params.expiry % 86400 == 28800, "Vault: invalid expiry");
        require(params.anchorPrices[0] < params.anchorPrices[1], "Vault: invalid strike prices");
        require(params.collateralAtRisk <= totalCollateral, "Vault: invalid collateral");
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
                                     params.collateralAtRisk,
                                     params.makerCollateral,
                                     params.deadline,
                                     address(this)))
        ));
        (uint8 v, bytes32 r, bytes32 s) = params.makerSignature.decodeSignature();
        require(params.maker == ecrecover(digest, v, r, s), "Vault: invalid maker signature");
        consumeSignature(params.makerSignature);

        // transfer makerCollateral
        COLLATERAL.safeTransferFrom(params.maker, address(this), params.makerCollateral);
        }


        uint256 collateralAtRiskPercentage;
        {
        // (totalCollateral - makerCollateral) = minterCollateral * (1 + LEVERAGE_RATIO) + minterCollateral * LEVERAGE_RATIO * borrowAPR / SECONDS_IN_YEAR  * (expiry - block.timestamp)
        uint256 minterCollateral = (totalCollateral - params.makerCollateral) * APR_BASE / (APR_BASE + LEVERAGE_RATIO * APR_BASE + LEVERAGE_RATIO * borrowAPR * (params.expiry - block.timestamp) / SECONDS_IN_YEAR);
        uint256 borrowFee = minterCollateral * LEVERAGE_RATIO * borrowAPR * (params.expiry - block.timestamp) / SECONDS_IN_YEAR / 1e18;
        uint256 spreadFee = minterCollateral * LEVERAGE_RATIO * spreadAPR * (params.expiry - block.timestamp) / SECONDS_IN_YEAR / 1e18;
        require(borrowFee - spreadFee >= params.collateralAtRisk - params.makerCollateral, "Vault: invalid collateral at risk");
        uint256 tradingFee = (params.collateralAtRisk - params.makerCollateral) * IFeeCollector(feeCollector).tradingFeeRate()  / 1e18;
        totalFee = totalFee + spreadFee + tradingFee;
        collateralAtRiskPercentage = params.collateralAtRisk * 1e18 / (totalCollateral - tradingFee - spreadFee);

        // mint product
        uint256 productId = getProductId(params.expiry, params.anchorPrices, collateralAtRiskPercentage, uint256(0));
        uint256 makerProductId = getProductId(params.expiry, params.anchorPrices, collateralAtRiskPercentage, uint256(1));
        _mint(_msgSender(), productId, totalCollateral - tradingFee - spreadFee, "");
        _mint(params.maker, makerProductId, totalCollateral - tradingFee - spreadFee, "");
        }

        emit Minted(_msgSender(), params.maker, referral, totalCollateral, params.expiry, params.anchorPrices, params.makerCollateral, collateralAtRiskPercentage);
    }

    function burn(uint256 expiry, uint256[2] calldata anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) external {
        uint256 payoff = _burn(expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
        if (payoff > 0) {
            COLLATERAL.safeTransfer(_msgSender(), payoff);
        }
    }

    function ethBurn(uint256 expiry, uint256[2] calldata anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) external onlyETHVault {
        uint256 payoff = _burn(expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
        if (payoff > 0) {
            WETH.withdraw(payoff);
            payable(_msgSender()).transfer(payoff);
        }
    }

    function _burn(uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) internal nonReentrant returns (uint256 payoff) {
        require(block.timestamp >= expiry, "Vault: not expired");
        uint256 productId = getProductId(expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
        uint256 amount = balanceOf(_msgSender(), productId);
        require(amount > 0, "Vault: zero amount");

        // check if settled
        require(ORACLE.settlePrices(expiry) > 0, "Vault: not settled");

        // calculate payoff by strategy
        if (isMaker == 1) {
            payoff = getMakerPayoff(expiry, anchorPrices, collateralAtRiskPercentage, amount);
        } else {
            uint256 settlementFee;
            (payoff, settlementFee) = getMinterPayoff(expiry, anchorPrices, collateralAtRiskPercentage, amount);
            if (settlementFee > 0) {
                totalFee += settlementFee;
            }
        }

        // burn product
        _burn(_msgSender(), productId, amount);
        emit Burned(_msgSender(), productId, amount, payoff);
    }

    function burnBatch(Product[] calldata products) external {
        uint256 totalPayoff = _burnBatch(products);
        if (totalPayoff > 0) {
            COLLATERAL.safeTransfer(_msgSender(), totalPayoff);
        }
    }

    function ethBurnBatch(Product[] calldata products) external onlyETHVault {
        uint256 totalPayoff = _burnBatch(products);
        if (totalPayoff > 0) {
            WETH.withdraw(totalPayoff);
            payable(_msgSender()).transfer(totalPayoff);
        }
    }

    function _burnBatch(Product[] calldata products) internal nonReentrant returns (uint256 totalPayoff) {
        uint256[] memory productIds = new uint256[](products.length);
        uint256[] memory amounts = new uint256[](products.length);
        uint256[] memory payoffs = new uint256[](products.length);
        uint256 settlementFee;
        for (uint256 i = 0; i < products.length; i++) {
            Product memory product = products[i];
            uint256 productId = getProductId(product.expiry, product.anchorPrices, product.collateralAtRiskPercentage, product.isMaker);
            uint256 amount = balanceOf(_msgSender(), productId);
            require(amount > 0, "Vault: zero amount");
            require(block.timestamp >= product.expiry, "Vault: not expired");
            // check if settled
            require(ORACLE.settlePrices(product.expiry) > 0, "Vault: not settled");
            // calculate payoff by strategy
            if (product.isMaker == 1) {
                payoffs[i] = getMakerPayoff(product.expiry, product.anchorPrices, product.collateralAtRiskPercentage, amount);
            } else {
                uint256 fee;
                (payoffs[i], fee) = getMinterPayoff(product.expiry, product.anchorPrices, product.collateralAtRiskPercentage, amount);
                if (fee > 0) {
                    settlementFee += fee;
                }
            }
            if (payoffs[i] > 0) {
                totalPayoff += payoffs[i];
            }

            productIds[i] = productId;
            amounts[i] = amount;
        }
        if (settlementFee > 0) {
            totalFee += settlementFee;
        }
        // burn product
        _burnBatch(_msgSender(), productIds, amounts);
        emit BatchBurned(_msgSender(), productIds, amounts, payoffs);
    }

    // withdraw fee
    function harvest() external {
        require(totalFee > 0, "Vault: zero fee");
        uint256 fee = totalFee;
        totalFee = 0;
        COLLATERAL.safeTransfer(feeCollector, fee);

        emit FeeCollected(_msgSender(), fee);
    }

    // update borrowAPR
    function updateBorrowAPR(uint256 borrowAPR_) external onlyOwner {
        borrowAPR = borrowAPR_;
    }

    // update spreadAPR
    function updateSpreadAPR(uint256 spreadAPR_) external onlyOwner {
        spreadAPR = spreadAPR_;
    }

    function getMakerPayoff(uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 amount) public view returns (uint256 payoff) {
        uint256 maxPayoff = amount * collateralAtRiskPercentage / 1e18;
        payoff = STRATEGY.getMakerPayoff(anchorPrices, ORACLE.settlePrices(expiry), maxPayoff);
    }

    function getMinterPayoff(uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 amount) public view returns (uint256 payoff, uint256 fee) {
        uint256 maxPayoff = amount * collateralAtRiskPercentage / 1e18;
        uint256 payoffWithFee = STRATEGY.getMinterPayoff(anchorPrices, ORACLE.settlePrices(expiry), maxPayoff);
        fee = payoffWithFee * IFeeCollector(feeCollector).settlementFeeRate() / 1e18;
        payoff = payoffWithFee - fee + (amount * 1e18 - amount * collateralAtRiskPercentage) / 1e18;
    }

    // get product id by parameters
    function getProductId(uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(expiry, anchorPrices, collateralAtRiskPercentage, isMaker)));
    }

    // get decimals
    function decimals() external view returns (uint8) {
        return COLLATERAL.decimals();
    }

    uint256[50] private __gap;
}
