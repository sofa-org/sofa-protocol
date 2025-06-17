// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {DataTypes} from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import {ReserveLogic} from "@aave/core-v3/contracts/protocol/libraries/logic/ReserveLogic.sol";
import {IAToken} from "@aave/core-v3/contracts/interfaces/IAToken.sol";


struct Product {
    address vault;
    uint256 expiry;
    uint256[2] anchorPrices;
    uint256 amount;
}

interface IVault {
    function burn(uint256 expiry, uint256[2] calldata anchorPrices, uint256 isMaker) external;
}

interface IAutomatorFactory {
    function vaults(address) external view returns (bool);
    function makers(address) external view returns (bool);
}

contract AAVETreasury is ERC4626, ERC1155Holder, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // bytes4 private constant MAGIC_VALUE = 0x1626ba7e;

    IAutomatorFactory public immutable factory;

    uint256 public totalPositions;

    // Aave Referral Code
    IPool public immutable pool;
    IAToken public immutable aToken;
    uint16 private constant REFERRAL_CODE = 0;

    mapping(bytes32 => Product) _positions;
    mapping(uint256 => bytes32[]) public expiries;

    modifier onlyVaults() {
        require(IAutomatorFactory(factory).vaults(msg.sender), "Treasury: caller is not a vault");
        _;
    }

    constructor(
        IERC20 asset,
        IPool aavePool,
        IAutomatorFactory factory_
    )
        ERC4626(asset)
        ERC20(string(abi.encodePacked("Treasury of ", IERC20Metadata(address(asset)).name())), string(abi.encodePacked("v", IERC20Metadata(address(asset)).symbol())))
    {
        pool = aavePool;
        aToken = IAToken(pool.getReserveData(address(asset)).aTokenAddress);
        asset.safeApprove(address(pool), type(uint256).max);
        factory = factory_;
    }

    function mintPosition(uint256 expiry, uint256[2] calldata anchorPrices, uint256 amount, address maker) external nonReentrant onlyVaults {
        require(IAutomatorFactory(factory).makers(maker), "Treasury: signer is not a maker");
        bytes32 id = keccak256(abi.encodePacked(msg.sender, expiry, anchorPrices));
        if (_positions[id].amount == 0) {
            _positions[id].vault = msg.sender;
            _positions[id].expiry = expiry;
            _positions[id].anchorPrices = anchorPrices;
            expiries[expiry].push(id);
        }
        _positions[id].amount += amount;
        totalPositions += amount;
        IERC20(address(aToken)).safeTransfer(msg.sender, amount);
    }

    function _burnPositions() private {
        uint256 _totalPositions;
        uint256 expiry = (block.timestamp - 8 hours) / 1 days * 1 days + 8 hours;
        while (true) {
            bytes32[] memory ids = expiries[expiry];
            uint256 len = ids.length;
            if (len == 0) break;
            for (uint256 i = 0; i < len; ) {
                bytes32 id = ids[i++];
                Product memory product = _positions[id];
                IVault(product.vault).burn(product.expiry, product.anchorPrices, 1);
                _totalPositions += product.amount;
            }
            delete expiries[expiry];
            expiry -= 1 days;
        }
        totalPositions -= _totalPositions;
    }

    function deposit(uint256 amount, address receiver) public override(ERC4626) nonReentrant returns (uint256 shares) {
        _burnPositions();
        return super.deposit(amount, receiver);
    }

    function mint(uint256, address) public pure override(ERC4626) returns (uint256) {
        revert("AAVETreasury: minting shares is not supported");
    }

    function withdraw(uint256, address, address) public pure override(ERC4626) returns (uint256) {
        revert("AAVETreasury: withdrawing assets is not supported, use redeem instead");
    }

    function redeem(uint256 shares, address receiver, address owner) public override(ERC4626) nonReentrant returns (uint256 assets) {
        _burnPositions();
        return super.redeem(shares, receiver, owner);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override(ERC4626) {
        super._deposit(caller, receiver, assets, shares);
        pool.supply(
            address(asset()),
            assets,
            address(this),
            REFERRAL_CODE
        );
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override(ERC4626) {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        // If _asset is ERC777, `transfer` can trigger a reentrancy AFTER the transfer happens through the
        // `tokensReceived` hook. On the other hand, the `tokensToSend` hook, that is triggered before the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer after the burn so that any reentrancy would happen after the
        // shares are burned and after the assets are transferred, which is a valid state.
        _burn(owner, shares);
        pool.withdraw(
            address(asset()),
            assets,
            receiver
        );

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
    //     if (IAutomatorFactory(factory).vaults(msg.sender)) {
    //         address singer = hash.recover(signature);
    //         return IAutomatorFactory(factory).makers(singer) ? MAGIC_VALUE : 0xffffffff;
    //     }
    //     return 0xffffffff;
    // }

    function totalAssets() public view override returns (uint256) {
        return aToken.balanceOf(address(this)) + totalPositions;
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(asset()).decimals();
    }
}