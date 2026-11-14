import { readFile } from "node:fs/promises";
import { BrowserProvider } from "ethers";

export const LOCAL_CHAIN_ID = 31337n;

export async function openLocalNetwork() {
  // Explicitly select the in-memory network. No RPC URL or wallet is accepted.
  const { network } = await import("hardhat");
  const connection = await network.create({ network: "local" });
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    provider.destroy();
    await connection.close();
  }

  try {
    if ((await provider.getNetwork()).chainId !== LOCAL_CHAIN_ID) {
      throw new Error("This prototype only runs on the local development chain.");
    }
  } catch (error) {
    await close();
    throw error;
  }

  return { connection, provider, close };
}

export async function loadArtifact(name = "TournamentEscrow") {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("Invalid Solidity contract name.");
  }
  try {
    const path = new URL(`../artifacts/contracts/${name}.sol/${name}.json`, import.meta.url);
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Artifact for ${name} is missing. Run npm run build first.`, { cause: error });
    }
    throw error;
  }
}
