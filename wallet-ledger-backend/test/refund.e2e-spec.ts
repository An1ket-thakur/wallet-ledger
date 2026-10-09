/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  registerUser,
  createWallet,
  deposit,
  getBalance,
  promoteToAdmin,
  TestUser,
} from './utils/test-app';

/**
 * Covers the project's most distinctive guarantee: a refund never edits or
 * deletes the original transaction. It posts a brand-new, opposite-direction
 * transaction, linked back to the original, and a transaction can only ever
 * be reversed once.
 */
describe('Refunds / reversals (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function transfer(
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

  function refund(
    admin: TestUser,
    transactionId: string,
    idempotencyKey: string,
    reason?: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/refunds')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ transactionId, ...(reason ? { reason } : {}) });
  }

  it('reverses a transfer by posting a new, opposite-direction transaction - never edits the original', async () => {
    const customer = await registerUser(app);
    const admin = await promoteToAdmin(app, await registerUser(app));

    const senderWallet = await createWallet(app, customer.accessToken);
    const receiverWallet = await createWallet(app, customer.accessToken);

    await deposit(
      app,
      customer.accessToken,
      senderWallet,
      5000,
      `seed-${Date.now()}`,
    ).expect(201);

    const transferRes = await transfer(
      customer,
      senderWallet,
      receiverWallet,
      2000,
      `transfer-${Date.now()}`,
    ).expect(201);

    const originalTransactionId: string = transferRes.body.transactionId;
    expect(originalTransactionId).toBeDefined();
    expect(transferRes.body.fromBalanceAfter).toBe('3000');
    expect(transferRes.body.toBalanceAfter).toBe('2000');

    const refundRes = await refund(
      admin,
      originalTransactionId,
      `refund-${Date.now()}`,
      'customer requested reversal',
    ).expect(201);

    // A brand-new transaction, linked back to the original - never a
    // mutation of it - with debit/credit flipped on the same two wallets.
    expect(refundRes.body.reversalTransactionId).toBeDefined();
    expect(refundRes.body.reversalTransactionId).not.toBe(
      originalTransactionId,
    );
    expect(refundRes.body.originalTransactionId).toBe(originalTransactionId);
    expect(refundRes.body.amount).toBe('2000');
    expect(refundRes.body.reversedDebitWalletId).toBe(receiverWallet);
    expect(refundRes.body.reversedCreditWalletId).toBe(senderWallet);

    // Money is back exactly where it started.
    expect(await getBalance(app, customer.accessToken, senderWallet)).toBe(
      5000n,
    );
    expect(await getBalance(app, customer.accessToken, receiverWallet)).toBe(
      0n,
    );
  });

  it('rejects reversing the same transaction twice with 409', async () => {
    const customer = await registerUser(app);
    const admin = await promoteToAdmin(app, await registerUser(app));

    const senderWallet = await createWallet(app, customer.accessToken);
    const receiverWallet = await createWallet(app, customer.accessToken);

    await deposit(
      app,
      customer.accessToken,
      senderWallet,
      1000,
      `seed-${Date.now()}`,
    ).expect(201);

    const transferRes = await transfer(
      customer,
      senderWallet,
      receiverWallet,
      500,
      `transfer-${Date.now()}`,
    ).expect(201);

    const originalTransactionId: string = transferRes.body.transactionId;

    await refund(
      admin,
      originalTransactionId,
      `refund-first-${Date.now()}`,
    ).expect(201);

    // A genuinely new request (different Idempotency-Key) targeting the
    // SAME original transaction - TransactionAlreadyReversedException is a
    // ConflictException, so this must be a 409, not a silent double-reverse.
    await refund(
      admin,
      originalTransactionId,
      `refund-second-${Date.now()}`,
    ).expect(409);

    // Balances reflect exactly ONE reversal, not two.
    expect(await getBalance(app, customer.accessToken, senderWallet)).toBe(
      1000n,
    );
    expect(await getBalance(app, customer.accessToken, receiverWallet)).toBe(
      0n,
    );
  });

  it('rejects reversing a REVERSAL transaction itself with 400', async () => {
    const customer = await registerUser(app);
    const admin = await promoteToAdmin(app, await registerUser(app));

    const senderWallet = await createWallet(app, customer.accessToken);
    const receiverWallet = await createWallet(app, customer.accessToken);

    await deposit(
      app,
      customer.accessToken,
      senderWallet,
      800,
      `seed-${Date.now()}`,
    ).expect(201);

    const transferRes = await transfer(
      customer,
      senderWallet,
      receiverWallet,
      300,
      `transfer-${Date.now()}`,
    ).expect(201);

    const refundRes = await refund(
      admin,
      transferRes.body.transactionId,
      `refund-${Date.now()}`,
    ).expect(201);

    const reversalTransactionId: string = refundRes.body.reversalTransactionId;

    // CannotReverseAReversalException is a BadRequestException -> 400.
    await refund(
      admin,
      reversalTransactionId,
      `refund-of-refund-${Date.now()}`,
    ).expect(400);
  });

  it('a non-Admin cannot issue a refund', async () => {
    const customer = await registerUser(app);
    const senderWallet = await createWallet(app, customer.accessToken);
    const receiverWallet = await createWallet(app, customer.accessToken);

    await deposit(
      app,
      customer.accessToken,
      senderWallet,
      500,
      `seed-${Date.now()}`,
    ).expect(201);

    const transferRes = await transfer(
      customer,
      senderWallet,
      receiverWallet,
      200,
      `transfer-${Date.now()}`,
    ).expect(201);

    await refund(
      customer,
      transferRes.body.transactionId,
      `refund-${Date.now()}`,
    ).expect(403);
  });

  it('404s when reversing a transaction that does not exist', async () => {
    const admin = await promoteToAdmin(app, await registerUser(app));

    await refund(
      admin,
      '00000000-0000-0000-0000-000000000000',
      `refund-${Date.now()}`,
    ).expect(404);
  });
});
