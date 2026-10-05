import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Wallet } from '../database/entities/wallet.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { LedgerService } from '../ledger/ledger.service';
import { User } from '../database/entities/users.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntries: Repository<LedgerEntry>,
    private readonly ledger: LedgerService,
  ) {}

  async findUser(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        disabledAt: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  async listWalletsForUser(userId: string) {
    await this.findUser(userId);
    const wallets = await this.wallets.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    return Promise.all(
      wallets.map(async (w) => ({
        id: w.id,
        currency: w.currency,
        status: w.status,
        createdAt: w.createdAt,
        balance: (await this.ledger.getBalance(w.id)).toString(),
      })),
    );
  }

  async getWalletHistory(walletId: string, limit: number) {
    const wallet = await this.wallets.findOne({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException(`Wallet ${walletId} not found`);

    const entries = await this.ledgerEntries.find({
      where: { walletId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    const transactionIds = [...new Set(entries.map((e) => e.transactionId))];
    const transactions = transactionIds.length
      ? await this.transactions.findBy({ id: In(transactionIds) })
      : [];
    const txnById = new Map(transactions.map((t) => [t.id, t]));

    return {
      walletId,
      currency: wallet.currency,
      balance: (await this.ledger.getBalance(walletId)).toString(),
      entries: entries.map((e) => {
        const txn = txnById.get(e.transactionId);
        return {
          transactionId: e.transactionId,
          direction: e.direction,
          amount: e.amount.toString(),
          currency: e.currency,
          type: txn?.type ?? null,
          status: txn?.status ?? null,
          reversesTransactionId: txn?.reversesTransactionId ?? null,
          createdAt: e.createdAt,
        };
      }),
    };
  }

  async getTransactionDetail(transactionId: string) {
    const transaction = await this.transactions.findOne({
      where: { id: transactionId },
    });
    if (!transaction)
      throw new NotFoundException(`Transaction ${transactionId} not found`);

    const entries = await this.ledgerEntries.find({ where: { transactionId } });
    const reversal = await this.transactions.findOne({
      where: { reversesTransactionId: transactionId },
    });

    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt,
      reversesTransactionId: transaction.reversesTransactionId,
      reversedByTransactionId: reversal?.id ?? null,
      entries: entries.map((e) => ({
        walletId: e.walletId,
        direction: e.direction,
        amount: e.amount.toString(),
        currency: e.currency,
      })),
    };
  }
}
