// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

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

contract Treasury is IERC1271, ERC4626, Ownable {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable factory;

    uint256 public totalPositions;

    mapping(bytes32 => Product) _positions;
    mapping(uint256 => bytes32[]) public expiries;

    modifier onlyVaults() {
        require(IAutomatorFactory(factory).vaults(msg.sender), "Treasury: caller is not a vault");
        _;
    }

    constructor(
        IERC20 asset,
        address factory_,
    )
        ERC4626(asset)
        ERC20(string(abi.encodePacked("Treasury of ", IERC20Metadata(address(asset)).name())), string(abi.encodePacked("v", IERC20Metadata(address(asset)).symbol())))
    {
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
        asset().safeTransferFrom(msg.sender, address(this), amount);
    }

    function _burnPositions() private nonReentrant {
        uint256 _totalPositions;
        uint256 expiry = (block.timestamp - 8 hours) % 1 days * 1 days + 8 hours;
        bytes32[] memory ids = expiries[expiry];
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

    function deposit(uint256 amount, address receiver) public override(ERC4626, IERC4626) nonReentrant returns (uint256 shares) {
        _burnPositions();
        return super.deposit(amount, receiver);
    }

    function mint(uint256 shares, address receiver) public override(ERC4626, IERC4626) nonReentrant returns (uint256 assets) {
        _burnPositions();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public override(ERC4626, IERC4626) nonReentrant returns (uint256 shares) {
        _burnPositions();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public override(ERC4626, IERC4626) nonReentrant returns (uint256 assets) {
        _burnPositions();
        return super.redeem(shares, receiver, owner);
    }


    // function isValidSignature(bytes32 hash, bytes memory signature) external view override returns (bytes4) {
    //     if (IAutomatorFactory(factory).vaults(msg.sender)) {
    //         address singer = hash.recover(signature);
    //         return IAutomatorFactory(factory).makers(singer) ? MAGIC_VALUE : 0xffffffff;
    //     }
    //     return 0xffffffff;
    // }

    function totalAssets() public view override returns (uint256) {
        return _asset.balanceOf(address(this)) + totalPositions();
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(asset()).decimals();
    }
}
