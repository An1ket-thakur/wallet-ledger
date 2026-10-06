/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  registerUser,
  createWallet,
  deposit,
  getBalance,
  TestUser,
} from './utils/test-app';

/**
 * The portfolio-plus item from the project spec: "Integration test that
 * fires concurrent transfer requests." This is the single most convincing
 * test in the whole project - it proves the fixed-order wallet locking in
 * TransactionsService actually prevents lost updates/deadlocks under real
 * concurrent load, rather than just looking correct by inspection.
 */
describe('Concurrent transfers (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function transfer(
    user: TestUser,
    fromWalletId: string,
    toWalletId: string,
    amount: number,
    idempotencyKey: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/transactions/transfer')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ fromWalletId, toWalletId, amount });
  }

  it('many concurrent transfers out of ONE wallet never push its balance negative', async () => {
    const user = await registerUser(app);
    const sourceWallet = await createWallet(app, user.accessToken);
    const destWallet = await createWallet(app, user.accessToken);

    // Fund the source with exactly enough for 5 of the 10 attempted transfers.
    await deposit(
      app,
      user.accessToken,
      sourceWallet,
      5000,
      `seed-${Date.now()}`,
    ).expect(201);

    const TRANSFER_AMOUNT = 1000;
    const ATTEMPTS = 10; // only 5 of these can possibly succeed given a 5000 balance

    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        transfer(
          user,
          sourceWallet,
          destWallet,
          TRANSFER_AMOUNT,
          `concurrent-${Date.now()}-${i}`,
        ),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 400);

    // The critical assertion: exactly 5 succeed, exactly 5 fail with
    // insufficient funds. If locking were broken, you'd see MORE than 5
    // succeed (a lost-update race letting the balance go negative) or an
    // inconsistent/flaky count across runs.
    expect(succeeded.length).toBe(5);
    expect(rejected.length).toBe(5);

    const sourceBalance = await getBalance(app, user.accessToken, sourceWallet);
    const destBalance = await getBalance(app, user.accessToken, destWallet);

    expect(sourceBalance).toBe(0n);
    expect(destBalance).toBe(5000n);
    // Conservation check: nothing was created or destroyed, only moved.
    expect(sourceBalance + destBalance).toBe(5000n);
  });

  it('opposite-direction concurrent transfers between the same wallet pair do not deadlock', async () => {
    const userA = await registerUser(app);
    const userB = await registerUser(app);
    const walletA = await createWallet(app, userA.accessToken);
    const walletB = await createWallet(app, userB.accessToken);

    await deposit(
      app,
      userA.accessToken,
      walletA,
      10_000,
      `seed-a-${Date.now()}`,
    ).expect(201);
    await deposit(
      app,
      userB.accessToken,
      walletB,
      10_000,
      `seed-b-${Date.now()}`,
    ).expect(201);

    // This is exactly the scenario that deadlocks without fixed-order
    // locking: A->B and B->A firing at the same time, each potentially
    // trying to lock the same two rows in opposite orders. If
    // TransactionsService didn't sort wallet ids before locking, this test
    // would hang or one request would error out with a Postgres deadlock
    // error instead of resolving cleanly.
    const ROUNDS = 15;
    const requests = Array.from({ length: ROUNDS }, (_, i) => [
      transfer(userA, walletA, walletB, 100, `a-to-b-${Date.now()}-${i}`),
      transfer(userB, walletB, walletA, 100, `b-to-a-${Date.now()}-${i}`),
    ]).flat();

    const results = await Promise.all(requests);

    // Every single one should resolve to a definite HTTP response (success
    // or a clean business-logic rejection) - none should time out, and none
    // should surface a raw Postgres deadlock error (which would show up as
    // a 500).
    for (const r of results) {
      expect([201, 400]).toContain(r.status);
    }

    const balanceA = await getBalance(app, userA.accessToken, walletA);
    const balanceB = await getBalance(app, userB.accessToken, walletB);

    // Since both sides transferred the same amount the same number of times
    // (15 rounds x 100 each way), net movement is zero - both wallets should
    // be back at their starting balance.
    expect(balanceA).toBe(10_000n);
    expect(balanceB).toBe(10_000n);
  });
});
