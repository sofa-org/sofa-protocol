// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import "../interfaces/IWETH.sol";
import "../interfaces/IPermit2.sol";
import "../interfaces/IDNTStrategy.sol";
import "../interfaces/IHlOracle.sol";
import "../interfaces/IFeeCollector.sol";
import "../utils/SignatureBitMap.sol";

contract LeverageDNTVault is Initializable, ContextUpgradeable, ERC1155Upgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, SignatureBitMap {
    using SafeERC20 for IERC20Metadata;
    using SignatureCheckerUpgradeable for address;

    struct Product {
        uint256 term;
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

    IWETH public weth;
    IPermit2 public permit2;
    IDNTStrategy public strategy;
    IERC20Metadata public collateral;
    IHlOracle public oracle;

    uint256 public borrowAPR;
    uint256 public spreadAPR;
    uint256 public totalFee;
    address public feeCollector;

    // Events
    event Minted(address minter, address maker, address referral, uint256 totalCollateral, uint256 term, uint256 expiry, uint256[2] anchorPrices, uint256 makerCollateral, uint256 collateralAtRiskPercentage);
    event Burned(address operator, uint256 productId, uint256 amount, uint256 payoff);
    event BatchBurned(address operator, uint256[] productIds, uint256[] amounts, uint256[] payoffs);
    event FeeCollected(address collector, uint256 amount);

    modifier onlyETHVault() {
        require(address(collateral) == address(weth), "Vault: only ETH vault");
        _;
    }

    receive() external payable {}

    function initialize(
        string memory name_,
        string memory symbol_,
        IPermit2 permit_,
        IDNTStrategy strategy_,
        address weth_,
        address collateral_,
        address feeCollector_,
        uint256 borrowAPR_,
        uint256 spreadAPR_,
        IHlOracle oracle_
    ) initializer external {
        name = name_;
        symbol = symbol_;

        weth = IWETH(weth_);
        permit2 = permit_;
        strategy = strategy_;

        collateral = IERC20Metadata(collateral_);
        oracle = oracle_;

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
        permit2.permitTransferFrom(
            IPermit2.PermitTransferFrom({
                permitted: IPermit2.TokenPermissions({
                    token: collateral,
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
        weth.deposit{value: msg.value}();
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
        require(params.maker.isValidSignatureNow(digest, params.makerSignature), "Vault: invalid maker signature");
        consumeSignature(params.makerSignature);

        // transfer makercollateral
        collateral.safeTransferFrom(params.maker, address(this), params.makerCollateral);
        }
        uint256 term;
        uint256 collateralAtRiskPercentage;
        // mint product
        {
        // startDate = ((expiry-28800)/86400+1)*86400+28800
        term = (params.expiry - (((block.timestamp - 28800) / 86400 + 1) * 86400 + 28800)) / 86400;
        require(term > 0, "Vault: invalid term");

        // (totalCollateral - makerCollateral) = minterCollateral + minterCollateral * LEVERAGE_RATIO * borrowAPR / SECONDS_IN_YEAR * (expiry - block.timestamp)
        uint256 minterCollateral = (totalCollateral - params.makerCollateral) * APR_BASE / (APR_BASE + LEVERAGE_RATIO * borrowAPR * (params.expiry - block.timestamp) / SECONDS_IN_YEAR);
        uint256 borrowFee = minterCollateral * LEVERAGE_RATIO * borrowAPR * (params.expiry - block.timestamp) / SECONDS_IN_YEAR / APR_BASE;
        uint256 spreadFee = minterCollateral * LEVERAGE_RATIO * spreadAPR * (params.expiry - block.timestamp) / SECONDS_IN_YEAR / APR_BASE;
        require(borrowFee - spreadFee >= params.collateralAtRisk - params.makerCollateral, "Vault: invalid collateral at risk");
        uint256 tradingFee = (params.collateralAtRisk - params.makerCollateral) * IFeeCollector(feeCollector).tradingFeeRate()  / 1e18;
        totalFee = totalFee + spreadFee + tradingFee;
        collateralAtRiskPercentage = params.collateralAtRisk * 1e18 / (totalCollateral - tradingFee - spreadFee);
        require(collateralAtRiskPercentage > 0 && collateralAtRiskPercentage <= 1e18, "Vault: invalid collateral");

        uint256 productId = getProductId(term, params.expiry, params.anchorPrices, collateralAtRiskPercentage, uint256(0));
        uint256 makerProductId = getProductId(term, params.expiry, params.anchorPrices, collateralAtRiskPercentage, uint256(1));
        _mint(_msgSender(), productId, totalCollateral - tradingFee - spreadFee, "");
        _mint(params.maker, makerProductId, totalCollateral - tradingFee - spreadFee, "");
        }

        emit Minted(_msgSender(), params.maker, referral, totalCollateral, term, params.expiry, params.anchorPrices, params.makerCollateral, collateralAtRiskPercentage);
    }

    function burn(uint256 term, uint256 expiry, uint256[2] calldata anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) external {
        uint256 payoff = _burn(term, expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
        if (payoff > 0) {
            collateral.safeTransfer(_msgSender(), payoff);
        }
    }

    function ethBurn(uint256 term, uint256 expiry, uint256[2] calldata anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) external onlyETHVault {
        uint256 payoff = _burn(term, expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
        if (payoff > 0) {
            weth.withdraw(payoff);
            (bool success, ) = _msgSender().call{value: payoff, gas: 100_000}("");
            require(success, "Failed to send ETH");
        }
    }

    function _burn(uint256 term, uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) internal nonReentrant returns (uint256 payoff) {
        (uint256 latestTerm, uint256 latestExpiry, bool _isBurnable) = isBurnable(term, expiry, anchorPrices);
        require(_isBurnable, "Vault: not burnable");

        // check if settled
        require(oracle.settlePrices(latestExpiry, 1) > 0, "Vault: not settled");

        uint256 productId = getProductId(term, expiry, anchorPrices, collateralAtRiskPercentage, isMaker);
        uint256 amount = balanceOf(_msgSender(), productId);
        require(amount > 0, "Vault: zero amount");

        // calculate payoff by strategy
        if (isMaker == 1) {
            payoff = getMakerPayoff(latestTerm, latestExpiry, anchorPrices, collateralAtRiskPercentage, amount);
        } else {
            uint256 settlementFee;
            (payoff, settlementFee) = getMinterPayoff(latestTerm, latestExpiry, anchorPrices, collateralAtRiskPercentage, amount);
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
            collateral.safeTransfer(_msgSender(), totalPayoff);
        }
    }

    function ethBurnBatch(Product[] calldata products) external onlyETHVault {
       uint256 totalPayoff = _burnBatch(products);

       if (totalPayoff > 0) {
           weth.withdraw(totalPayoff);
           (bool success, ) = _msgSender().call{value: totalPayoff, gas: 100_000}("");
           require(success, "Failed to send ETH");
       }
    }

    function _burnBatch(Product[] calldata products) internal nonReentrant returns (uint256 totalPayoff) {
        uint256[] memory productIds = new uint256[](products.length);
        uint256[] memory amounts = new uint256[](products.length);
        uint256[] memory payoffs = new uint256[](products.length);
        uint256 settlementFee;
        for (uint256 i = 0; i < products.length; i++) {
            Product memory product = products[i];

            (uint256 latestTerm, uint256 latestExpiry, bool _isBurnable) = isBurnable(product.term, product.expiry, product.anchorPrices);
            require(_isBurnable, "Vault: not burnable");

            // check if settled
            require(oracle.settlePrices(latestExpiry, 1) > 0, "Vault: not settled");

            uint256 productId = getProductId(product.term, product.expiry, product.anchorPrices, product.collateralAtRiskPercentage, product.isMaker);
            uint256 amount = balanceOf(_msgSender(), productId);
            require(amount > 0, "Vault: zero amount");

            // calculate payoff by strategy
            if (product.isMaker == 1) {
                payoffs[i] = getMakerPayoff(latestTerm, latestExpiry, product.anchorPrices, product.collateralAtRiskPercentage, amount);
            } else {
                uint256 fee;
                (payoffs[i], fee) = getMinterPayoff(latestTerm, latestExpiry, product.anchorPrices, product.collateralAtRiskPercentage, amount);
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
        uint256 fee = totalFee;
        require(fee > 0, "Vault: zero fee");
        totalFee = 0;
        collateral.safeTransfer(feeCollector, fee);

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

    function getMakerPayoff(uint256 term, uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 amount) public view returns (uint256 payoff) {
        uint256 maxPayoff = amount * collateralAtRiskPercentage / 1e18;
        payoff = strategy.getMakerPayoff(anchorPrices, oracle.getHlPrices(term, expiry), maxPayoff);
    }

    function getMinterPayoff(uint256 term, uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 amount) public view returns (uint256 payoff, uint256 fee) {
        uint256 maxPayoff = amount * collateralAtRiskPercentage / 1e18;
        uint256 payoffWithFee = strategy.getMinterPayoff(anchorPrices, oracle.getHlPrices(term, expiry), maxPayoff);
        fee = payoffWithFee * IFeeCollector(feeCollector).settlementFeeRate() / 1e18;
        payoff = payoffWithFee - fee + (amount - amount * collateralAtRiskPercentage / 1e18);
    }

    // get product id by term, expiry and strike prices
    function getProductId(uint256 term, uint256 expiry, uint256[2] memory anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(term, expiry, anchorPrices, collateralAtRiskPercentage, isMaker)));
    }

    // get decimals
    function decimals() external view returns (uint8) {
        return collateral.decimals();
    }

    // check if the product is burnable
    function isBurnable(uint256 term, uint256 expiry, uint256[2] memory anchorPrices)
        public
        view
        returns (uint256, uint256, bool)
    {
        if (expiry <= block.timestamp) {
            return (term, expiry, true);
        } else {
            uint256 latestExpiry = (block.timestamp - 28800) / 86400 * 86400 + 28800;
            uint256 termGap = (expiry - latestExpiry) / 86400;
            if (termGap > term) {
                return (term, latestExpiry, false);
            } else {
                uint256 latestTerm = term - termGap;
                uint256[2] memory prices = oracle.getHlPrices(latestTerm, latestExpiry);
                return(latestTerm, latestExpiry, prices[0] <= anchorPrices[0] || prices[1] >= anchorPrices[1]);
            }
        }
    }

    uint256[50] private __gap;
}
