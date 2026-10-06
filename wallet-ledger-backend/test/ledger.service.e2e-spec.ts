/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { LedgerService } from '../src/ledger/ledger.service';
import { Wallet } from '../src/database/entities/wallet.entity';
import { Transaction } from '../src/database/entities/transaction.entity';
import { LedgerEntry } from '../src/database/entities/ledger-entry.entity';
import { TransactionType, WalletStatus } from '../src/common/types/ledger.enum';
import { InsufficientFundsException } from '../src/ledger/ledger.error';
import { CurrencyMismatchException } from '../src/ledger/ledger.error';

/**
 * Pure unit tests - no real database. The EntityManager passed into
 * postDoubleEntry() is a hand-built fake whose getRepository() returns
 * just enough of the Repository surface (findOne/create/save/insert) for
 * the method under test to run. This verifies the SERVICE'S OWN decision
 * logic (overdraft check, currency check, system-wallet exemption) in
 * isolation from Postgres - the DB-level guarantees (the balanced-
 * transaction trigger, the append-only triggers, the composite currency FK)
 * are a separate concern, covered by actually running the migration against
 * a real Postgres instance, not by a unit test.
 */
describe('LedgerService', () => {
  let service: LedgerService;
  let dataSource: { manager: EntityManager };

  function makeWallet(overrides: Partial<Wallet> = {}): Wallet {
    return {
      id: 'wallet-1',
      userId: 'user-1',
      systemCode: null,
      currency: 'USD',
      status: WalletStatus.ACTIVE,
      createdAt: new Date(),
      ...overrides,
    } as Wallet;
  }

  /**
   * Builds a fake EntityManager backed by in-memory maps keyed by entity
   * name, so postDoubleEntry's findOne/create/save/insert calls behave
   * consistently without touching a real database.
   */
  function makeFakeManager(
    wallets: Wallet[],
    ledgerEntries: LedgerEntry[] = [],
  ) {
    const walletsById = new Map(wallets.map((w) => [w.id, w]));
    const entries = [...ledgerEntries];
    let txnCounter = 0;

    const walletRepo = {
      findOne: jest.fn(
        async ({ where: { id } }: any) => walletsById.get(id) ?? null,
      ),
    };

    const transactionRepo = {
      create: jest.fn((data: any) => ({ id: `txn-${++txnCounter}`, ...data })),
      save: jest.fn(async (entity: any) => entity),
    };

    const ledgerEntryRepo = {
      insert: jest.fn(async (rows: any[]) => {
        entries.push(...rows);
      }),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          _where: null,
          select: () => qb,
          addSelect: () => qb,
          where: (_: string, params: any) => {
            qb._walletId = params.walletId;
            return qb;
          },
          getRawOne: () => {
            const relevant = entries.filter((e) => e.walletId === qb._walletId);
            const balance = relevant.reduce(
              (acc, e) =>
                acc + (e.direction === 'CREDIT' ? e.amount : -e.amount),
              0n,
            );
            return { balance: balance.toString() };
          },
        };
        return qb;
      }),
    };

    return {
      getRepository: (entity: any) => {
        if (entity === Wallet) return walletRepo;
        if (entity === Transaction) return transactionRepo;
        if (entity === LedgerEntry) return ledgerEntryRepo;
        throw new Error(`No fake repository configured for ${entity}`);
      },
    } as unknown as EntityManager;
  }

  beforeEach(async () => {
    dataSource = { manager: {} as EntityManager };
    const module: TestingModule = await Test.createTestingModule({
      providers: [LedgerService, { provide: DataSource, useValue: dataSource }],
    }).compile();

    service = module.get(LedgerService);
  });

  it('posts a balanced debit/credit pair and returns the created transaction', async () => {
    const debitWallet = makeWallet({
      id: 'w-debit',
      systemCode: 'PLATFORM_CASH_USD',
      userId: null,
    });
    const creditWallet = makeWallet({ id: 'w-credit', userId: 'user-1' });
    const manager = makeFakeManager([debitWallet, creditWallet]);

    const txn = await service.postDoubleEntry(manager, {
      debitWalletId: debitWallet.id,
      creditWalletId: creditWallet.id,
      amount: 5000n,
      currency: 'USD',
      type: TransactionType.DEPOSIT,
    });

    expect(txn.type).toBe(TransactionType.DEPOSIT);
    const balance = await service.getBalance(creditWallet.id, manager);
    expect(balance).toBe(5000n);
  });

  it('rejects a debit that would overdraw a non-system wallet', async () => {
    const userWalletA = makeWallet({ id: 'w-a', userId: 'user-a' });
    const userWalletB = makeWallet({ id: 'w-b', userId: 'user-b' });
    // userWalletA has a balance of 0 - no prior entries - so any debit > 0 overdraws it.
    const manager = makeFakeManager([userWalletA, userWalletB]);

    await expect(
      service.postDoubleEntry(manager, {
        debitWalletId: userWalletA.id,
        creditWalletId: userWalletB.id,
        amount: 100n,
        currency: 'USD',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsException);
  });

  it('allows a system wallet to go negative (exempt from the overdraft check)', async () => {
    const systemWallet = makeWallet({
      id: 'w-sys',
      systemCode: 'PLATFORM_CASH_USD',
      userId: null,
    });
    const userWallet = makeWallet({ id: 'w-user', userId: 'user-1' });
    const manager = makeFakeManager([systemWallet, userWallet]);

    // System wallet starts at 0 and has no funds, but it's the debit side and
    // is a system wallet - this must succeed despite going negative.
    await expect(
      service.postDoubleEntry(manager, {
        debitWalletId: systemWallet.id,
        creditWalletId: userWallet.id,
        amount: 10_000n,
        currency: 'USD',
        type: TransactionType.DEPOSIT,
      }),
    ).resolves.toBeDefined();

    const systemBalance = await service.getBalance(systemWallet.id, manager);
    expect(systemBalance).toBe(-10_000n);
  });

  it('rejects a transfer between wallets of different currencies', async () => {
    const usdWallet = makeWallet({ id: 'w-usd', currency: 'USD' });
    const eurWallet = makeWallet({ id: 'w-eur', currency: 'EUR' });
    const manager = makeFakeManager([usdWallet, eurWallet]);

    await expect(
      service.postDoubleEntry(manager, {
        debitWalletId: usdWallet.id,
        creditWalletId: eurWallet.id,
        amount: 100n,
        currency: 'USD',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toBeInstanceOf(CurrencyMismatchException);
  });

  it('rejects a non-positive amount before touching any wallet', async () => {
    const walletA = makeWallet({ id: 'w-a' });
    const walletB = makeWallet({ id: 'w-b' });
    const manager = makeFakeManager([walletA, walletB]);

    await expect(
      service.postDoubleEntry(manager, {
        debitWalletId: walletA.id,
        creditWalletId: walletB.id,
        amount: 0n,
        currency: 'USD',
        type: TransactionType.TRANSFER,
      }),
    ).rejects.toBeInstanceOf(InsufficientFundsException);
  });
});
