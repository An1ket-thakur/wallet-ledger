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
import { AuditService } from 'src/audit/audit.service';

export interface RefundResponse {
  reversalTransactionId: string;
  originalTransactionId: string;
  amount: string;
  currency: string;
  reversedDebitWalletId: string;
  reversedCreditWalletId: string;
}

@Injectable()
export class RefundsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntries: Repository<LedgerEntry>,
  ) {}

  async reverse(
    admin: AuthenticatedUser,
    dto: CreateRefundDto,
    ipAddress?: string | null,
  ): Promise<RefundResponse> {
    const original = await this.transactions.findOne({
      where: { id: dto.transactionId },
    });
    if (!original) throw new TransactionNotFoundException(dto.transactionId);

    if (original.type === TransactionType.REVERSAL) {
      throw new CannotReverseAReversalException();
    }

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
      throw new TransactionNotFoundException(original.id);
    }

    const reversalDebitWalletId = creditEntry.walletId;
    const reversalCreditWalletId = debitEntry.walletId;
    const amount = debitEntry.amount;

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
        skipOverdraftCheckForDebit: true,
      });

      await this.audit.record(
        {
          actorUserId: admin.id,
          actorRole: admin.role,
          action: 'REFUND_ISSUED',
          targetType: 'transaction',
          targetId: original.id,
          details: {
            reversalTransactionId: reversalTxn.id,
            amount: amount.toString(),
            currency: debitEntry.currency,
            reason: dto.reason ?? null,
          },
          ipAddress,
        },
        manager,
      );

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
