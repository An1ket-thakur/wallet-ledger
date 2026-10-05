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
  existingTransactionId?: string;
}

export interface CreatePendingTransactionInput {
  type: TransactionType;
  initiatedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

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
