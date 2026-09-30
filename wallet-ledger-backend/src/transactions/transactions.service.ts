import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wallet } from '../database/entities/wallet.entity';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionType } from '../common/types/ledger.enum';
import { PLATFORM_CASH_SYSTEM_CODE } from '../common/constants/system-wallets';
import { DepositDto } from './dto/deposit.dto';
import { TransferDto } from './dto/transfer.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CurrencyMismatchException } from '../ledger/ledger.error';
import { MockPayoutProcessorService } from './mock-payout-processor.service';

export interface TransactionResponse {
  transactionId: string;
  type: TransactionType;
  walletId: string;
  amount: string;
  currency: string;
  balanceAfter: string;
}

export interface TransferResponse {
  transactionId: string;
  type: TransactionType;
  fromWalletId: string;
  toWalletId: string;
  amount: string;
  currency: string;
  fromBalanceAfter: string;
  toBalanceAfter: string;
}

export interface WithdrawResponse {
  transactionId: string;
  status: 'POSTED' | 'FAILED';
  walletId: string;
  amount: string;
  currency: string;
  balanceAfter: string;
  failureReason?: string;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly payoutProcessor: MockPayoutProcessorService,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
  ) {}

  async deposit(
    user: AuthenticatedUser,
    dto: DepositDto,
  ): Promise<TransactionResponse> {
    const userWallet = await this.wallets.findOne({
      where: { id: dto.walletId },
    });
    if (!userWallet || userWallet.userId !== user.id) {
      throw new BadRequestException(
        'Wallet not found or not owned by this user',
      );
    }

    const systemCode = PLATFORM_CASH_SYSTEM_CODE[userWallet.currency];
    if (!systemCode)
      throw new BadRequestException(
        `No platform cash wallet configured for ${userWallet.currency}`,
      );
    const systemWallet = await this.wallets.findOne({ where: { systemCode } });
    if (!systemWallet)
      throw new BadRequestException(
        `Platform cash wallet ${systemCode} is not seeded`,
      );

    const amount = BigInt(dto.amount);

    return this.dataSource.transaction(async (manager) => {
      const [firstId, secondId] = [systemWallet.id, userWallet.id].sort();
      await this.ledger.lockWalletForUpdate(manager, firstId);
      await this.ledger.lockWalletForUpdate(manager, secondId);

      const txn = await this.ledger.postDoubleEntry(manager, {
        debitWalletId: systemWallet.id,
        creditWalletId: userWallet.id,
        amount,
        currency: userWallet.currency,
        type: TransactionType.DEPOSIT,
        initiatedBy: user.id,
      });

      const balanceAfter = await this.ledger.getBalance(userWallet.id, manager);

      return {
        transactionId: txn.id,
        type: TransactionType.DEPOSIT,
        walletId: userWallet.id,
        amount: amount.toString(),
        currency: userWallet.currency,
        balanceAfter: balanceAfter.toString(),
      };
    });
  }

  async transfer(
    user: AuthenticatedUser,
    dto: TransferDto,
  ): Promise<TransferResponse> {
    const [fromWallet, toWallet] = await Promise.all([
      this.wallets.findOne({ where: { id: dto.fromWalletId } }),
      this.wallets.findOne({ where: { id: dto.toWalletId } }),
    ]);

    if (!fromWallet || fromWallet.userId !== user.id) {
      throw new ForbiddenException('You do not own the source wallet');
    }
    if (!toWallet)
      throw new BadRequestException('Destination wallet not found');
    if (fromWallet.currency !== toWallet.currency)
      throw new CurrencyMismatchException();

    const amount = BigInt(dto.amount);

    return this.dataSource.transaction(async (manager) => {
      const [firstId, secondId] = [fromWallet.id, toWallet.id].sort();
      await this.ledger.lockWalletForUpdate(manager, firstId);
      await this.ledger.lockWalletForUpdate(manager, secondId);

      const txn = await this.ledger.postDoubleEntry(manager, {
        debitWalletId: fromWallet.id,
        creditWalletId: toWallet.id,
        amount,
        currency: fromWallet.currency,
        type: TransactionType.TRANSFER,
        initiatedBy: user.id,
      });

      const [fromBalanceAfter, toBalanceAfter] = await Promise.all([
        this.ledger.getBalance(fromWallet.id, manager),
        this.ledger.getBalance(toWallet.id, manager),
      ]);

      return {
        transactionId: txn.id,
        type: TransactionType.TRANSFER,
        fromWalletId: fromWallet.id,
        toWalletId: toWallet.id,
        amount: amount.toString(),
        currency: fromWallet.currency,
        fromBalanceAfter: fromBalanceAfter.toString(),
        toBalanceAfter: toBalanceAfter.toString(),
      };
    });
  }

  /**
   * The PENDING -> POSTED/FAILED flow, end to end:
   *  1. Lock the wallet, check funds, create a PENDING transaction - all in
   *     one DB transaction that commits immediately. This is deliberately a
   *     SEPARATE DB transaction from step 2, because calling an external
   *     processor while holding a Postgres row lock would block every other
   *     operation on this wallet for as long as the external call takes.
   *  2. Call the external payout processor with no lock held.
   *  3. Open a NEW DB transaction: re-lock the wallet, then either post the
   *     entries (debiting the wallet for real) on success, or mark the
   *     transaction FAILED (no entries, funds never left) on failure.
   *
   * Between steps 1 and 3 the wallet's ledger balance is unaffected - a
   * PENDING transaction with no entries doesn't move money. If the process
   * crashes between step 1 and step 3, the transaction is left PENDING
   * forever; a real system needs a periodic sweep that re-queries "stuck"
   * PENDING withdrawals past some age and either resolves them via a status
   * check against the processor or fails them out. Out of scope here, but
   * flagged because it's a real gap.
   */
  async withdraw(
    user: AuthenticatedUser,
    dto: WithdrawDto,
  ): Promise<WithdrawResponse> {
    const wallet = await this.wallets.findOne({ where: { id: dto.walletId } });
    if (!wallet || wallet.userId !== user.id) {
      throw new BadRequestException(
        'Wallet not found or not owned by this user',
      );
    }

    const systemCode = PLATFORM_CASH_SYSTEM_CODE[wallet.currency];
    if (!systemCode)
      throw new BadRequestException(
        `No platform cash wallet configured for ${wallet.currency}`,
      );
    const systemWallet = await this.wallets.findOne({ where: { systemCode } });
    if (!systemWallet)
      throw new BadRequestException(
        `Platform cash wallet ${systemCode} is not seeded`,
      );

    const amount = BigInt(dto.amount);

    // Step 1: validate funds and record intent, in its own short transaction.
    const pendingTxnId = await this.dataSource.transaction(async (manager) => {
      await this.ledger.lockWalletForUpdate(manager, wallet.id);

      const currentBalance = await this.ledger.getBalance(wallet.id, manager);
      if (currentBalance < amount) {
        throw new BadRequestException('Insufficient funds for withdrawal');
      }

      const pending = await this.ledger.createPendingTransaction(manager, {
        type: TransactionType.WITHDRAWAL,
        initiatedBy: user.id,
        metadata: {
          walletId: wallet.id,
          amount: amount.toString(),
          currency: wallet.currency,
        },
      });
      return pending.id;
    });

    // Step 2: call the external processor with no DB lock held.
    const result = await this.payoutProcessor.submitPayout(dto.amount);

    // Step 3: resolve the PENDING transaction based on the processor's response.
    return this.dataSource.transaction(async (manager) => {
      if (result.success) {
        const [firstId, secondId] = [wallet.id, systemWallet.id].sort();
        await this.ledger.lockWalletForUpdate(manager, firstId);
        await this.ledger.lockWalletForUpdate(manager, secondId);

        const txn = await this.ledger.postDoubleEntry(manager, {
          debitWalletId: wallet.id,
          creditWalletId: systemWallet.id,
          amount,
          currency: wallet.currency,
          type: TransactionType.WITHDRAWAL,
          existingTransactionId: pendingTxnId,
        });

        const balanceAfter = await this.ledger.getBalance(wallet.id, manager);

        return {
          transactionId: txn.id,
          status: 'POSTED' as const,
          walletId: wallet.id,
          amount: amount.toString(),
          currency: wallet.currency,
          balanceAfter: balanceAfter.toString(),
        };
      }

      await this.ledger.markTransactionFailed(
        manager,
        pendingTxnId,
        result.reason ?? 'Unknown failure',
      );
      const balanceAfter = await this.ledger.getBalance(wallet.id, manager);

      return {
        transactionId: pendingTxnId,
        status: 'FAILED' as const,
        walletId: wallet.id,
        amount: amount.toString(),
        currency: wallet.currency,
        balanceAfter: balanceAfter.toString(),
        failureReason: result.reason,
      };
    });
  }
}
