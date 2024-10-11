// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "../interfaces/IFeeCollector.sol";

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

interface IVault {
    function mint(
        uint256 totalCollateral,
        MintParams calldata params,
        address referral
    ) external;

    function burnBatch(Product[] calldata products) external;
}

contract Automator is Initializable, ContextUpgradeable, OwnableUpgradeable, ERC1155HolderUpgradeable, ERC20Upgradeable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    address public refferal;
    IERC20 public collateral;

    uint256 public totalFee;
    address public feeCollector;
    uint256 public totalPendingRedemptions;
    uint256 public totalCollateral;

    mapping(address => bool) private _vaults;
    mapping(address => bool) private _makers;
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
    event Withdrawn(address indexed account, uint256 amount);
    event RedemptionsClaimed(address indexed account, uint256 amount, uint256 shares);
    event ProductsMinted(ProductMint[] products);
    event ProductsBurned(ProductBurn[] products, uint256 accCollateralPerShare, uint256 fee);
    event ReferralUpdated(address refferal);
    event VaultsEnabled(address[] vaults);
    event VaultsDisabled(address[] vaults);
    event MakersEnabled(address[] makers);
    event MakersDisabled(address[] makers);
    event FeeCollected(address account, uint256 amount);

    constructor() {}

    function initialize(
        address collateral_,
        address refferal_,
        address feeCollector_
    ) external initializer {
        collateral = IERC20(collateral_);
        refferal = refferal_;
        feeCollector = feeCollector_;
        __Ownable_init();
        __ERC1155Holder_init();
        __ERC20_init(
            string(abi.encodePacked("Automator ", IERC20Metadata(collateral_).name())),
            string(abi.encodePacked("at", IERC20Metadata(collateral_).symbol()))
        );
    }

    function deposit(uint256 amount) external {
        collateral.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 shares;
        if (totalSupply() == 0) {
            shares = amount;
        } else {
            shares = amount * totalSupply() / totalCollateral;
        }
        totalCollateral += amount;
        _mint(_msgSender(), shares);
        emit Deposited(_msgSender(), amount, shares);
    }

    function withdraw(uint256 shares) external {
        require(_redemptions[_msgSender()].pendingRedemption == 0, "Automator: pending redemption");
        require(balanceOf(_msgSender()) >= shares, "Automator: insufficient shares");
        _redemptions[_msgSender()].pendingRedemption = shares;
        _redemptions[_msgSender()].redemptionRequestTimestamp = block.timestamp;
        totalPendingRedemptions += shares;

        emit Withdrawn(_msgSender(), shares);
    }

    function claimRedemptions() external {
        require(_redemptions[_msgSender()].pendingRedemption > 0, "Automator: no pending redemption");
        require(block.timestamp >= _redemptions[_msgSender()].redemptionRequestTimestamp + 7 days, "Automator: early redemption");

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
    ) external {
        bytes32 signatures;
        for (uint256 i = 0; i < products.length; i++) {
            require(_vaults[products[i].vault], "Automator: invalid vault");
            IVault(products[i].vault).mint(
                products[i].totalCollateral,
                products[i].mintParams,
                refferal
            );
            bytes32 id = keccak256(abi.encodePacked(products[i].vault, products[i].mintParams.expiry, products[i].mintParams.anchorPrices));
            _positions[id] = _positions[id] + products[i].totalCollateral - products[i].mintParams.makerCollateral;
            signatures = signatures ^ keccak256(products[i].mintParams.makerSignature);
        }

        (address signer, ) = signatures.toEthSignedMessageHash().tryRecover(signature);
        require(_makers[signer], "Automator: invalid maker");
        require(collateral.balanceOf(address(this)) >= totalPendingRedemptions * getPricePerShare() / 1e18, "Automator: no enough collateral to redeem");

        emit ProductsMinted(products);
    }

    function burnProducts(
        ProductBurn[] calldata products
    ) external {
        uint256 totalEarned;
        uint256 totalPositions;
        uint256 fee;
        for (uint256 i = 0; i < products.length; i++) {
            uint256 balanceBefore = collateral.balanceOf(address(this));
            IVault(products[i].vault).burnBatch(products[i].products);
            uint256 balanceAfter = collateral.balanceOf(address(this));
            uint256 earned = balanceAfter - balanceBefore;
            totalEarned += earned;
            bytes32 id = keccak256(abi.encodePacked(products[i].vault, products[i].products[0].expiry, products[i].products[0].anchorPrices));
            totalPositions += _positions[id];
            if (earned > _positions[id]) {
                fee += (earned - _positions[id]) * IFeeCollector(feeCollector).tradingFeeRate() / 1e18;
            }
            delete _positions[id];
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
        uint256 fee = totalFee;
        require(fee > 0, "Vault: zero fee");
        totalFee = 0;
        collateral.safeTransfer(feeCollector, fee);

        emit FeeCollected(_msgSender(), fee);
    }

    function updateRefferal(address refferal_) external onlyOwner {
        refferal = refferal_;
        emit ReferralUpdated(refferal_);
    }

    function enableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            _vaults[vaults_[i]] = true;
            collateral.approve(vaults_[i], type(uint256).max);
        }
        emit VaultsEnabled(vaults_);
    }

    function disableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            _vaults[vaults_[i]] = false;
            collateral.approve(vaults_[i], 0);
        }
        emit VaultsDisabled(vaults_);
    }

    function enableMakers(address[] calldata makers_) external onlyOwner {
        for (uint256 i = 0; i < makers_.length; i++) {
            _makers[makers_[i]] = true;
        }
        emit MakersEnabled(makers_);
    }

    function disableMakers(address[] calldata makers_) external onlyOwner {
        for (uint256 i = 0; i < makers_.length; i++) {
            _makers[makers_[i]] = false;
        }
        emit MakersDisabled(makers_);
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(address(collateral)).decimals();
    }

    function getRedemption() external view returns (uint256, uint256) {
        return (_redemptions[_msgSender()].pendingRedemption, _redemptions[_msgSender()].redemptionRequestTimestamp);
    }

    function getPricePerShare() public view returns (uint256) {
        return totalCollateral * 1e18 / totalSupply();
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        if (from != address(0)) {
            require(balanceOf(from) >= amount + _redemptions[from].pendingRedemption, "Automator: invalid transfer amount");
        }
        super._beforeTokenTransfer(from, to, amount);
    }
}
