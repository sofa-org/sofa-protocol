import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.10",
        settings: {
          // viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  // contractSizer: {
  //   runOnCompile: true,
  //   only: ["vaults"],
  // },
  networks: {
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    hardhat: {
      forking: {
        enabled: true,
        url: process.env.MAINNET_RPC_URL as string,
        //blockNumber: 20516000,   //for stETH related test
        //blockNumber: 21152000, //for ScrvUSD related test and other tests
        blockNumber: 21160000, //for sUSDa related test
      },
      chainId: 1,
    },
    mainnet: {
      url: process.env.MAINNET_RPC_URL || "",
      accounts:
        process.env.PRIVATE_KEY_MAINNET !== undefined ? [process.env.PRIVATE_KEY_MAINNET] : [],
    },
    arbitrum: {
      url: process.env.ARBITRUM_URL || "",
      accounts:
        process.env.PRIVATE_KEY_ARBITRUM !== undefined ? [process.env.PRIVATE_KEY_ARBITRUM] : [],
    },
    bsc: {
      url: process.env.BSC_URL || "",
      accounts:
        process.env.PRIVATE_KEY_BSC !== undefined ? [process.env.PRIVATE_KEY_BSC] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "",
      accounts:
        process.env.PRIVATE_KEY_POLYGON !== undefined ? [process.env.PRIVATE_KEY_POLYGON] : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mumbai: {
      url: process.env.MUMBAI_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    merlin: {
      url: `https://rpc.merlinchain.io`,
      accounts:
        process.env.PRIVATE_KEY_MAINNET !== undefined ? [process.env.PRIVATE_KEY_MAINNET] : [],
    },
    sei: {
      url: `https://evm-rpc.sei-apis.com`,
      accounts:
        process.env.PRIVATE_KEY_MAINNET !== undefined ? [process.env.PRIVATE_KEY_MAINNET] : [],
    },
    merlinTestnet: {
      url: `https://testnet-rpc.merlinchain.io`,
      accounts: [process.env.PRIVATE_KEY],
    },
    beraTestnet: {
      url: `https://bartio.rpc.berachain.com/`,
      accounts:
        process.env.PRIVATE_KEY_MAINNET !== undefined ? [process.env.PRIVATE_KEY_MAINNET] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY,
      sepolia: process.env.ETHERSCAN_API_KEY,
      arbitrumOne: process.env.ARBITRUMSCAN_API_KEY,
      polygonMumbai: process.env.POLYGONSCAN_API_KEY,
      bsc: process.env.BSCSCAN_API_KEY,
      polygon: process.env.POLYGONSCAN_API_KEY,
    },
  },
  abiExporter: {
    path: './abis',
    runOnCompile: true,
    clear: true,
    spacing: 2,
    format: 'json'
  },
};

export default config;
