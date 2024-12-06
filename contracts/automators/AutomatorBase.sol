// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IFeeCollector.sol";

struct Product {
    uint256 expiry;
    uint256[2] anchorPrices;
    uint256 collateralAtRiskPercentage;
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

interface IVault {
    function mint(
        uint256 totalCollateral,
        MintParams calldata params,
        address referral
    ) external;

    function burn(uint256 expiry, uint256[2] calldata anchorPrices, uint256 collateralAtRiskPercentage, uint256 isMaker) external;
}

interface IAutomatorFactory {
    function vaults(address) external view returns (bool);
    function makers(address) external view returns (bool);
    function referral() external view returns (address);
    function feeCollector() external view returns (address);
}

contract AutomatorBase is ERC1155Holder, ERC20, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    address private _owner;
    IERC20 public collateral;
    uint256 public feeRate;
    address public immutable factory;
    uint256 public constant MINIMUM_SHARES = 10**3;

    uint256 public totalFee;
    uint256 public totalPendingRedemptions;
    uint256 public totalCollateral;

    mapping(bytes32 => uint256) private _positions;
    mapping(address => Redemption) private _redemptions;

    struct Redemption {
        uint256 pendingRedemption;
        uint256 redemptionRequestTimestamp;
    }

    struct ProductMint {
        address vault;
        uint256 totalCollateral;
        MintParams mintParams;
    }

    struct ProductBurn {
        address vault;
        Product[] products;
    }

    event Deposited(address indexed account, uint256 amount, uint256 shares);
    event Withdrawn(address indexed account, uint256 shares);
    event RedemptionsClaimed(address indexed account, uint256 amount, uint256 shares);
    event ProductsMinted(ProductMint[] products);
    event ProductsBurned(ProductBurn[] products, uint256 accCollateralPerShare, uint256 fee);
    event FeeCollected(address account, uint256 fee, uint256 protocolFee);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor() ERC20("", "") {
        factory = _msgSender();
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");
    }

    function initialize(
        address owner_,
        address collateral_,
        uint256 feeRate_
    ) external {
        require(_msgSender() == factory, "Automator: forbidden");
        _owner = owner_;
        collateral = IERC20(collateral_);
        feeRate = feeRate_;
    }

    function deposit(uint256 amount) external nonReentrant {
        collateral.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 shares;
        if (totalSupply() == 0) {
            shares = amount - MINIMUM_SHARES;
            _mint(address(0x000000000000000000000000000000000000dEaD), MINIMUM_SHARES);
        } else {
            shares = amount * totalSupply() / totalCollateral;
        }
        totalCollateral += amount;
        _mint(_msgSender(), shares);
        emit Deposited(_msgSender(), amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant {
        require(balanceOf(_msgSender()) >= shares, "Automator: insufficient shares");
        if (_redemptions[_msgSender()].pendingRedemption > 0) {
            totalPendingRedemptions = totalPendingRedemptions + shares - _redemptions[_msgSender()].pendingRedemption;
        } else {
            totalPendingRedemptions = totalPendingRedemptions + shares;
        }
        _redemptions[_msgSender()].pendingRedemption = shares;
        _redemptions[_msgSender()].redemptionRequestTimestamp = block.timestamp;

        emit Withdrawn(_msgSender(), shares);
    }

    function claimRedemptions() external nonReentrant {
        require(_redemptions[_msgSender()].pendingRedemption > 0, "Automator: no pending redemption");
        require(block.timestamp >= _redemptions[_msgSender()].redemptionRequestTimestamp + 7 days && block.timestamp < _redemptions[_msgSender()].redemptionRequestTimestamp + 7 days + 3 days, "Automator: invalid redemption");

        uint256 pendingRedemption = _redemptions[_msgSender()].pendingRedemption;
        uint256 amount = pendingRedemption * getPricePerShare() / 1e18;
        require(collateral.balanceOf(address(this)) >= amount, "Automator: insufficient collateral to redeem");

        totalPendingRedemptions -= pendingRedemption;
        _redemptions[_msgSender()].pendingRedemption = 0;
        totalCollateral -= amount;

        _burn(_msgSender(), pendingRedemption);
        collateral.safeTransfer(_msgSender(), amount);

        emit RedemptionsClaimed(_msgSender(), amount, pendingRedemption);
    }

    function mintProducts(
        ProductMint[] calldata products,
        bytes calldata signature
    ) external nonReentrant onlyOwner {
        bytes32 signatures;
        for (uint256 i = 0; i < products.length; i++) {
            require(IAutomatorFactory(factory).vaults(products[i].vault), "Automator: invalid vault");
            // approve vaults
            if (IERC20(collateral).allowance(address(this), products[i].vault) == 0) {
                IERC20(collateral).approve(products[i].vault, type(uint256).max);
            }
            IVault(products[i].vault).mint(
                products[i].totalCollateral,
                products[i].mintParams,
                IAutomatorFactory(factory).referral()
            );
            uint256 collateralAtRiskPercentage = products[i].mintParams.collateralAtRisk * 1e18 / products[i].totalCollateral;
            bytes32 id = keccak256(abi.encodePacked(products[i].vault, products[i].mintParams.expiry, products[i].mintParams.anchorPrices, collateralAtRiskPercentage));
            _positions[id] = _positions[id] + products[i].totalCollateral - products[i].mintParams.makerCollateral;
            signatures = signatures ^ keccak256(abi.encodePacked(products[i].mintParams.maker, products[i].mintParams.makerSignature));
        }

        (address signer, ) = signatures.toEthSignedMessageHash().tryRecover(signature);
        require(IAutomatorFactory(factory).makers(signer), "Automator: invalid maker");
        require(collateral.balanceOf(address(this)) >= totalFee + totalPendingRedemptions * getPricePerShare() / 1e18, "Automator: no enough collateral to redeem");

        emit ProductsMinted(products);
    }

    function burnProducts(
        ProductBurn[] calldata products
    ) external nonReentrant {
        uint256 totalEarned;
        uint256 totalPositions;
        uint256 fee;
        for (uint256 i = 0; i < products.length; i++) {
            for (uint256 j = 0; j < products[i].products.length; j++) {
                uint256 balanceBefore = collateral.balanceOf(address(this));
                IVault(products[i].vault).burn(
                    products[i].products[j].expiry,
                    products[i].products[j].anchorPrices,
                    products[i].products[j].collateralAtRiskPercentage,
                    0
                );
                uint256 balanceAfter = collateral.balanceOf(address(this));
                uint256 earned = balanceAfter - balanceBefore;
                totalEarned += earned;
                bytes32 id = keccak256(abi.encodePacked(products[i].vault, products[i].products[j].expiry, products[i].products[j].anchorPrices, products[i].products[j].collateralAtRiskPercentage));
                totalPositions += _positions[id];
                if (earned > _positions[id]) {
                    fee += (earned - _positions[id]) * (IFeeCollector(IAutomatorFactory(factory).feeCollector()).tradingFeeRate() + feeRate) / 1e18;
                }
                delete _positions[id];
            }
        }
        if (fee > 0) {
            totalFee += fee;
            totalEarned -= fee;
        }
        if (totalEarned > totalPositions) {
            totalCollateral += totalEarned - totalPositions;
        } else if (totalEarned < totalPositions) {
            totalCollateral -= totalPositions - totalEarned;
        }

        emit ProductsBurned(products, totalCollateral, fee);
    }

    function harvest() external {
        uint256 fee = totalFee * feeRate / (IFeeCollector(IAutomatorFactory(factory).feeCollector()).tradingFeeRate() + feeRate);
        uint256 protocolFee = totalFee - fee;
        require(fee > 0, "Automator: zero fee");
        totalFee = 0;
        collateral.safeTransfer(owner(), fee);
        collateral.safeTransfer(IAutomatorFactory(factory).feeCollector(), protocolFee);

        emit FeeCollected(_msgSender(), fee, protocolFee);
    }

    function name() public view virtual override returns (string memory) {
        return string(abi.encodePacked("Automator ", IERC20Metadata(address(collateral)).name()));
    }

    function symbol() public view virtual override returns (string memory) {
        return string(abi.encodePacked("at", IERC20Metadata(address(collateral)).symbol()));
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(address(collateral)).decimals();
    }

    function getRedemption() external view returns (uint256, uint256) {
        return (_redemptions[_msgSender()].pendingRedemption, _redemptions[_msgSender()].redemptionRequestTimestamp);
    }

    function getPricePerShare() public view returns (uint256) {
        if (totalSupply() == 0) {
            return 1e18;
        } else {
            return totalCollateral * 1e18 / totalSupply();
        }
    }

    function getUnredeemedCollateral() external view returns (uint256) {
        if (collateral.balanceOf(address(this)) > totalPendingRedemptions * getPricePerShare() / 1e18) {
            return collateral.balanceOf(address(this)) - totalPendingRedemptions * getPricePerShare() / 1e18;
        } else {
            return 0;
        }
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        if (from != address(0)) {
            require(balanceOf(from) >= amount + _redemptions[from].pendingRedemption, "Automator: invalid transfer amount");
        }
        super._beforeTokenTransfer(from, to, amount);
    }
}
