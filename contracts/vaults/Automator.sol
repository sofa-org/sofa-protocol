// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";
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

interface IMerkleAirdrop {
    function isClaimed(uint256[] calldata indexes) external view returns (bool[] memory);
    function claimMultiple(uint256[] calldata indexes, uint256[] calldata amounts, bytes32[][] calldata merkleProofs) external;
}

contract Automator is Initializable, ContextUpgradeable, OwnableUpgradeable, ERC1155HolderUpgradeable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    IERC20 public collateral;
    IMerkleAirdrop public airdrop;
    address public refferal;

    uint256 public totalShares;
    uint256 public accCollateralPerShare; //1e18
    uint256 public totalPendingRedemptions;
    uint256 public totalFee;
    address public feeCollector;

    mapping(address => User) private _users;
    mapping(address => bool) private _vaults;
    mapping(address => bool) private _makers;
    mapping(bytes32 => uint256) private _positions;

    struct User {
        uint256 shares;
        uint256 accCollateral;
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
        IERC20 collateral_,
        IMerkleAirdrop airdrop_,
        address refferal_,
        address feeCollector_
    ) external initializer {
        collateral = collateral_;
        airdrop = airdrop_;
        refferal = refferal_;
        feeCollector = feeCollector_;
        accCollateralPerShare = 1e18;
        __Ownable_init();
        __ERC1155Holder_init();
    }

    function deposit(uint256 amount) external {
        collateral.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 unrealizedAccCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18;
        if (unrealizedAccCollateral >= _users[_msgSender()].accCollateral) {
            uint256 pendingCollateral = unrealizedAccCollateral - _users[_msgSender()].accCollateral;
            _mintShares(_msgSender(), amount + pendingCollateral);
        } else {
            uint256 pendingCollateral = _users[_msgSender()].accCollateral - unrealizedAccCollateral;
            if (pendingCollateral > amount) {
                _burnShares(_msgSender(), pendingCollateral - amount);
            } else if (pendingCollateral < amount) {
                _mintShares(_msgSender(), amount - pendingCollateral);
            }
        }
        _users[_msgSender()].accCollateral = _users[_msgSender()].shares  * accCollateralPerShare / 1e18;

        emit Deposited(_msgSender(), amount, _users[_msgSender()].shares);
    }

    function withdraw(uint256 amount) external {
        require(_users[_msgSender()].pendingRedemption == 0, "Automator: pending redemption");
        uint256 unrealizedAccCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18;
        if (unrealizedAccCollateral >= _users[_msgSender()].accCollateral) {
            uint256 pendingCollateral = unrealizedAccCollateral - _users[_msgSender()].accCollateral;
            require(_users[_msgSender()].shares + pendingCollateral >= amount, "Automator: insufficient balance");
        } else {
            uint256 pendingCollateral = _users[_msgSender()].accCollateral - unrealizedAccCollateral;
            require(_users[_msgSender()].shares - pendingCollateral >= amount, "Automator: insufficient balance");
        }

        _users[_msgSender()].pendingRedemption = amount;
        _users[_msgSender()].redemptionRequestTimestamp = block.timestamp;
        totalPendingRedemptions += amount;

        emit Withdrawn(_msgSender(), amount);
    }

    function claimRedemptions() external {
        require(block.timestamp >= _users[_msgSender()].redemptionRequestTimestamp + 7 days, "Automator: early redemption");

        uint256 pendingRedemption = _users[_msgSender()].pendingRedemption;
        uint256 unrealizedAccCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18;
        if (unrealizedAccCollateral >= _users[_msgSender()].accCollateral) {
            uint256 pendingCollateral = unrealizedAccCollateral - _users[_msgSender()].accCollateral;
            if (pendingCollateral > pendingRedemption) {
                _mintShares(_msgSender(), pendingCollateral - pendingRedemption);
            } else if (pendingCollateral < pendingRedemption) {
                if (_users[_msgSender()].shares >= pendingRedemption - pendingCollateral) {
                    _burnShares(_msgSender(), pendingRedemption - pendingCollateral);
                } else {
                    pendingRedemption = _users[_msgSender()].shares;
                    _burnShares(_msgSender(), _users[_msgSender()].shares);
                }
            }
        } else {
            uint256 pendingCollateral = _users[_msgSender()].accCollateral - unrealizedAccCollateral;
            if (_users[_msgSender()].shares >= pendingRedemption + pendingCollateral) {
                _burnShares(_msgSender(), pendingRedemption + pendingCollateral);
            } else {
                pendingRedemption = _users[_msgSender()].shares;
                _burnShares(_msgSender(), _users[_msgSender()].shares);
            }
        }
        _users[_msgSender()].accCollateral = _users[_msgSender()].shares  * accCollateralPerShare / 1e18;
        require(collateral.balanceOf(address(this)) >= pendingRedemption, "Automator: no enough collateral to redeem");

        totalPendingRedemptions -= pendingRedemption;
        collateral.safeTransfer(_msgSender(), pendingRedemption);

        emit RedemptionsClaimed(_msgSender(), pendingRedemption, _users[_msgSender()].shares);
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
        require(collateral.balanceOf(address(this)) >= totalPendingRedemptions, "Automator: no enough collateral to redeem");

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
            accCollateralPerShare += (totalEarned - totalPositions) * 1e18 / totalShares;
        } else if (totalEarned < totalPositions) {
            accCollateralPerShare -= (totalPositions - totalEarned) * 1e18 / totalShares;
        }

        emit ProductsBurned(products, accCollateralPerShare, fee);
    }

    function _mintShares(address account, uint256 sharesAmount) internal {
        totalShares = totalShares + sharesAmount;
        _users[account].shares = _users[account].shares + sharesAmount;
    }

    function _burnShares(address account, uint256 amount) internal {
        totalShares = totalShares - amount;
        _users[account].shares = _users[account].shares - amount;
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

    function getUserInfo() external view returns (
        uint256 shares,
        uint256 pendingCollateral,
        uint256 pendingRedemption,
        uint256 redemptionRequestTimestamp
    )
    {
        shares = _users[_msgSender()].shares;
        pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        pendingRedemption = _users[_msgSender()].pendingRedemption;
        redemptionRequestTimestamp = _users[_msgSender()].redemptionRequestTimestamp;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _users[_msgSender()].shares + _users[account].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
    }
}
