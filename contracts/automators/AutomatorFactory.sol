// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./AutomatorBase.sol";
import "hardhat/console.sol";

contract AutomatorFactory is Ownable {
    address public referral;
    address public feeCollector;
    address public immutable automator;
    mapping(address => bool) public vaults;
    mapping(address => bool) public makers;

    address[] public automators;
    mapping(address => mapping(address => address)) public getAutomator;

    event ReferralSet(address indexed oldReferral, address indexed newReferral);
    event FeeCollectorSet(address indexed oldFeeCollector, address indexed newFeeCollector);
    event AutomatorCreated(address indexed automator, address indexed collateral, uint256 feeRate);
    event VaultsEnabled(address[] vaults);
    event VaultsDisabled(address[] vaults);
    event MakersEnabled(address[] makers);
    event MakersDisabled(address[] makers);

    constructor(address referral_, address feeCollector_) {
        referral = referral_;
        feeCollector = feeCollector_;
        automator = address(new AutomatorBase());
    }

    function createAutomator(
        uint256 feeRate,
        address collateral
    ) external returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(_msgSender(), collateral));
        address _automator = Clones.cloneDeterministic(automator, salt);
        AutomatorBase(_automator).initialize(collateral, feeRate);
        getAutomator[_msgSender()][collateral] = _automator;
        automators.push(_automator);
        emit AutomatorCreated(_automator, collateral, feeRate);
        return _automator;
    }

    function automatorsLength() external view returns (uint256) {
        return automators.length;
    }

    function setReferral(address referral_) external onlyOwner {
        require(referral_ != address(0), "AutomatorFactory: referral is the zero address");
        emit ReferralSet(referral, referral_);
        referral = referral_;
    }

    function setFeeCollector(address feeCollector_) external onlyOwner {
        require(feeCollector_ != address(0), "AutomatorFactory: feeCollector is the zero address");
        emit FeeCollectorSet(feeCollector, feeCollector_);
        feeCollector = feeCollector_;
    }

    function enableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            vaults[vaults_[i]] = true;
        }
        emit VaultsEnabled(vaults_);
    }

    function disableVaults(address[] calldata vaults_) external onlyOwner {
        for (uint256 i = 0; i < vaults_.length; i++) {
            vaults[vaults_[i]] = false;
        }
        emit VaultsDisabled(vaults_);
    }

    function enableMakers(address[] calldata makers_) external onlyOwner {
        for (uint256 i = 0; i < makers_.length; i++) {
            makers[makers_[i]] = true;
        }
        emit MakersEnabled(makers_);
    }

    function disableMakers(address[] calldata makers_) external onlyOwner {
        for (uint256 i = 0; i < makers_.length; i++) {
            makers[makers_[i]] = false;
        }
        emit MakersDisabled(makers_);
    }
}
