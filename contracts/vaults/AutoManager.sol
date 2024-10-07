// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/utils/ERC1155HolderUpgradeable.sol";

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

contract AutoManager is Initializable, ContextUpgradeable, OwnableUpgradeable, ERC1155HolderUpgradeable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    IERC20 public rch;
    IERC20 public collateral;
    IMerkleAirdrop public airdrop;
    address public refferal;

    uint256 public totalShares;
    uint256 public accRCHPerShare; //1e18
    uint256 public accCollateralPerShare; //1e18
    uint256 public totalPendingRedemptions;

    mapping(address => User) private _users;
    mapping(address => bool) private _vaults;
    mapping(address => bool) private _makers;
    mapping(bytes32 => uint256) private _positions;

    struct User {
        uint256 shares;
        uint256 accRCH;
        uint256 accCollateral;
        uint256 pendingRedemptions;
        uint256 lastDepositTimestamp;
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

    event Deposit(address indexed account, uint256 amount, uint256 shares);
    event RCHClaimed(uint256[] indexes, uint256[] amounts, uint256 accRCHPerShare);

    constructor() {}

    function initialize(
        IERC20 rch_,
        IERC20 collateral_,
        IMerkleAirdrop airdrop_,
        address refferal_
    ) external initializer {
        rch = rch_;
        collateral = collateral_;
        airdrop = airdrop_;
        refferal = refferal_;
        __Ownable_init();
        __ERC1155Holder_init();
    }

    function deposit(uint256 amount) external {
        collateral.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        _mintShares(_msgSender(), amount + pendingCollateral);
        _users[_msgSender()].accCollateral = _users[_msgSender()].shares  * accCollateralPerShare / 1e18;
        _users[_msgSender()].lastDepositTimestamp = block.timestamp;

        emit Deposit(_msgSender(), amount, amount + pendingCollateral);
    }

    function withdraw(uint256 amount) external {
        require(_users[_msgSender()].lastDepositTimestamp < block.timestamp - 7 days, "AutoManager: can't withdraw within 7 days of deposit");

        uint256 pendingRCH = _users[_msgSender()].shares * accRCHPerShare / 1e18 - _users[_msgSender()].accRCH;
        require(rch.balanceOf(address(this)) >= pendingRCH, "AutoManager: insufficient rch rewards");

        uint256 pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        require(_users[_msgSender()].shares + pendingCollateral >= amount, "AutoManager: insufficient balance");

        if (pendingCollateral > amount) {
            _mintShares(_msgSender(), pendingCollateral - amount);
        } else if (pendingCollateral < amount) {
            _burnShares(_msgSender(), amount - pendingCollateral);
        }

        _users[_msgSender()].accRCH = _users[_msgSender()].shares * accRCHPerShare / 1e18;
        _users[_msgSender()].accCollateral = _users[_msgSender()].shares  * accCollateralPerShare / 1e18;

        rch.safeTransfer(_msgSender(), pendingRCH);
        if (collateral.balanceOf(address(this)) >= amount) {
            collateral.safeTransfer(_msgSender(), amount);
        } else {
            _users[_msgSender()].pendingRedemptions = amount;
            totalPendingRedemptions = totalPendingRedemptions + amount;
        }
    }

    function claimRedemptions() external {
        uint256 amount = _users[_msgSender()].pendingRedemptions;
        require(amount > 0, "AutoManager: no pending redemptions");
        require(collateral.balanceOf(address(this)) >= amount, "AutoManager: no enough collateral to redeem");

        _users[_msgSender()].pendingRedemptions = 0;
        totalPendingRedemptions = totalPendingRedemptions - amount;
        collateral.safeTransfer(_msgSender(), amount);
    }

    function mintProducts(
        ProductMint[] calldata products,
        bytes calldata signature
    ) external {
        bytes32 signatures;
        for (uint256 i = 0; i < products.length; i++) {
            require(_vaults[products[i].vault], "AutoManager: invalid vault");
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
        require(_makers[signer], "AutoManager: invalid maker");
        require(collateral.balanceOf(address(this)) >= totalPendingRedemptions, "AutoManager: no enough collateral to redeem");
    }

    function burnProducts(
        ProductBurn[] calldata products
    ) external {
        uint256 pendingCollateralPerShare = 0;
        for (uint256 i = 0; i < products.length; i++) {
            uint256 balanceBefore = collateral.balanceOf(address(this));
            IVault(products[i].vault).burnBatch(products[i].products);
            uint256 balanceAfter = collateral.balanceOf(address(this));
            uint256 earnings = balanceAfter - balanceBefore;
            bytes32 id = keccak256(abi.encodePacked(products[i].vault, products[i].products[0].expiry, products[i].products[0].anchorPrices));
            require(earnings >= _positions[id], "AutoManager: insufficient earnings");

            pendingCollateralPerShare = pendingCollateralPerShare + (earnings - _positions[id]) * 1e18 / totalShares;
            delete _positions[id];
        }
        accCollateralPerShare = accCollateralPerShare + pendingCollateralPerShare;
    }

    function _mintShares(address account, uint256 sharesAmount) internal {
        totalShares = totalShares + sharesAmount;
        _users[account].shares = _users[account].shares + sharesAmount;
    }

    function _burnShares(address account, uint256 amount) internal {
        totalShares = totalShares - amount;
        _users[account].shares = _users[account].shares - amount;
    }

    function updateRefferal(address refferal_) external onlyOwner {
        refferal = refferal_;
    }

    function enableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            _vaults[vaults_[i]] = true;
            collateral.approve(vaults_[i], type(uint256).max);
        }
    }

    function disableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            _vaults[vaults_[i]] = false;
            collateral.approve(vaults_[i], 0);
        }
    }

    function enableMakers(address[] calldata makers_) external onlyOwner {
        for (uint256 i = 0; i < makers_.length; i++) {
            _makers[makers_[i]] = true;
        }
    }

    function disableMakers(address[] calldata makers_) external onlyOwner {
        for (uint256 i = 0; i < makers_.length; i++) {
            _makers[makers_[i]] = false;
        }
    }

    function claimRCH(
        uint256[] calldata indexes,
        uint256[] calldata amounts,
        bytes32[][] calldata merkleProofs
    ) external {
        uint256 balanceBefore = rch.balanceOf(address(this));
        airdrop.claimMultiple(indexes, amounts, merkleProofs);
        uint256 balanceAfter = rch.balanceOf(address(this));
        // calc accRCHPerShare
        accRCHPerShare = accRCHPerShare + (balanceAfter - balanceBefore) * 1e18 / totalShares;
        emit RCHClaimed(indexes, amounts, accRCHPerShare);
    }

    function rchClaimed(uint256[] calldata indexes) external view returns (bool[] memory) {
        return airdrop.isClaimed(indexes);
    }

    function getUserInfo() external view returns (
        uint256 shares,
        uint256 pendingRCH,
        uint256 pendingCollateral,
        uint256 pendingRedemptions,
        uint256 lastDepositTimestamp)
    {
        shares = _users[_msgSender()].shares;
        pendingRCH = _users[_msgSender()].shares * accRCHPerShare / 1e18 - _users[_msgSender()].accRCH;
        pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        pendingRedemptions = _users[_msgSender()].pendingRedemptions;
        lastDepositTimestamp = _users[_msgSender()].lastDepositTimestamp;
    }
}
