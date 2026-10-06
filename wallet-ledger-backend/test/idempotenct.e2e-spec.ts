/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  registerUser,
  createWallet,
  deposit,
  getBalance,
} from './utils/test-app';

/**
 * Proves the Idempotency-Key mechanism actually prevents double-processing,
 * not just that the header is accepted. This is the test a resume bullet
 * claiming "idempotent deposits" needs to be backed by.
 */
describe('Idempotency (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('replays the exact same response and does not double-credit on a repeated key', async () => {
    const user = await registerUser(app);
    const walletId = await createWallet(app, user.accessToken);
    const idempotencyKey = `dep-${Date.now()}-${Math.random()}`;

    const first = await deposit(
      app,
      user.accessToken,
      walletId,
      5000,
      idempotencyKey,
    );
    expect(first.status).toBe(201);
    expect(first.body.balanceAfter).toBe('5000');

    const second = await deposit(
      app,
      user.accessToken,
      walletId,
      5000,
      idempotencyKey,
    );
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    // Must be byte-for-byte the same stored response, not a freshly computed one.
    expect(second.body).toEqual(first.body);

    const balance = await getBalance(app, user.accessToken, walletId);
    expect(balance).toBe(5000n); // NOT 10000n - the second request must not have moved money again
  });

  it('rejects reuse of the same key with a different request body', async () => {
    const user = await registerUser(app);
    const walletId = await createWallet(app, user.accessToken);
    const idempotencyKey = `dep-${Date.now()}-${Math.random()}`;

    await deposit(app, user.accessToken, walletId, 1000, idempotencyKey).expect(
      201,
    );

    // Same key, different amount - must be rejected, not silently replayed
    // with the wrong amount and not processed as a brand new deposit either.
    await deposit(app, user.accessToken, walletId, 9999, idempotencyKey).expect(
      409,
    );

    const balance = await getBalance(app, user.accessToken, walletId);
    expect(balance).toBe(1000n);
  });

  it('requires the Idempotency-Key header on a mutating endpoint', async () => {
    const user = await registerUser(app);
    const walletId = await createWallet(app, user.accessToken);

    await request(app.getHttpServer())
      .post('/api/v1/transactions/deposit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ walletId, amount: 1000 })
      .expect(400);
  });

  it('two concurrent requests with the SAME key only process one of them', async () => {
    const user = await registerUser(app);
    const walletId = await createWallet(app, user.accessToken);
    const idempotencyKey = `race-${Date.now()}-${Math.random()}`;

    // Fired truly concurrently - one should process (201), the other should
    // see the PENDING row and get a 409 (IdempotencyKeyInProgressException),
    // OR (rarely, if the first finishes first) get the replayed 201. Either
    // way, the money must move exactly once.
    const [a, b] = await Promise.all([
      deposit(app, user.accessToken, walletId, 2500, idempotencyKey),
      deposit(app, user.accessToken, walletId, 2500, idempotencyKey),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);

    const balance = await getBalance(app, user.accessToken, walletId);
    expect(balance).toBe(2500n); // exactly one deposit took effect, never two
  });
});
