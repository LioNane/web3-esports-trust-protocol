import assert from 'node:assert/strict';
import test from 'node:test';
import { ContractFactory, ZeroAddress, ZeroHash, id } from 'ethers';
import { loadArtifact, openLocalNetwork } from '../tooling/local-chain.mjs';

const artifact = await loadArtifact('TournamentEscrow');
const POOL = 3200n;
const WINDOW = 3600n;
const RULES = id('Local demo: free entry, 50/30/20 prizes, one review');
const FUNDING = id('simulated sponsor funding confirmation');
const EVIDENCE = id('synthetic match results and evidence');
const CHALLENGE = id('synthetic request to check the ranking');
const DECISION = id('synthetic independent review decision');
const RECEIPT = id('simulated provider settlement receipt');
const CANCELLATION = id('simulated event cancellation decision');
const Phase = {
  Registration: 0n, Active: 1n, Proposed: 2n, Challenged: 3n,
  Reviewed: 4n, Finalized: 5n, Settled: 6n, Cancelled: 7n,
};

async function sent(pending) {
  const receipt = await (await pending).wait();
  assert.equal(receipt.status, 1);
  return receipt;
}

async function expectError(target, name, call) {
  await assert.rejects(call, (error) => {
    assert.equal(error.code, 'CALL_EXCEPTION', `Expected ${name}, got ${error.code}`);
    const decoded = error.revert?.name ??
      (error.data && target.interface.parseError(error.data)?.name);
    assert.equal(decoded, name);
    return true;
  });
}

async function fixture(t) {
  const { connection, provider } = await openLocalNetwork();
  t.after(() => connection.close());
  const signers = await Promise.all(Array.from({ length: 10 }, (_, i) => provider.getSigner(i)));
  const [organizer, sponsor, reporter, reviewer, settlement, ...others] = signers;
  const players = others.slice(0, 4);
  const spectator = others[4];
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, organizer);
  const args = [sponsor.address, reporter.address, reviewer.address, settlement.address, RULES, POOL, WINDOW];
  const escrow = await factory.deploy(...args);
  await escrow.waitForDeployment();
  return { provider, factory, args, escrow, organizer, sponsor, reporter, reviewer, settlement, players, spectator };
}

async function start(f, count = 3) {
  for (const player of f.players.slice(0, count)) {
    await sent(f.escrow.connect(player).join());
  }
  await sent(f.escrow.connect(f.sponsor).lockFunding(FUNDING));
  await sent(f.escrow.startEvent());
}

function podium(f, order = [0, 1, 2]) {
  return order.map((index) => f.players[index].address);
}

async function propose(f, count = 3) {
  await start(f, count);
  await sent(f.escrow.connect(f.reporter).postResult(podium(f), EVIDENCE));
  return f.escrow.challengeDeadline();
}

async function mineAt(provider, timestamp) {
  await provider.send('evm_setNextBlockTimestamp', [Number(timestamp)]);
  await provider.send('evm_mine', []);
  const block = await provider.send('eth_getBlockByNumber', ['latest', false]);
  assert.equal(BigInt(block.timestamp), timestamp);
}

async function assertCredits(escrow, { sponsor, reserved, awarded }) {
  const values = await Promise.all([escrow.sponsorCredits(), escrow.reservedCredits(), escrow.totalAwardedCredits()]);
  assert.deepEqual(values, [sponsor, reserved, awarded]);
  assert.equal(values.reduce((total, value) => total + value, 0n), POOL, 'total simulated credits must be conserved');
}

async function assertPodium(escrow, getter, expected) {
  const actual = await Promise.all([0, 1, 2].map((i) => escrow[getter](i)));
  assert.deepEqual(actual, expected);
}

test('deployment fixes the roles, rules, pool and challenge window', async (t) => {
  const f = await fixture(t);
  const { escrow, organizer, sponsor, reporter, reviewer, settlement } = f;
  assert.deepEqual(await Promise.all([
    escrow.organizer(), escrow.sponsor(), escrow.resultReporter(), escrow.reviewer(), escrow.receiptReporter(),
  ]), [organizer, sponsor, reporter, reviewer, settlement].map((role) => role.address));
  assert.equal(await escrow.rulesHash(), RULES);
  assert.equal(await escrow.prizePool(), POOL);
  assert.equal(await escrow.challengePeriod(), WINDOW);
  assert.equal(await escrow.phase(), Phase.Registration);
  await assertCredits(escrow, { sponsor: POOL, reserved: 0n, awarded: 0n });
});

test('deployment rejects overlapping roles, zero rules and indivisible pools', async (t) => {
  const { factory, args, organizer } = await fixture(t);
  for (const [index, value] of [[0, organizer.address], [3, ZeroAddress], [4, ZeroHash], [5, 3201n], [6, 0n]]) {
    const invalid = [...args];
    invalid[index] = value;
    await expectError(factory, 'InvalidConfiguration', () => factory.deploy(...invalid));
  }
});

test('registration is free and excludes duplicate entries and event roles', async (t) => {
  const { escrow, players, reviewer, provider } = await fixture(t);
  const player = players[0];
  await expectError(escrow, 'RoleCannotJoin', () => escrow.connect(reviewer).join.staticCall());
  await sent(escrow.connect(player).join());
  assert.equal(await escrow.isParticipant(player.address), true);
  assert.equal(await escrow.participantCount(), 1n);
  await expectError(escrow, 'AlreadyJoined', () => escrow.connect(player).join.staticCall());
  assert.equal(await provider.getBalance(await escrow.getAddress()), 0n);
  await assertCredits(escrow, { sponsor: POOL, reserved: 0n, awarded: 0n });
});

test('only the sponsor can reserve the pool once with a funding reference', async (t) => {
  const { escrow, sponsor } = await fixture(t);
  await expectError(escrow, 'Unauthorized', () => escrow.lockFunding.staticCall(FUNDING));
  await expectError(escrow, 'InvalidReference', () => escrow.connect(sponsor).lockFunding.staticCall(ZeroHash));
  await sent(escrow.connect(sponsor).lockFunding(FUNDING));
  assert.equal(await escrow.fundingReference(), FUNDING);
  await expectError(escrow, 'FundingAlreadyLocked', () => escrow.connect(sponsor).lockFunding.staticCall(FUNDING));
  await assertCredits(escrow, { sponsor: 0n, reserved: POOL, awarded: 0n });
});

test('only the organizer can start after funding and at least three entries', async (t) => {
  const { escrow, players, sponsor } = await fixture(t);
  await expectError(escrow, 'Unauthorized', () => escrow.connect(sponsor).startEvent.staticCall());
  await expectError(escrow, 'FundingNotLocked', () => escrow.startEvent.staticCall());
  await sent(escrow.connect(sponsor).lockFunding(FUNDING));
  for (const player of players.slice(0, 2)) await sent(escrow.connect(player).join());
  await expectError(escrow, 'NotEnoughParticipants', () => escrow.startEvent.staticCall());
  await sent(escrow.connect(players[2]).join());
  await sent(escrow.startEvent());
  assert.equal(await escrow.phase(), Phase.Active);
  await expectError(escrow, 'WrongPhase', () => escrow.connect(players[3]).join.staticCall());
});

test('only the result reporter can post a distinct registered podium with evidence', async (t) => {
  const f = await fixture(t);
  await start(f);
  const result = f.escrow.connect(f.reporter);
  await expectError(f.escrow, 'Unauthorized', () => f.escrow.postResult.staticCall(podium(f), EVIDENCE));
  await expectError(f.escrow, 'InvalidReference', () => result.postResult.staticCall(podium(f), ZeroHash));
  await expectError(f.escrow, 'InvalidPodium', () => result.postResult.staticCall(podium(f, [0, 1, 1]), EVIDENCE));
  await expectError(f.escrow, 'InvalidPodium', () => result.postResult.staticCall(podium(f, [0, 1, 3]), EVIDENCE));
  const receipt = await sent(result.postResult(podium(f), EVIDENCE));
  const block = await f.provider.send('eth_getBlockByNumber', [`0x${receipt.blockNumber.toString(16)}`, false]);
  assert.equal(await f.escrow.challengeDeadline(), BigInt(block.timestamp) + WINDOW);
  assert.equal(await f.escrow.evidenceHash(), EVIDENCE);
  assert.equal(await f.escrow.phase(), Phase.Proposed);
  await assertPodium(f.escrow, 'originalPodium', podium(f));
  await expectError(f.escrow, 'WrongPhase', () => result.postResult.staticCall(podium(f, [1, 0, 2]), EVIDENCE));
});

test('a challenge requires a registered player and a nonzero reference', async (t) => {
  const f = await fixture(t);
  await propose(f);
  await expectError(f.escrow, 'NotParticipant', () => f.escrow.connect(f.spectator).challenge.staticCall(CHALLENGE));
  await expectError(f.escrow, 'InvalidReference', () => f.escrow.connect(f.players[0]).challenge.staticCall(ZeroHash));
  await sent(f.escrow.connect(f.players[0]).challenge(CHALLENGE));
  assert.equal(await f.escrow.phase(), Phase.Challenged);
  assert.equal(await f.escrow.challenger(), f.players[0].address);
  assert.equal(await f.escrow.challengeHash(), CHALLENGE);
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.connect(f.players[1]).challenge.staticCall(CHALLENGE));
  await assertCredits(f.escrow, { sponsor: 0n, reserved: POOL, awarded: 0n });
});

test('the exact deadline closes challenges and permits finalization', async (t) => {
  const f = await fixture(t);
  const deadline = await propose(f);
  const player = f.escrow.connect(f.players[0]);
  await mineAt(f.provider, deadline - 1n);
  await player.challenge.staticCall(CHALLENGE);
  await expectError(f.escrow, 'ChallengeWindowOpen', () => f.escrow.finalizeAwards.staticCall());
  await mineAt(f.provider, deadline);
  await expectError(f.escrow, 'ChallengeWindowClosed', () => player.challenge.staticCall(CHALLENGE));
  await f.escrow.finalizeAwards.staticCall();
  await sent(f.escrow.connect(f.spectator).finalizeAwards());
  assert.equal(await f.escrow.phase(), Phase.Finalized);
});

test('an open dispute freezes awards and only the reviewer may correct the ranking', async (t) => {
  const f = await fixture(t);
  const deadline = await propose(f, 4);
  const corrected = podium(f, [1, 0, 3]);
  await sent(f.escrow.connect(f.players[3]).challenge(CHALLENGE));
  await mineAt(f.provider, deadline);
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.finalizeAwards.staticCall());
  await expectError(f.escrow, 'Unauthorized', () => f.escrow.connect(f.reporter).resolveChallenge.staticCall(corrected, DECISION));
  const review = f.escrow.connect(f.reviewer);
  await expectError(f.escrow, 'InvalidPodium', () => review.resolveChallenge.staticCall(podium(f, [1, 1, 3]), DECISION));
  await sent(review.resolveChallenge(corrected, DECISION));
  assert.equal(await f.escrow.phase(), Phase.Reviewed);
  assert.equal(await f.escrow.decisionHash(), DECISION);
  assert.equal(await f.escrow.evidenceHash(), EVIDENCE);
  await assertPodium(f.escrow, 'originalPodium', podium(f));
  await assertPodium(f.escrow, 'awardPodium', corrected);
  await sent(f.escrow.finalizeAwards());
  assert.deepEqual(await Promise.all(f.players.map((p) => f.escrow.awardCredits(p.address))), [960n, 1600n, 0n, 640n]);
  await assertCredits(f.escrow, { sponsor: 0n, reserved: 0n, awarded: POOL });
});

test('an early review does not bypass the original challenge deadline', async (t) => {
  const f = await fixture(t);
  const deadline = await propose(f);
  await sent(f.escrow.connect(f.players[0]).challenge(CHALLENGE));
  await sent(f.escrow.connect(f.reviewer).resolveChallenge(podium(f), DECISION));
  assert.equal(await f.escrow.challengeDeadline(), deadline);
  await expectError(f.escrow, 'ChallengeWindowOpen', () => f.escrow.finalizeAwards.staticCall());
  await mineAt(f.provider, deadline);
  await sent(f.escrow.finalizeAwards());
  assert.equal(await f.escrow.phase(), Phase.Finalized);
});

test('uncontested awards distribute the entire pool once without holding Ether', async (t) => {
  const f = await fixture(t);
  const deadline = await propose(f, 4);
  await mineAt(f.provider, deadline);
  await sent(f.escrow.finalizeAwards());
  assert.deepEqual(await Promise.all(f.players.map((p) => f.escrow.awardCredits(p.address))), [1600n, 960n, 640n, 0n]);
  await assertCredits(f.escrow, { sponsor: 0n, reserved: 0n, awarded: POOL });
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.finalizeAwards.staticCall());
  assert.equal(await f.provider.getBalance(await f.escrow.getAddress()), 0n);
});

test('only the settlement reporter can record a nonzero receipt after awards', async (t) => {
  const f = await fixture(t);
  const deadline = await propose(f);
  const settlement = f.escrow.connect(f.settlement);
  await expectError(f.escrow, 'WrongPhase', () => settlement.recordSettlement.staticCall(RECEIPT));
  await mineAt(f.provider, deadline);
  await sent(f.escrow.finalizeAwards());
  await expectError(f.escrow, 'Unauthorized', () => f.escrow.recordSettlement.staticCall(RECEIPT));
  await expectError(f.escrow, 'InvalidReference', () => settlement.recordSettlement.staticCall(ZeroHash));
  await sent(settlement.recordSettlement(RECEIPT));
  assert.equal(await f.escrow.receiptHash(), RECEIPT);
  assert.equal(await f.escrow.phase(), Phase.Settled);
  await expectError(f.escrow, 'WrongPhase', () => settlement.recordSettlement.staticCall(id('second receipt')));
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.cancelEvent.staticCall(CANCELLATION));
  await assertCredits(f.escrow, { sponsor: 0n, reserved: 0n, awarded: POOL });
});

test('the organizer may cancel registration and return the reserve only once', async (t) => {
  const { escrow, sponsor, reviewer, players } = await fixture(t);
  await sent(escrow.connect(sponsor).lockFunding(FUNDING));
  await expectError(escrow, 'Unauthorized', () => escrow.connect(reviewer).cancelEvent.staticCall(CANCELLATION));
  await expectError(escrow, 'InvalidReference', () => escrow.cancelEvent.staticCall(ZeroHash));
  await sent(escrow.cancelEvent(CANCELLATION));
  assert.equal(await escrow.phase(), Phase.Cancelled);
  await assertCredits(escrow, { sponsor: POOL, reserved: 0n, awarded: 0n });
  await expectError(escrow, 'WrongPhase', () => escrow.cancelEvent.staticCall(CANCELLATION));
  await expectError(escrow, 'WrongPhase', () => escrow.connect(players[0]).join.staticCall());
  await expectError(escrow, 'WrongPhase', () => escrow.connect(sponsor).lockFunding.staticCall(FUNDING));
});

test('only the reviewer can cancel an active event before a result is posted', async (t) => {
  const f = await fixture(t);
  await start(f);
  await expectError(f.escrow, 'Unauthorized', () => f.escrow.cancelEvent.staticCall(CANCELLATION));
  await sent(f.escrow.connect(f.reviewer).cancelEvent(CANCELLATION));
  assert.equal(await f.escrow.phase(), Phase.Cancelled);
  await assertCredits(f.escrow, { sponsor: POOL, reserved: 0n, awarded: 0n });
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.connect(f.reporter).postResult.staticCall(podium(f), EVIDENCE));
});

test('cancelling a disputed event restores the sponsor balance and prevents awards', async (t) => {
  const f = await fixture(t);
  await propose(f);
  await sent(f.escrow.connect(f.players[0]).challenge(CHALLENGE));
  await sent(f.escrow.connect(f.reviewer).cancelEvent(CANCELLATION));
  assert.equal(await f.escrow.phase(), Phase.Cancelled);
  await assertCredits(f.escrow, { sponsor: POOL, reserved: 0n, awarded: 0n });
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.finalizeAwards.staticCall());
  await expectError(f.escrow, 'WrongPhase', () => f.escrow.connect(f.reviewer).resolveChallenge.staticCall(podium(f), DECISION));
});
