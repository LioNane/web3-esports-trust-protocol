import assert from 'node:assert/strict';
import { ContractFactory, id } from 'ethers';
import { loadArtifact, openLocalNetwork } from '../tooling/local-chain.mjs';

const POOL = 10_000n;
const CHALLENGE_SECONDS = 180;

async function mine(transaction) {
  await (await transaction).wait();
}

async function advanceToDeadline(provider, deadline) {
  const block = await provider.send('eth_getBlockByNumber', ['latest', false]);
  if (BigInt(block.timestamp) < deadline) {
    await provider.send('evm_setNextBlockTimestamp', [Number(deadline)]);
    await provider.send('evm_mine', []);
  }
}

async function main() {
  const artifact = await loadArtifact('TournamentEscrow');
  const { provider, close } = await openLocalNetwork();

  try {
    const [organiser, sponsor, reporter, reviewer, receiptReporter, ...players] =
      await Promise.all(Array.from({ length: 9 }, (_, i) => provider.getSigner(i)));
    const addresses = await Promise.all(players.map((player) => player.getAddress()));
    const names = ['Player A', 'Player B', 'Player C', 'Player D'];
    const playerNames = new Map(addresses.map((address, i) => [address.toLowerCase(), names[i]]));
    const rulesHash = id(`Demo event: free entry; test credit split 50/30/20; challenge ${CHALLENGE_SECONDS}s`);

    console.log('Local tournament demo — simulated credits only\n');
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, organiser);
    const escrow = await factory.deploy(
      await sponsor.getAddress(),
      await reporter.getAddress(),
      await reviewer.getAddress(),
      await receiptReporter.getAddress(),
      rulesHash,
      POOL,
      CHALLENGE_SECONDS,
    );
    await escrow.waitForDeployment();
    console.log('1. Deployed:', await escrow.getAddress());
    console.log('   Rules hash:', await escrow.rulesHash());

    for (const player of players) await mine(escrow.connect(player).join());
    assert.equal(await escrow.participantCount(), 4n);
    await mine(escrow.connect(sponsor).lockFunding(id('DEMO: sponsor allocation reserved')));
    assert.equal(await escrow.reservedCredits(), POOL);
    await mine(escrow.startEvent());
    assert.equal(await escrow.phase(), 1n);
    console.log(`2. ${await escrow.participantCount()} players joined for free. Reserved: ${await escrow.reservedCredits()} credits.`);

    const original = addresses.slice(0, 3);
    const evidenceHash = id('DEMO: synthetic ranking record A, B, C');
    await mine(escrow.connect(reporter).postResult(original, evidenceHash));
    console.log('3. Proposed ranking: Player A, Player B, Player C.');
    console.log('   Evidence hash:', await escrow.evidenceHash());

    await mine(escrow.connect(players[1]).challenge(id('DEMO: ask reviewer to check ranking order')));
    assert.equal(await escrow.phase(), 3n);
    assert.equal(await escrow.totalAwardedCredits(), 0n);
    console.log('4. Challenge recorded. Awards remain blocked during review.');
    console.log('   Challenge hash:', await escrow.challengeHash());

    const corrected = [addresses[1], addresses[0], addresses[3]];
    await mine(escrow.connect(reviewer).resolveChallenge(corrected, id('DEMO: review changes ranking to B, A, D')));
    assert.equal(await escrow.phase(), 4n);
    assert.equal((await escrow.originalPodium(0)).toLowerCase(), original[0].toLowerCase());
    console.log('5. Reviewer approves a corrected ranking. Original result retained.');
    console.log('   Decision hash:', await escrow.decisionHash());

    await advanceToDeadline(provider, await escrow.challengeDeadline());
    await mine(escrow.connect(players[0]).finalizeAwards());
    assert.equal(await escrow.phase(), 5n);
    assert.equal(await escrow.sponsorCredits() + await escrow.reservedCredits() + await escrow.totalAwardedCredits(), POOL);
    assert.equal(await escrow.totalAwardedCredits(), POOL);
    console.log('6. Challenge window closed. Final test credit awards:');
    for (let rank = 0; rank < corrected.length; rank += 1) {
      const winner = await escrow.awardPodium(rank);
      console.log(`   ${rank + 1}. ${playerNames.get(winner.toLowerCase())}: ${await escrow.awardCredits(winner)} credits`);
    }
    console.log(`   Total awarded: ${await escrow.totalAwardedCredits()} of ${POOL} credits.`);

    await mine(escrow.connect(receiptReporter).recordSettlement(id('DEMO: simulated settlement receipt')));
    assert.equal(await escrow.phase(), 6n);
    console.log('7. State: Settled (simulation).');
    console.log('   Receipt hash:', await escrow.receiptHash());
    console.log('\nNo money, tokens, or external payment provider were used.');
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
