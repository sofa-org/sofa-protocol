// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IZenRCH {
    function mint(uint256 amount) external returns (uint256);
    function withdraw(address to, uint256 shares) external returns (uint256);
}

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
    function referral() external view returns (address);
    function feeCollector() external view returns (address);
}

contract RCHTreasury is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;

    IERC20 public immutable rch;
    IAutomatorFactory public immutable factory;

    uint256 public totalPositions;

    mapping(bytes32 => Product) _positions;
    mapping(uint256 => bytes32[]) public expiries;

    modifier onlyVaults() {
        require(IAutomatorFactory(factory).vaults(msg.sender), "Treasury: caller is not a vault");
        _;
    }

    event Deposit(address indexed caller, address indexed receiver, uint256 assets, uint256 shares, uint256 amount);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares, uint256 amount);

    constructor(
        IERC20 rch_,
        IERC20 asset,
        IAutomatorFactory factory_
    )
        ERC4626(asset)
        ERC20(string(abi.encodePacked("Treasury of ", IERC20Metadata(address(asset)).name())), string(abi.encodePacked("v", IERC20Metadata(address(asset)).symbol())))
    {
        rch = rch_;
        rch.safeApprove(address(asset), type(uint256).max);
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
        IERC20(asset()).transfer(msg.sender, amount);
    }

    function _burnPositions() private nonReentrant {
        uint256 _totalPositions;
        uint256 expiry = (block.timestamp - 8 hours) % 1 days * 1 days + 8 hours;
        bytes32[] storage ids = expiries[expiry];
        while (ids.length > 0) {
            bytes32 id = ids[ids.length - 1];
            Product memory product = _positions[id];
            IVault(product.vault).burn(product.expiry, product.anchorPrices, 1);
            _totalPositions += product.amount;
            ids.pop();
            if (ids.length == 0) {
                delete expiries[expiry];
                expiry -= 1 days;
                ids = expiries[expiry];
            }
        }
        totalPositions -= _totalPositions;
    }

    function deposit(uint256 amount, address receiver) public override(ERC4626) nonReentrant returns (uint256 shares) {
        _burnPositions();
        uint256 assets = IZenRCH(asset()).mint(amount);
        require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");

        shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);

        emit Deposit(_msgSender(), receiver, assets, shares, amount);
    }

    function mint(uint256, address) public pure override(ERC4626) returns (uint256) {
        revert("RCHTreasury: minting is not supported, use deposit instead");
    }

    function withdraw(uint256, address, address) public pure override(ERC4626) returns (uint256) {
        revert("RCHTreasury: withdrawing is not supported, use redeem instead");
    }

    function redeem(uint256 shares, address receiver, address owner) public override(ERC4626) nonReentrant returns (uint256 assets) {
        _burnPositions();
        return super.redeem(shares, receiver, owner);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override(ERC4626) {
        // If _asset is ERC777, `transferFrom` can trigger a reentrancy BEFORE the transfer happens through the
        // `tokensToSend` hook. On the other hand, the `tokenReceived` hook, that is triggered after the transfer,
        // calls the vault, which is assumed not malicious.
        //
        // Conclusion: we need to do the transfer before we mint so that any reentrancy would happen before the
        // assets are transferred and before the shares are minted, which is a valid state.
        // slither-disable-next-line reentrancy-no-eth
        SafeERC20.safeTransferFrom(IERC20(address(asset())), caller, address(this), assets);
        _mint(receiver, shares);
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
        uint256 amount = IZenRCH(asset()).withdraw(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares, amount);
    }

    // function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
    //     if (IAutomatorFactory(factory).vaults(msg.sender)) {
    //         address singer = hash.recover(signature);
    //         return IAutomatorFactory(factory).makers(singer) ? MAGIC_VALUE : 0xffffffff;
    //     }
    //     return 0xffffffff;
    // }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalPositions;
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(asset()).decimals();
    }
}
