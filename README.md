# Digital Wallet & Double-Entry Ledger Engine

A fintech-style backend where every money movement is represented as matched **debit and credit** ledger entries. Balances are never stored or edited directly — they are always _derived_ from the ledger at read time.

Built with NestJS, TypeScript, PostgreSQL, and TypeORM.

---

## Table of contents

- [Why this project exists](#why-this-project-exists)
- [The ledger model](#the-ledger-model)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Creating the first Admin](#creating-the-first-admin)
- [API overview](#api-overview)
- [Core flows, in detail](#core-flows-in-detail)
- [Security](#security)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [What's deliberately out of scope](#whats-deliberately-out-of-scope)

---

## Why this project exists

CRUD APIs are easy to get right. Money-shaped data is not — a wallet backend has to survive concurrent requests, network retries, partial failures, and the occasional direct database tampering, without ever losing track of a single cent. This project is a deliberately strict implementation of the patterns real financial systems use to guarantee that:

- **Correctness** — the books always balance, enforced by the database itself, not just application code.
- **Idempotency** — a retried request never double-charges or double-credits.
- **Concurrency safety** — simultaneous transfers on the same wallet never race past each other.
- **Auditability** — nothing is ever deleted or silently edited; corrections are new, linked records.

## The ledger model

> **The single most important rule in this codebase: a wallet's balance is never stored. It is always computed as `SUM(credits) − SUM(debits)` from the `ledger_entries` table.**

Every money movement — a deposit, a transfer, a withdrawal, a refund — is one `transactions` row plus exactly two `ledger_entries` rows: one `DEBIT`, one `CREDIT`, for the same amount. A transfer from wallet A to wallet B is a debit on A and a credit on B. A deposit is a debit on the platform's own system cash wallet and a credit on the user's wallet — every transaction nets to zero, even ones that look "one-sided" from a user's point of view.

```
transactions                ledger_entries
─────────────               ──────────────
id                           id
type (DEPOSIT/TRANSFER/...)  transaction_id ──┐
status                       wallet_id        │  always exactly 2 rows
reverses_transaction_id      direction (DEBIT/CREDIT)
initiated_by                 amount (bigint, minor units)
metadata (jsonb)             currency
```

### What the database enforces, not just the application

The correctness guarantees in this project live in PostgreSQL constraints and triggers — not only in TypeScript — because application code can have bugs, but a `CHECK` constraint or a trigger cannot be silently skipped by a mistake three layers up the call stack.

| Guarantee                                                            | Enforced by                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Ledger entries are **append-only**                                   | `BEFORE UPDATE OR DELETE` trigger that raises an exception on any attempt to modify or delete a row |
| Every transaction's debits equal its credits                         | A `DEFERRABLE INITIALLY DEFERRED` constraint trigger, checked at `COMMIT`, not per-row              |
| Amounts are always positive                                          | `CHECK (amount > 0)` — direction carries the sign, not the number                                   |
| A ledger entry's currency matches its wallet's currency              | A composite foreign key `(wallet_id, currency) → wallets(id, currency)`                             |
| A transaction can be reversed at most once                           | `UNIQUE (reverses_transaction_id)`                                                                  |
| A wallet is either user-owned or a system wallet, never both/neither | `CHECK ((user_id IS NOT NULL) <> (system_code IS NOT NULL))`                                        |

Balances are exposed through a SQL view (`wallet_balances`) for ad-hoc inspection, and recomputed via query in the application for the actual API responses.

### Money is represented as integers

All amounts are `bigint` **minor units** (cents) — never floats, never a `decimal` with rounding ambiguity. `$10.00` is the integer `1000`. Because JavaScript's `JSON.stringify` cannot serialize a native `bigint`, every amount that leaves the API is converted to a `string` in the response body (e.g. `"balance": "1000"`), and converted back with `BigInt(...)` on input.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HTTP Layer (Nest)                       │
│  helmet · CORS allowlist · rate limiting · global exception      │
│  filter · ValidationPipe · JwtAuthGuard · RolesGuard             │
└───────────────────────────────┬───────────────────────────────┘
                                 │
        ┌────────────┬──────────┼──────────┬─────────────┐
        ▼            ▼          ▼          ▼             ▼
    Auth/Users   Wallets   Transactions  Webhooks      Refunds
   (JWT+refresh  (CRUD,    (deposit,     (HMAC+replay  (Admin-only
    rotation,     balance   transfer,     protection)   reversal)
    Argon2id)     reads)    withdraw)
        │            │          │          │             │
        └────────────┴──────────┼──────────┴─────────────┘
                                 ▼
                          LedgerService
              (the ONLY code path that writes to
               ledger_entries / transactions)
                                 │
                                 ▼
                      PostgreSQL (TypeORM)
          append-only triggers · balanced-transaction
          constraint trigger · composite currency FK
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                      ▼
      ReconciliationCron                        AuditService
   (nightly + on-demand:                    (admin_actions table,
    SUM(debits) = SUM(credits)               append-only, records
    globally AND per-transaction)            who did what privileged
                                              action, from where)
```

Supporting modules: `IdempotencyModule` (guards every mutating endpoint), `SupportModule` (read-only cross-user investigation for Support/Admin).

## Tech stack

| Concern          | Choice                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Framework        | NestJS + TypeScript                                                    |
| Database         | PostgreSQL (non-negotiable — ACID, FKs, constraints, row locking)      |
| ORM              | TypeORM (migrations hand-written where constraints/triggers matter)    |
| Auth             | JWT access tokens (15 min) + opaque, rotating refresh tokens (30 days) |
| Password hashing | Argon2id                                                               |
| Testing          | Jest + Supertest                                                       |
| Rate limiting    | `@nestjs/throttler`                                                    |
| Security headers | `helmet`                                                               |

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env
# edit .env — see "Environment variables" below

# 3. Create the database and run migrations
createdb wallet_ledger
npm run migration:run

# 4. Start the dev server
npm run start:dev
```

The API is served under the `/api/v1` prefix, e.g. `http://localhost:3000/api/v1/auth/register`.

## Environment variables

| Variable                 | Required | Notes                                                                       |
| ------------------------ | -------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`           | yes      | PostgreSQL connection string                                                |
| `DB_SCHEMA`              | yes      | Postgres schema name (migrations are schema-qualified)                      |
| `JWT_ACCESS_SECRET`      | yes      | ≥ 32 characters                                                             |
| `JWT_ACCESS_EXPIRY`      | no       | default `15m`                                                               |
| `PAYMENT_WEBHOOK_SECRET` | yes      | ≥ 32 characters — shared secret for HMAC webhook verification               |
| `CORS_ORIGINS`           | no       | comma-separated browser origin allowlist; empty = no browser origin allowed |
| `PORT`                   | no       | default `3000`                                                              |
| `NODE_ENV`               | no       | `development` \| `test` \| `production`                                     |

**The app validates every required variable at the very top of `main.ts`, before any module is instantiated.** A missing or malformed value (e.g. a secret under 32 characters) crashes startup immediately with a readable error, rather than letting the app start and fail confusingly on the first request that needs it.

## Creating the first Admin

Every Support or Admin account after the first is created through `POST /users/staff`, which is itself Admin-only — a deliberate chicken-and-egg problem on a fresh deployment, since there's no Admin yet to call it. The very first Admin is created with a standalone script that writes directly to the database, bypassing the HTTP API entirely:

```bash
npm run create-admin -- --email admin@example.com --password "a-strong-password-here" --name "Platform Admin"
```

Safe to re-run: if the email already exists, it reports that and exits without changing anything, unless you explicitly pass `--promote` to elevate an existing account.

## API overview

All routes are prefixed with `/api/v1`. Every route requires a valid JWT access token (`Authorization: Bearer <token>`) **except** those marked `public` below.

| Area           | Method & path                                                                                                       | Role                    | Idempotency-Key?          |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------- |
| Auth           | `POST /auth/register`                                                                                               | public                  | –                         |
|                | `POST /auth/login`                                                                                                  | public                  | –                         |
|                | `POST /auth/refresh`                                                                                                | public (refresh token)  | –                         |
|                | `POST /auth/logout`, `/auth/logout-all`                                                                             | any                     | –                         |
| Users          | `GET /users/me`                                                                                                     | any                     | –                         |
|                | `GET /users`                                                                                                        | Support, Admin          | –                         |
|                | `PATCH /users/:id/disabled`                                                                                         | Admin                   | –                         |
|                | `POST /users/staff`                                                                                                 | Admin                   | –                         |
| Wallets        | `POST /wallets`                                                                                                     | any                     | **required**              |
|                | `GET /wallets`, `/wallets/:id`, `/wallets/:id/balance`                                                              | owner / Support / Admin | –                         |
| Transactions   | `POST /transactions/deposit`                                                                                        | owner                   | **required**              |
|                | `POST /transactions/transfer`                                                                                       | owner                   | **required**              |
|                | `POST /transactions/withdraw`                                                                                       | owner                   | **required**              |
| Webhooks       | `POST /webhooks/payment-provider`                                                                                   | public (HMAC-signed)    | n/a — own dedup mechanism |
| Refunds        | `POST /refunds`                                                                                                     | Admin                   | **required**              |
| Reconciliation | `POST /reconciliation/run`                                                                                          | Admin                   | –                         |
|                | `GET /reconciliation/runs`                                                                                          | Support, Admin          | –                         |
| Support        | `GET /support/users/:id`, `/support/users/:id/wallets`, `/support/wallets/:id/history`, `/support/transactions/:id` | Support, Admin          | –                         |
| Audit          | `GET /audit/actions`                                                                                                | Admin                   | –                         |

## Core flows, in detail

### Deposit

A deposit debits the platform's system cash wallet and credits the user's wallet — even a "simple" deposit is a real double-entry transaction, never a one-sided balance bump. The system wallet is explicitly exempt from the overdraft check, since it represents what the platform owes users, not a spendable balance it can run out of.

### Transfer, and row-level locking

A transfer locks both wallets with `SELECT ... FOR UPDATE` before reading balances or writing entries. Both wallets are always locked **in a fixed order — sorted by wallet ID, ascending** — regardless of which is the sender and which is the receiver. This is the standard fix for the classic transfer deadlock: without a fixed order, a transfer A→B running concurrently with a transfer B→A could each hold one lock while waiting on the other, forever. The `concurrent-transfer.e2e-spec.ts` test specifically exercises this — 30 simultaneous transfers in both directions between the same two wallets, asserting that none deadlock and the final balances are exactly correct.

### Withdrawal — the PENDING → POSTED/FAILED flow

Not every transaction can be synchronous. A withdrawal calls an external payout processor (mocked here), which takes time and can fail for reasons outside this system's control. The flow is three steps:

1. **Lock the wallet, check funds, create a `PENDING` transaction** — no ledger entries yet — in its own short database transaction that commits immediately and releases the lock.
2. **Call the external processor with no lock held.** Holding a row lock across a slow external call would block every other operation on that wallet for the duration.
3. **Re-acquire the lock and resolve the transaction**: on success, post the real debit/credit entries and flip the transaction to `POSTED`; on failure, mark it `FAILED` and **never write any ledger entries** — a failed transaction, by definition, moved no money.

A transaction can only be resolved once — a row-level lock on the `PENDING` transaction itself prevents a duplicate callback from posting entries twice or both posting and failing the same transaction.

### Idempotency

Every mutating endpoint requires an `Idempotency-Key` header. The first request with a given key is processed and its response stored; any later request with the _same_ key and the _same_ body replays the stored response verbatim rather than re-running the handler. The same key with a _different_ body is rejected (`409`) — reuse-with-different-body is a client bug, not something to silently allow.

The atomicity comes from a unique constraint on `(user_id, key)`: two truly concurrent requests with the same key both try to `INSERT` a `PENDING` claim row; the database's constraint — not a `findOne` check beforehand — decides which one wins.

### Webhooks: HMAC verification with replay protection

The mock payment provider signs each webhook with `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`. Binding the timestamp _into_ the signed payload (not just checking it as a separate field) is what makes this actual replay protection: an attacker who captured a previously-valid request can't simply swap in a fresh timestamp, because that invalidates the signature. Requests outside a 5-minute tolerance window are rejected regardless of signature validity.

Verification runs against the **raw request bytes**, captured by a dedicated middleware before Nest's JSON body parser touches the stream — verifying against a re-serialized object is a common mistake that silently breaks on whitespace or key-order differences from what the provider actually signed.

A separate `webhook_events` table dedupes on `(provider, provider_event_id)` — distinct from the `Idempotency-Key` mechanism, because a webhook has no authenticated user and no client-chosen key; the provider's own event ID is the only available identity.

### Refunds / reversals

A refund never edits or deletes the original transaction. It reads the original transaction's two ledger entries, and posts a **new** transaction with debit and credit flipped — same amount, opposite direction, permanently linked via `reverses_transaction_id`. History is only ever appended to. A transaction can be reversed at most once (enforced by both the application and a database `UNIQUE` constraint), and a `REVERSAL` transaction cannot itself be reversed.

### Reconciliation

Two independent checks, run nightly via cron and available on-demand (`POST /reconciliation/run`):

1. **Global** — `SUM(all debits) = SUM(all credits)` across the entire ledger.
2. **Per-transaction** — every individual transaction's debits equal its own credits.

Check #2 might look redundant with the database's own balanced-transaction trigger — and it is, deliberately. The trigger guarantees this for anything written through the normal application transaction boundary; the reconciliation job re-checks it independently as a backstop against the trigger having been bypassed entirely (direct database access, a bad manual migration). If reconciliation ever finds a discrepancy, it means a database-level guarantee was circumvented, not that application logic has a bug — a meaningfully different and more serious class of finding. Every run, clean or not, is recorded — an unbroken history of `CLEAN` runs is itself the evidence that the ledger has stayed correct over time.

### Audit log

`admin_actions` is a second, append-only table (same enforcement pattern as the ledger) that records every privileged action: refunds issued, users disabled/enabled, staff accounts created, manual reconciliation triggers — who did it, from what IP, with structured details. It's deliberately separate from the ledger: the ledger is the _financial_ record of what moved; `admin_actions` is the _accountability_ record of who authorized it. Where an action also produces a ledger entry (a refund), the audit row is written inside the _same_ database transaction, so the two can never disagree about whether something actually happened.

## Security

- **Argon2id** password hashing; opaque, rotating refresh tokens (only an argon2 hash of each token is stored — a leaked database dump doesn't hand out usable sessions). Token-reuse detection revokes an entire session family if a rotated token is replayed.
- **RBAC**: Customer / Support / Admin, enforced by a global guard — every route requires authentication by default; `@Public()` opts a route out explicitly.
- **Rate limiting**: a global default (100 req/min/IP) plus a stricter limit on `/auth/login` and `/auth/register` (5 req/min/IP) to slow credential-stuffing.
- **`helmet`** for standard security headers; explicit **CORS allowlist** (never a wildcard); **1 MB request body limit**.
- **Env validation at boot** — the app refuses to start with a missing or malformed secret, rather than running insecurely.
- **A global exception filter** ensures no unhandled error ever leaks an internal message or stack trace to a client.

## Testing

```bash
npm test          # unit tests — fast, no database required
npm run test:e2e  # integration tests — requires a real, dedicated test database
```

**Unit tests** (`test/ledger.service.spec.ts`) exercise `LedgerService`'s own decision logic — overdraft rejection, currency mismatch, the system-wallet overdraft exemption — against a hand-built in-memory fake of TypeORM's `EntityManager`, with no database involved.

**Integration tests** run the full application against a real PostgreSQL database:

- `test/idempotency.e2e-spec.ts` — proves a replayed key returns the identical stored response without moving money twice, that key reuse with a different body is rejected, and that two truly concurrent requests with the same key still only process once.
- `test/concurrent-transfer.e2e-spec.ts` — the most important test in the project. Fires 10 concurrent transfers against a wallet funded for exactly 5 of them, and asserts **exactly** 5 succeed and 5 are rejected — not "approximately," a precise count, which is what actually proves the row-level locking prevents a lost-update race. A second test fires 30 simultaneous transfers in both directions between the same two wallets specifically to exercise the deadlock-avoidance ordering.

Set up a dedicated test database before running `test:e2e` — never point it at development or production data, since these tests create real users, wallets, and transactions with no cleanup:

```bash
createdb wallet_ledger_test
DATABASE_URL="postgresql://.../wallet_ledger_test" npm run migration:run
DATABASE_URL="postgresql://.../wallet_ledger_test" npm run test:e2e
```

## Project structure

```
src/
├── auth/              JWT + refresh token rotation, Argon2id
├── users/             User CRUD, staff account creation
├── wallets/            Wallet creation, balance reads
├── ledger/             LedgerService — the only writer to the ledger
├── transactions/       Deposit, transfer, withdraw orchestration
├── idempotency/        Idempotency-Key claim/replay interceptor
├── webhooks/            HMAC-verified, replay-protected payment webhook
├── refunds/             Admin reversal flow
├── reconciliation/      Nightly + on-demand ledger balance checks
├── support/             Read-only cross-user investigation (Support/Admin)
├── audit/                Append-only privileged-action log
├── database/
│   ├── entities/        Wallet, Transaction, LedgerEntry
│   └── migrations/      Hand-written SQL for constraints/triggers
├── scripts/
│   └── create-admin.ts  Standalone first-Admin bootstrap script
└── common/               Guards, decorators, enums, filters

test/
├── ledger.service.spec.ts           unit tests
├── idempotency.e2e-spec.ts          integration test
├── concurrent-transfer.e2e-spec.ts  integration test
└── utils/test-app.ts                shared e2e test helpers
```

## Design decisions worth knowing

A few choices in this codebase are deliberate trade-offs, not oversights — worth being able to explain if asked:

- **No balance column, ever.** Every balance is `SUM(credits) − SUM(debits)`, computed at read time. Slower than a cached column, but it's structurally impossible for a balance to drift from what the ledger actually says.
- **System wallets are exempt from the overdraft check** (platform cash can go negative — it represents what's owed to users, not a spendable float), but **user wallets are never exempt**, with one deliberate exception: an Admin refund can push a user wallet negative, because the money it's clawing back is already gone. That's a real debt, not a bug — a production system would need a separate collections flow for it, which is out of scope here.
- **Idempotency and webhook deduplication are two different mechanisms**, not one reused for both: `Idempotency-Key` is keyed by `(authenticated user, client-chosen key)`; webhook dedup is keyed by `(provider, provider's own event ID)`, because a webhook has no logged-in user and the provider — not the client — controls the identifier.
- **The database enforces correctness independently of the application.** Every guarantee described in [The ledger model](#the-ledger-model) would hold even if a future version of the application code had a bug — that's the point of putting it in triggers and constraints rather than only in TypeScript.

## What's deliberately out of scope

- **Multi-currency FX conversion.** Currencies are supported as isolated silos (each needs its own seeded platform wallet); no conversion between them.
- **A sweep job for stuck `PENDING` withdrawals.** If the process crashes between creating a `PENDING` transaction and resolving it, that transaction stays `PENDING` until manually investigated. A production system needs a periodic job to re-check or time out stale `PENDING` transactions — flagged here, not built.
- **Real payment provider integration.** The webhook is a mock; real providers (Stripe, Razorpay) have their own SDKs for HMAC verification and their own signature header formats, which this project approximates rather than integrates.
