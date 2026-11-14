Educational project for the course Introduction to Finance. Not a real product, service or investment offer. Do not use with real funds.

# Web3 Esports Trust Protocol — Local Prototype

A smart contract prototype (`TournamentEscrow.sol`) for transparent amateur esports tournaments and automated prize allocation. Developed by **Team Black Rock** (Astana IT University, 2026–2027) for the *Introduction to Finance* Final Project.

**Demo video:** <https://youtu.be/UfVRil41gu4>

---

## Overview & Core Features

`TournamentEscrow` governs the lifecycle of a sponsor-funded, free-entry esports event on a local development blockchain (Hardhat Network, Chain ID `31337`) using valueless test credits:

* **Role Separation:** Enforces five distinct roles set at deployment (`organizer`, `sponsor`, `resultReporter`, `reviewer`, `settlementReporter`) with no overlapping privileges.
* **Fixed Rules & Funding:** Locks the 50% / 30% / 20% podium prize split, challenge window duration, and sponsor's test credit reserve before the tournament starts.
* **Free Player Registration:** Allows players to join without entry fees and prevents duplicate registrations or role conflicts.
* **Dispute Freeze & Independent Review:** After the result reporter submits a ranking and off-chain evidence hash, any registered player can open a challenge before the deadline. An open dispute freezes prize allocation until the independent reviewer confirms or corrects the ranking (while preserving the original report on-chain).
* **Single Allocation & Cancellation:** Allocates the full prize pool once after the challenge deadline passes, supports mock settlement receipts, and allows controlled cancellation with full reserve restoration prior to result submission.

---

## Project Structure

* `contracts/TournamentEscrow.sol` — Main Solidity (`0.8.30`) smart contract implementing tournament rules, challenge freeze, and prize allocation.
* `scripts/demo.mjs` — End-to-end local simulation script demonstrating deployment, player registration, funding, result submission, dispute resolution, time advancement, prize distribution (`5,000 / 3,000 / 2,000`), and mock settlement receipt.
* `test/tournament-escrow.test.mjs` — Automated test suite containing 15 unit tests covering access control, deadlines, disputes, payouts, and cancellations.
* `tooling/` — Local Hardhat 3 network setup, compiler, and environment check scripts.

---

## Prerequisites & Local Setup

* **Node.js:** v24 LTS (tested on Node.js `24.22.1`)
* **Hardhat:** `3.21.2` / Solidity `0.8.30`

1. **Install dependencies:**
   ```bash
   npm ci --ignore-scripts
