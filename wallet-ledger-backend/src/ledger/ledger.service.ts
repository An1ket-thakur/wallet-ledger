import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { Wallet } from '../database/entities/wallet.entity';
import {
  LedgerDirection,
  TransactionStatus,
  TransactionType,
  WalletStatus,
} from '../common/types/ledger.enum';
import {
  CurrencyMismatchException,
  InsufficientFundsException,
} from './ledger.error';

export interface PostDoubleEntryInput {
  /** Wallet losing value. */
  debitWalletId: string;
  /** Wallet gaining value. */
  creditWalletId: string;
  /** Minor units (cents). Must be > 0 - also enforced by the DB CHECK. */
  amount: bigint;
  currency: string;
  type: TransactionType;
  /** Set only when type = REVERSAL. */
  reversesTransactionId?: string;
  initiatedBy?: string | null;
  metadata?: Record<string, unknown> | null;
  /**
   * System wallets (platform cash) are allowed to go negative - they represent
   * what the platform owes users, not a spendable balance. User wallets are
   * checked for sufficient funds unless explicitly skipped (e.g. admin credit adjustments
   * should still go through a review flow, not this flag - it's here for system-side debits only).
   */
  skipOverdraftCheckForDebit?: boolean;
}

/**
 * The ONLY place that writes to ledger_entries / transactions.
 * Every method that mutates the ledger must be called with an EntityManager
 * that belongs to an already-open DB transaction with both wallets locked
 * (see TransactionsService for the locking pattern) - this service does not
 * open transactions or acquire locks itself.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly dataSource: DataSource) {}

  async getBalance(
    walletId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<bigint> {
    const raw = await manager
      .getRepository(LedgerEntry)
      .createQueryBuilder('le')
      .select(
        `COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -1 * le.amount END), 0)`,
        'balance',
      )
      .where('le.walletId = :walletId', { walletId })
      .getRawOne<{ balance: string }>();

    return BigInt(raw?.balance ?? '0');
  }

  /**
   * Writes one Transaction + two balanced LedgerEntry rows (one DEBIT, one CREDIT)
   * inside the caller's transaction. Does NOT lock rows - the caller must already
   * hold row locks on both wallets (SELECT ... FOR UPDATE) before calling this,
   * or the overdraft check below can race with a concurrent debit on the same wallet.
   */
  async postDoubleEntry(
    manager: EntityManager,
    input: PostDoubleEntryInput,
  ): Promise<Transaction> {
    if (input.amount <= 0n) {
      // Redundant with the DB CHECK, but fail fast with a clear message
      // instead of letting a generic Postgres constraint error bubble up.
      throw new InsufficientFundsException(input.debitWalletId);
    }

    const [debitWallet, creditWallet] = await Promise.all([
      manager
        .getRepository(Wallet)
        .findOne({ where: { id: input.debitWalletId } }),
      manager
        .getRepository(Wallet)
        .findOne({ where: { id: input.creditWalletId } }),
    ]);
    if (!debitWallet)
      throw new NotFoundException(`Wallet ${input.debitWalletId} not found`);
    if (!creditWallet)
      throw new NotFoundException(`Wallet ${input.creditWalletId} not found`);

    if (
      debitWallet.currency !== input.currency ||
      creditWallet.currency !== input.currency
    ) {
      throw new CurrencyMismatchException();
    }

    // System wallets (system_code set) are the platform's own float and are
    // allowed to go negative; only a user-owned wallet is overdraft-checked.
    const isSystemDebitWallet = debitWallet.systemCode !== null;
    if (!isSystemDebitWallet && !input.skipOverdraftCheckForDebit) {
      const currentBalance = await this.getBalance(debitWallet.id, manager);
      if (currentBalance < input.amount) {
        throw new InsufficientFundsException(debitWallet.id);
      }
    }

    const transaction = await manager.getRepository(Transaction).save(
      manager.getRepository(Transaction).create({
        type: input.type,
        status: TransactionStatus.POSTED,
        reversesTransactionId: input.reversesTransactionId ?? null,
        initiatedBy: input.initiatedBy ?? null,
        metadata: input.metadata ?? null,
      }),
    );

    // Insert both entries in one statement so they're in the same round trip;
    // the DEFERRED constraint trigger still validates balance at COMMIT regardless.
    await manager.getRepository(LedgerEntry).insert([
      {
        transactionId: transaction.id,
        walletId: debitWallet.id,
        direction: LedgerDirection.DEBIT,
        amount: input.amount,
        currency: input.currency,
      },
      {
        transactionId: transaction.id,
        walletId: creditWallet.id,
        direction: LedgerDirection.CREDIT,
        amount: input.amount,
        currency: input.currency,
      },
    ]);

    return transaction;
  }

  /**
   * Locks a wallet row for update within the caller's transaction. Callers that
   * need to lock two wallets (a transfer) MUST always lock them in a fixed order
   * (e.g. by id, ascending) to avoid deadlocks between two transfers going in
   * opposite directions between the same pair of wallets.
   */
  async lockWalletForUpdate(
    manager: EntityManager,
    walletId: string,
  ): Promise<Wallet> {
    const wallet = await manager
      .getRepository(Wallet)
      .createQueryBuilder('w')
      .setLock('pessimistic_write')
      .where('w.id = :walletId', { walletId })
      .getOne();

    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new InsufficientFundsException(walletId); // reuse 400; a dedicated WalletNotActiveException would be cleaner long-term
    }
    return wallet;
  }
}
