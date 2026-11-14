import { LOCAL_CHAIN_ID, openLocalNetwork } from "./local-chain.mjs";

const chain = await openLocalNetwork();
try {
  await chain.provider.getSigner(0);
  console.log(`Local in-memory chain ready (chain ID ${LOCAL_CHAIN_ID}).`);
} finally {
  await chain.close();
}
