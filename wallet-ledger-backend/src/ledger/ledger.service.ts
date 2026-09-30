import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
  debitWalletId: string;
  creditWalletId: string;
  amount: bigint;
  currency: string;
  type: TransactionType;
  reversesTransactionId?: string;
  initiatedBy?: string | null;
  metadata?: Record<string, unknown> | null;
  skipOverdraftCheckForDebit?: boolean;
  /**
   * If provided, posts entries against an EXISTING PENDING transaction
   * (created via createPendingTransaction) instead of creating a new one.
   * Used for the two-phase PENDING -> POSTED flow (e.g. async withdrawals).
   */
  existingTransactionId?: string;
}

export interface CreatePendingTransactionInput {
  type: TransactionType;
  initiatedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The ONLY place that writes to ledger_entries / transactions.
 *
 * Two paths through this service:
 *  - Synchronous (deposit, transfer, refund): call postDoubleEntry() directly.
 *    It creates the Transaction as POSTED and writes both entries in one go.
 *  - Asynchronous (e.g. withdrawal to an external processor): call
 *    createPendingTransaction() first, do the external call, then EITHER
 *    postDoubleEntry({ existingTransactionId }) on success OR
 *    markTransactionFailed() on failure. A PENDING transaction never has
 *    ledger entries; a FAILED one never gets any either.
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
   * Phase 1 of an async flow: record intent before anything external happens.
   * No ledger entries yet - the transaction exists purely as an audit trail
   * of "this was attempted", so if the process crashes right after this call
   * and before the external processor responds, you still have a PENDING
   * record to reconcile/investigate rather than nothing at all.
   */
  async createPendingTransaction(
    manager: EntityManager,
    input: CreatePendingTransactionInput,
  ): Promise<Transaction> {
    return manager.getRepository(Transaction).save(
      manager.getRepository(Transaction).create({
        type: input.type,
        status: TransactionStatus.PENDING,
        initiatedBy: input.initiatedBy ?? null,
        metadata: input.metadata ?? null,
      }),
    );
  }

  /**
   * Phase 2a (success): posts the balanced entries and flips PENDING -> POSTED.
   * Also used directly (without a prior createPendingTransaction call) for
   * synchronous flows, where existingTransactionId is omitted and a fresh
   * POSTED transaction is created in one step.
   */
  async postDoubleEntry(
    manager: EntityManager,
    input: PostDoubleEntryInput,
  ): Promise<Transaction> {
    if (input.amount <= 0n) {
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

    const isSystemDebitWallet = debitWallet.systemCode !== null;
    if (!isSystemDebitWallet && !input.skipOverdraftCheckForDebit) {
      const currentBalance = await this.getBalance(debitWallet.id, manager);
      if (currentBalance < input.amount) {
        throw new InsufficientFundsException(debitWallet.id);
      }
    }

    let transaction: Transaction;

    if (input.existingTransactionId) {
      transaction = await this.claimPendingTransaction(
        manager,
        input.existingTransactionId,
      );
      transaction.status = TransactionStatus.POSTED;
      if (input.metadata)
        transaction.metadata = { ...transaction.metadata, ...input.metadata };
      await manager.getRepository(Transaction).save(transaction);
    } else {
      transaction = await manager.getRepository(Transaction).save(
        manager.getRepository(Transaction).create({
          type: input.type,
          status: TransactionStatus.POSTED,
          reversesTransactionId: input.reversesTransactionId ?? null,
          initiatedBy: input.initiatedBy ?? null,
          metadata: input.metadata ?? null,
        }),
      );
    }

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
   * Phase 2b (failure): marks a PENDING transaction as FAILED. NEVER writes
   * ledger entries - a failed transaction, by definition, moved no money, so
   * the books must show nothing happened. The row survives only as an audit
   * trail of "this was attempted and did not go through", plus the reason.
   */
  async markTransactionFailed(
    manager: EntityManager,
    transactionId: string,
    reason: string,
  ): Promise<Transaction> {
    const transaction = await this.claimPendingTransaction(
      manager,
      transactionId,
    );

    transaction.status = TransactionStatus.FAILED;
    transaction.metadata = { ...transaction.metadata, failureReason: reason };

    return manager.getRepository(Transaction).save(transaction);
  }

  /**
   * Loads a transaction and asserts it's still PENDING before letting a
   * caller resolve it either way. Prevents resolving the same transaction
   * twice (e.g. a duplicate webhook callback trying to both post AND fail
   * the same withdrawal).
   */
  private async claimPendingTransaction(
    manager: EntityManager,
    transactionId: string,
  ): Promise<Transaction> {
    const transaction = await manager
      .getRepository(Transaction)
      .createQueryBuilder('t')
      .setLock('pessimistic_write')
      .where('t.id = :transactionId', { transactionId })
      .getOne();

    if (!transaction)
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    if (transaction.status !== TransactionStatus.PENDING) {
      throw new ConflictException(
        `Transaction ${transactionId} is already ${transaction.status}, cannot resolve it again`,
      );
    }
    return transaction;
  }

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
      throw new InsufficientFundsException(walletId);
    }
    return wallet;
  }
}
