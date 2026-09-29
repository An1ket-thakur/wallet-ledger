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
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TransferDto } from './dto/transfer.dto';
import { CurrencyMismatchException } from 'src/ledger/ledger.error';

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

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
  ) {}

  /**
   * Deposit: platform cash -> user wallet. The platform wallet is the DEBIT
   * side (it's giving out money) and is exempt from the overdraft check since
   * it's a system wallet, not a user balance.
   *
   * Runs in one DB transaction: lock both wallets (fixed order), then
   * postDoubleEntry. A single-wallet operation like this only ever needs the
   * lock on the destination wallet, but we still lock the system wallet too
   * for consistency with the transfer path and to serialize concurrent
   * deposits/withdrawals against the same system float.
   */
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
    if (!systemCode) {
      throw new BadRequestException(
        `No platform cash wallet configured for ${userWallet.currency}`,
      );
    }
    const systemWallet = await this.wallets.findOne({ where: { systemCode } });
    if (!systemWallet) {
      throw new BadRequestException(
        `Platform cash wallet ${systemCode} is not seeded`,
      );
    }

    const amount = BigInt(dto.amount);

    return this.dataSource.transaction(async (manager) => {
      // Fixed lock order by id (ascending) prevents deadlocks if a withdrawal
      // on the same pair locks in the opposite order concurrently.
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

  /**
   * User wallet -> user wallet. Unlike deposit, BOTH sides are real user
   * balances, so both get the overdraft check (only the source can actually
   * fail it, but postDoubleEntry checks whichever wallet is the debit side).
   *
   * Locking: always lock in ascending-id order, regardless of which wallet is
   * "from" and which is "to". Without this, transfer(A -> B) running
   * concurrently with transfer(B -> A) can deadlock - each holds the lock the
   * other needs, in opposite order.
   */
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
    if (!toWallet) {
      throw new BadRequestException('Destination wallet not found');
    }
    if (fromWallet.currency !== toWallet.currency) {
      throw new CurrencyMismatchException();
    }

    const amount = BigInt(dto.amount);

    return this.dataSource.transaction(async (manager) => {
      const [firstId, secondId] = [fromWallet.id, toWallet.id].sort();
      await this.ledger.lockWalletForUpdate(manager, firstId);
      await this.ledger.lockWalletForUpdate(manager, secondId);

      // Overdraft check runs on fromWallet inside postDoubleEntry since it's
      // the debit side and is not a system wallet.
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
}
