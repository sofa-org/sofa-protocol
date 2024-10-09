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

contract Automator is Initializable, ContextUpgradeable, OwnableUpgradeable, ERC1155HolderUpgradeable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    IERC20 public collateral;
    IMerkleAirdrop public airdrop;
    address public refferal;

    uint256 public totalShares;
    uint256 public accCollateralPerShare; //1e18
    uint256 public totalPendingRedemptions;

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
    event ProductsBurned(ProductBurn[] products, uint256 accCollateralPerShare);
    event ReferralUpdated(address refferal);
    event VaultsEnabled(address[] vaults);
    event VaultsDisabled(address[] vaults);
    event MakersEnabled(address[] makers);
    event MakersDisabled(address[] makers);

    constructor() {}

    function initialize(
        IERC20 collateral_,
        IMerkleAirdrop airdrop_,
        address refferal_
    ) external initializer {
        collateral = collateral_;
        airdrop = airdrop_;
        refferal = refferal_;
        accCollateralPerShare = 1e18;
        __Ownable_init();
        __ERC1155Holder_init();
    }

    function deposit(uint256 amount) external {
        collateral.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        _mintShares(_msgSender(), amount + pendingCollateral);
        _users[_msgSender()].accCollateral = _users[_msgSender()].shares  * accCollateralPerShare / 1e18;

        emit Deposited(_msgSender(), amount, amount + pendingCollateral);
    }

    function withdraw(uint256 amount) external {
        require(_users[_msgSender()].pendingRedemption == 0, "Automator: pending redemption");
        uint256 pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        require(_users[_msgSender()].shares + pendingCollateral >= amount, "Automator: insufficient balance");

        _users[_msgSender()].pendingRedemption = amount;
        _users[_msgSender()].redemptionRequestTimestamp = block.timestamp;
        totalPendingRedemptions += amount;

        emit Withdrawn(_msgSender(), amount);
    }

    function claimRedemptions() external {
        require(block.timestamp >= _users[_msgSender()].redemptionRequestTimestamp + 7 days, "Automator: early redemption");

        uint256 pendingRedemption = _users[_msgSender()].pendingRedemption;
        require(collateral.balanceOf(address(this)) >= pendingRedemption, "Automator: no enough collateral to redeem");

        uint256 pendingCollateral = _users[_msgSender()].shares * accCollateralPerShare / 1e18 - _users[_msgSender()].accCollateral;
        if (pendingCollateral > pendingRedemption) {
            _mintShares(_msgSender(), pendingCollateral - pendingRedemption);
        } else if (pendingCollateral < pendingRedemption) {
            _burnShares(_msgSender(), pendingRedemption - pendingCollateral);
        }
        _users[_msgSender()].accCollateral = _users[_msgSender()].shares  * accCollateralPerShare / 1e18;


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
        for (uint256 i = 0; i < products.length; i++) {
            uint256 balanceBefore = collateral.balanceOf(address(this));
            IVault(products[i].vault).burnBatch(products[i].products);
            uint256 balanceAfter = collateral.balanceOf(address(this));
            totalEarned += balanceAfter - balanceBefore;
            bytes32 id = keccak256(abi.encodePacked(products[i].vault, products[i].products[0].expiry, products[i].products[0].anchorPrices));
            totalPositions += _positions[id];
            delete _positions[id];
        }
        if (totalEarned > totalPositions) {
            accCollateralPerShare += (totalEarned - totalPositions) * 1e18 / totalShares;
        } else if (totalEarned < totalPositions) {
            accCollateralPerShare -= (totalPositions - totalEarned) * 1e18 / totalShares;
        }

        emit ProductsBurned(products, accCollateralPerShare);
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
