Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# Web3 Esports Trust Protocol

This prototype shows how to record the result of one esports tournament, review a challenge, and divide a prize pool. Entry is free. The sponsor reserves **simulated credits** before the event. The final ranking gives the first three players 50%, 30%, and 20% of the pool. The credits cannot be bought, transferred, or withdrawn.

The prototype uses a temporary local Hardhat 3 network. It does not connect to an esports server, an anti-cheat system, or a payment provider. All accounts and evidence in the demo are synthetic.

## Run locally

Use Node.js 24 and npm. From the project directory, run:

```sh
npm ci --ignore-scripts
npm run check:local
npm test
npm run demo
```

`npm ci` installs the locked dependencies. The build uses the compiler installed with those dependencies. `npm run build` builds the contract by itself; the test and demo commands also build it. They start their own temporary local networks; there is no separate node to start. No wallet, API token, or private key is needed.

On Windows PowerShell, use `npm.cmd` in place of `npm` if the PowerShell script is blocked.

## Roles and decisions

| Role | Responsibility |
|---|---|
| Organiser | Deploys the tournament with fixed rules and starts it after the sponsor reserves the pool and at least three players join. |
| Sponsor | Reserves the simulated pool. Players never pay to join. |
| Result reporter | Submits three distinct registered players in ranking order and a hash of the result evidence. |
| Player | Joins before the event and may challenge a reported result before the deadline. |
| Reviewer | Checks the challenge and records a decision, with the same or a corrected ranking. The original result stays in the record. |
| Receipt reporter | Records one simulated receipt after awards have been finalised. |

The five administrative accounts are separate. This is a local demonstration of roles, not proof that independent organisations control those roles in a real deployment.

## Tournament flow

1. **Registration:** Players join for free. The sponsor moves the simulated pool from its available credits to reserved credits.
2. **Active:** The organiser starts the event. The result reporter submits a ranking and its evidence hash.
3. **Proposed:** The challenge window begins. Without a challenge, awards can be finalised when the window ends.
4. **Challenged:** Finalisation is blocked. The reviewer can confirm or correct the ranking. The challenge and decision have separate references.
5. **Reviewed:** Finalisation remains blocked until the original deadline. This small prototype handles one challenge per tournament.
6. **Finalized:** The reserved pool is allocated once in the 50/30/20 split. Any account may trigger this step once the state and deadline allow it. It is not triggered by the clock alone.
7. **Settled:** The receipt reporter records a simulated settlement receipt. This does not move funds.

The organiser can cancel during registration. The reviewer can cancel an active event or one under challenge. Cancellation returns the reserved credits to the sponsor and prevents awards. The sum of available sponsor credits, reserved credits, and allocated awards is always the original simulated pool. The pool size is a multiple of ten so the split has no rounding remainder.

## What the code demonstrates

- `contracts/TournamentEscrow.sol` keeps the rules reference, roles, tournament state, and credit balances.
- `test/tournament-escrow.test.mjs` checks the normal flow and cases the contract must reject, including early finalisation and repeated settlement.
- `scripts/demo.mjs` runs a complete local example with four players. It shows the first ranking, the challenge, the corrected ranking, the split, and the simulated receipt.

The design follows the final report's free-entry model and keeps funding, approval, and settlement separate. A hash can help check whether a known record changed; it cannot show that the record was true. The contract does not detect cheating. The demo uses local chain ID 31337. It does not implement the report's proposed independent Besu validators or a real payment connection, and it has not been audited for production.

## Prepare a short recording

Demo video: https://youtu.be/UfVRil41gu4

For a video of up to three minutes, start with `npm run demo` and show the deployment, reserved pool, result hash, challenge, corrected ranking, final awards, and receipt. Explain that the demo advances the local clock to the challenge deadline. Run `npm test` and show the summary. Keep the recording on the demo terminal and do not show private information or credentials.

The recorded local output is in [verification.txt](verification.txt).

## Dependencies and preparation

The project uses [Hardhat](https://hardhat.org/), [ethers](https://docs.ethers.org/v6/) and [solc-js](https://github.com/ethereum/solc-js), installed from npm at the versions in the lockfile. The npm packages declare MIT licences. No dependency source or generated build files are included in this project archive.

ChatGPT (gpt-6.1-sol) assisted with drafting the contract, tests, demo and documentation. Team members should review their changes and be able to explain them before submitting the project.
