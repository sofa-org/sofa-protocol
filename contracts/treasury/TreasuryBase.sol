// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

struct Product {
    address vault;
    uint256 expiry;
    uint256[2] anchorPrices;
    uint256 amount;
}

struct Position {
    uint256 expiry;
    uint256[2] anchorPrices;
}
    
struct PositionBurn {
    address vault;
    Position[] positions;
}

interface IVault {
    function burn(uint256 expiry, uint256[2] calldata anchorPrices, uint256 isMaker) external;
}

interface IAutomatorFactory {
    function vaults(address) external view returns (bool);
    function makers(address) external view returns (bool);
}

abstract contract TreasuryBase is ERC4626, ERC1155Holder, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAutomatorFactory public immutable factory;

    uint256 public minExpiry;
    uint256 public totalPositions;

    mapping(bytes32 => Product) internal _positions;
    mapping(uint256 => bytes32[]) public expiries;

    modifier onlyVaults() {
        require(factory.vaults(msg.sender), "Treasury: caller is not a vault");
        _;
    }

    constructor(
        IERC20 asset,
        IAutomatorFactory factory_
    )
        ERC4626(asset)
        ERC20(string(abi.encodePacked("Treasury of ", IERC20Metadata(address(asset)).name())), string(abi.encodePacked("v", IERC20Metadata(address(asset)).symbol())))
    {
        factory = factory_;
    }

    

    function mintPosition(uint256 expiry, uint256[2] calldata anchorPrices, uint256 amount, address maker) external virtual nonReentrant onlyVaults {
        require(factory.makers(maker), "Treasury: signer is not a maker");
        bytes32 id = keccak256(abi.encodePacked(msg.sender, expiry, anchorPrices));
        if (_positions[id].amount == 0) {
            _positions[id].vault = msg.sender;
            _positions[id].expiry = expiry;
            _positions[id].anchorPrices = anchorPrices;
            expiries[expiry].push(id);
        }
        _positions[id].amount += amount;
        totalPositions += amount;
        IERC20(asset()).safeTransfer(msg.sender, amount);
        if (minExpiry == 0 || expiry < minExpiry) {
            minExpiry = expiry;
        }
    }

    function burnPositions(
        PositionBurn[] calldata positionsToBurn
    ) external nonReentrant {
        uint256 _totalPositions;
        for (uint256 i = 0; i < positionsToBurn.length; i++) {
            address vault = positionsToBurn[i].vault;
            Position[] calldata positions = positionsToBurn[i].positions;
            for (uint256 j = 0; j < positions.length; j++) {
                Position calldata position = positions[j];
                IVault(vault).burn(
                    position.expiry,
                    position.anchorPrices,
                    1
                );
                bytes32 id = keccak256(abi.encodePacked(vault, position.expiry, position.anchorPrices));
                _totalPositions += _positions[id].amount;
                delete _positions[id];
            }
        }
        totalPositions -= _totalPositions;
    }

    function _burnPositions() internal {
        if (minExpiry == 0 || block.timestamp < minExpiry) return;

        uint256 _totalPositions;
        uint256 expiry = minExpiry;
        
        // Burn all positions that have expired (current time >= expiry time)
        while (expiry <= block.timestamp) {
            bytes32[] storage ids = expiries[expiry];
            if (ids.length > 0) {
                for (uint256 i = 0; i < ids.length; i++) {
                    bytes32 id = ids[i];
                    Product storage product = _positions[id];
                    if (product.amount > 0) {
                        IVault(product.vault).burn(
                            product.expiry,
                            product.anchorPrices,
                            1
                        );
                        _totalPositions += product.amount;
                        delete _positions[id];
                    }
                }
                delete expiries[expiry];
            }
            expiry += 1 days;
        }
        
        minExpiry = expiry;

        if (_totalPositions > 0) totalPositions -= _totalPositions;
    }

    function deposit(uint256 amount, address receiver) public virtual override(ERC4626) nonReentrant returns (uint256 shares) {
        _burnPositions();
        return super.deposit(amount, receiver);
    }

    function mint(uint256 shares, address receiver) public virtual override(ERC4626) nonReentrant returns (uint256 assets) {
        _burnPositions();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner) public virtual override(ERC4626) nonReentrant returns (uint256 shares) {
        _burnPositions();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner) public virtual override(ERC4626) nonReentrant returns (uint256 assets) {
        _burnPositions();
        return super.redeem(shares, receiver, owner);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalPositions;
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(asset()).decimals();
    }
}
