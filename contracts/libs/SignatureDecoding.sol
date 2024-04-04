// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

library SignatureDecoding {
    function decodeSignature(bytes memory signature) internal pure returns (uint8 v, bytes32 r, bytes32 s) {
        require(signature.length == 65, "Invalid signature length");

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
    }
}
