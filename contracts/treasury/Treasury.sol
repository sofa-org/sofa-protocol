// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IAutomatorFactory {
    function vaults(address) external view returns (bool);
    function makers(address) external view returns (bool);
    function referral() external view returns (address);
    function feeCollector() external view returns (address);
}

contract Treasury is IERC1271, ERC4626, Ownable {
    bytes4 private constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable factory;

    uint256 private _totalPositions;

    mapping(uint256 => address) public vaults;
    mapping(uint256 => uint256[]) public positions;

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

    // TODO: 参考Automator mintProducts
    function mintPosition(uint256 positionId, uint256 expiry, uint256 amount) external nonReentrant onlyVaults {
        if (vaults[positionId] == address(0)) {
            vaults[positionId] = msg.sender;
            positions[expiry].push(positionId);
        }
        _totalPositions += amount;
        asset().safeTransferFrom(msg.sender, address(this), amount);
    }

    function mintPositions(uint256[] memory positionIds, uint256[] memory expiries, uint256[] memory amounts) external nonReentrant onlyVaults {
        require(positionIds.length == expiries.length && positionIds.length == amounts.length, "Treasury: invalid input");
        uint256 amount;
        for (uint256 i = 0; i < positionIds.length; i++) {
            if (vaults[positionId[i]] == address(0)) {
                vaults[positionId[i]] = msg.sender;
                positions[expiry[i]].push(positionId[i]);
            }
            amount += amounts[i];
            asset().safeTransferFrom(msg.sender, address(this), amounts[i]);
        }
        _totalPositions += amount;
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

    function totalPositions() public view returns (uint256) {
        return _totalPositions;
    }

    function decimals() public view virtual override returns (uint8) {
        return IERC20Metadata(asset()).decimals();
    }
}
