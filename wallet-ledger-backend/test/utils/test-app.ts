/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { User } from '../../src/database/entities/users.entity';
import { UserRole } from '../../src/common/types/roles.enum';

/**
 * Boots the FULL app (all modules, all guards, real TypeORM connection)
 * against whatever DATABASE_URL / DB_SCHEMA the test process's env points
 * to. This is deliberately NOT a unit-test-style mocked bootstrap - the
 * whole point of the concurrency and idempotency tests is to exercise the
 * real Postgres locking and the real unique-constraint behavior, which a
 * mocked DataSource can't demonstrate.
 *
 * Run against a dedicated TEST database, never your dev/prod one - these
 * tests create real users, wallets and transactions and do not clean up
 * other tests' data, only their own.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

export interface TestUser {
  accessToken: string;
  userId: string;
  email: string;
}

let counter = 0;

/** Unique email per call so repeated test runs never collide on the unique constraint. */
function uniqueEmail(): string {
  counter += 1;
  return `test.user.${Date.now()}.${counter}@example.com`;
}

export const TEST_PASSWORD = 'a-strong-password-123';

export async function registerUser(app: INestApplication): Promise<TestUser> {
  const email = uniqueEmail();
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: TEST_PASSWORD, fullName: 'Test User' })
    .expect(201);

  return {
    accessToken: res.body.accessToken,
    userId: decodeUserId(res.body.accessToken),
    email,
  };
}

function decodeUserId(jwt: string): string {
  const payload = JSON.parse(
    Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'),
  );
  return payload.sub;
}

export async function createWallet(
  app: INestApplication,
  accessToken: string,
  currency = 'USD',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/wallets')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Idempotency-Key', `create-wallet-${Date.now()}-${Math.random()}`)
    .send({ currency })
    .expect(201);

  return res.body.id;
}

export function deposit(
  app: INestApplication,
  accessToken: string,
  walletId: string,
  amount: number,
  idempotencyKey: string,
) {
  return request(app.getHttpServer())
    .post('/api/v1/transactions/deposit')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Idempotency-Key', idempotencyKey)
    .send({ walletId, amount });
}

export async function getBalance(
  app: INestApplication,
  accessToken: string,
  walletId: string,
): Promise<bigint> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/wallets/${walletId}/balance`)
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);

  return BigInt(res.body.balance);
}

export async function promoteToAdmin(
  app: INestApplication,
  user: TestUser,
): Promise<TestUser> {
  const dataSource = app.get(DataSource);
  await dataSource.getRepository(User).update(user.userId, {
    role: UserRole.ADMIN,
  });

  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD })
    .expect(200);

  return {
    accessToken: res.body.accessToken,
    userId: user.userId,
    email: user.email,
  };
}
