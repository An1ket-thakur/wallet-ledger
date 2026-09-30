import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerDirection, TransactionType } from '../common/types/ledger.enum';
import { CreateRefundDto } from './dto/create-refund.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  CannotReverseAReversalException,
  TransactionAlreadyReversedException,
  TransactionNotFoundException,
} from './refunds.error';

export interface RefundResponse {
  reversalTransactionId: string;
  originalTransactionId: string;
  amount: string;
  currency: string;
  reversedDebitWalletId: string;
  reversedCreditWalletId: string;
}

/**
 * Admin-only. A refund/reversal NEVER edits or deletes the original
 * transaction or its ledger entries - it POSTS A NEW transaction that moves
 * the same amount back the other way, permanently linked via
 * reverses_transaction_id. History is never rewritten, only appended to.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntries: Repository<LedgerEntry>,
  ) {}

  async reverse(
    admin: AuthenticatedUser,
    dto: CreateRefundDto,
  ): Promise<RefundResponse> {
    const original = await this.transactions.findOne({
      where: { id: dto.transactionId },
    });
    if (!original) throw new TransactionNotFoundException(dto.transactionId);

    if (original.type === TransactionType.REVERSAL) {
      throw new CannotReverseAReversalException();
    }

    // Belt-and-suspenders check ahead of the DB's own UNIQUE(reverses_transaction_id) -
    // gives a clean 409 with context instead of a raw constraint-violation error.
    const alreadyReversed = await this.transactions.findOne({
      where: { reversesTransactionId: original.id },
    });
    if (alreadyReversed)
      throw new TransactionAlreadyReversedException(original.id);

    const entries = await this.ledgerEntries.find({
      where: { transactionId: original.id },
    });
    const debitEntry = entries.find(
      (e) => e.direction === LedgerDirection.DEBIT,
    );
    const creditEntry = entries.find(
      (e) => e.direction === LedgerDirection.CREDIT,
    );
    if (!debitEntry || !creditEntry) {
      // Shouldn't be reachable given the balanced-transaction DB trigger, but
      // fail loudly rather than silently reversing a malformed transaction.
      throw new TransactionNotFoundException(original.id);
    }

    // Reversal flips direction: whoever received the original CREDIT now
    // gets DEBITed, and whoever was DEBITed originally gets CREDITed back.
    const reversalDebitWalletId = creditEntry.walletId;
    const reversalCreditWalletId = debitEntry.walletId;
    const amount = debitEntry.amount; // == creditEntry.amount, enforced by the balanced-transaction trigger

    return this.dataSource.transaction(async (manager) => {
      const [firstId, secondId] = [
        reversalDebitWalletId,
        reversalCreditWalletId,
      ].sort();
      await this.ledger.lockWalletForUpdate(manager, firstId);
      await this.ledger.lockWalletForUpdate(manager, secondId);

      const reversalTxn = await this.ledger.postDoubleEntry(manager, {
        debitWalletId: reversalDebitWalletId,
        creditWalletId: reversalCreditWalletId,
        amount,
        currency: debitEntry.currency,
        type: TransactionType.REVERSAL,
        reversesTransactionId: original.id,
        initiatedBy: admin.id,
        metadata: dto.reason ? { reason: dto.reason } : null,
        // A refund is an administrative correction, not a normal spend - it
        // must go through even if the wallet being debited (the original
        // recipient) has since spent the funds and would go negative. That
        // negative balance is now a real, visible debt owed back to the
        // platform, not a bug; a production system would flag/collect on it
        // separately rather than silently blocking the refund.
        skipOverdraftCheckForDebit: true,
      });

      return {
        reversalTransactionId: reversalTxn.id,
        originalTransactionId: original.id,
        amount: amount.toString(),
        currency: debitEntry.currency,
        reversedDebitWalletId: reversalDebitWalletId,
        reversedCreditWalletId: reversalCreditWalletId,
      };
    });
  }
}
