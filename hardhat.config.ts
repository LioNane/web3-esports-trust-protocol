import { defineConfig } from "hardhat/config";

export default defineConfig({
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    local: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      hardfork: "shanghai",
    },
  },
});
