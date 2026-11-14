import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import solc from "solc";

const contractsDir = new URL("../contracts/", import.meta.url);
const artifactDir = new URL("../artifacts/", import.meta.url);

// Read only local Solidity sources. npm installs the pinned compiler once;
// compilation does not need to fetch binaries or access a remote chain.
async function collectSources() {
  let entries;
  try {
    entries = await readdir(contractsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sol"))
    .map((entry) => entry.name)
    .sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        `contracts/${name}`,
        { content: await readFile(new URL(encodeURIComponent(name), contractsDir), "utf8") },
      ]),
    ),
  );
}

const sources = await collectSources();
if (Object.keys(sources).length === 0) {
  console.log("No Solidity sources yet.");
} else {
  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  for (const diagnostic of result.errors ?? []) {
    console.error(diagnostic.formattedMessage);
  }
  if (result.errors?.some(({ severity }) => severity === "error")) {
    process.exitCode = 1;
  } else {
    for (const [sourceName, entries] of Object.entries(result.contracts ?? {})) {
      const directory = new URL(`${sourceName}/`, artifactDir);
      await mkdir(directory, { recursive: true });
      for (const [contractName, contract] of Object.entries(entries)) {
        const artifact = {
          contractName,
          sourceName,
          compilerVersion: solc.version(),
          abi: contract.abi,
          bytecode: `0x${contract.evm.bytecode.object}`,
          deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
        };
        await writeFile(new URL(`${contractName}.json`, directory), `${JSON.stringify(artifact, null, 2)}\n`);
        console.log(`Built ${contractName} with Solidity ${solc.version()}.`);
      }
    }
  }
}
