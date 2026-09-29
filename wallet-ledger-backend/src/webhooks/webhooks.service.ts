import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Wallet } from '../database/entities/wallet.entity';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionType } from '../common/types/ledger.enum';
import { PLATFORM_CASH_SYSTEM_CODE } from '../common/constants/system-wallets';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { verifyHmacSignature } from './hmac.util';
import { WebhookEvent } from 'src/database/entities/webhook-event.entity';

const PROVIDER = 'mock-payment-provider';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
  ) {}

  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret) {
      // Fail closed: a missing secret in config is a deploy misconfiguration,
      // never a reason to accept unverified webhooks.
      throw new UnauthorizedException('Webhook verification is not configured');
    }
    if (!verifyHmacSignature(rawBody, signatureHeader, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  /**
   * Handles payment.succeeded: credits the target wallet from platform cash,
   * same shape as a manual deposit. Dedup is by (provider, providerEventId) -
   * webhook providers redeliver on any non-2xx response or timeout, so this
   * MUST be idempotent independent of the Idempotency-Key mechanism (there's
   * no client header here, the provider doesn't send one).
   */
  async handlePaymentSucceeded(
    dto: PaymentWebhookDto,
  ): Promise<{ status: string; transactionId?: string }> {
    const existing = await this.events.findOne({
      where: { provider: PROVIDER, providerEventId: dto.eventId },
    });
    if (existing) {
      // Already processed (or in flight) - acknowledge with 2xx either way so
      // the provider stops redelivering. Do NOT reprocess.
      return { status: 'already_processed' };
    }

    const userWallet = await this.wallets.findOne({
      where: { id: dto.walletId },
    });
    if (!userWallet) {
      throw new BadRequestException('Unknown wallet in webhook payload');
    }
    if (userWallet.currency !== dto.currency) {
      throw new BadRequestException(
        'Currency mismatch between webhook payload and wallet',
      );
    }

    const systemCode = PLATFORM_CASH_SYSTEM_CODE[userWallet.currency];
    const systemWallet = systemCode
      ? await this.wallets.findOne({ where: { systemCode } })
      : null;
    if (!systemWallet) {
      throw new BadRequestException(
        `Platform cash wallet not configured for ${userWallet.currency}`,
      );
    }

    const amount = BigInt(dto.amount);

    const transactionId = await this.dataSource.transaction(async (manager) => {
      const [firstId, secondId] = [systemWallet.id, userWallet.id].sort();
      await this.ledger.lockWalletForUpdate(manager, firstId);
      await this.ledger.lockWalletForUpdate(manager, secondId);

      const txn = await this.ledger.postDoubleEntry(manager, {
        debitWalletId: systemWallet.id,
        creditWalletId: userWallet.id,
        amount,
        currency: userWallet.currency,
        type: TransactionType.DEPOSIT,
        metadata: {
          source: 'webhook',
          provider: PROVIDER,
          eventId: dto.eventId,
        },
      });

      // Record the event as processed in the SAME transaction as the ledger
      // write - if either fails, both roll back, so a crash between the two
      // can't leave a "processed" marker with no matching ledger entry (or
      // vice versa).
      await manager.getRepository(WebhookEvent).insert({
        provider: PROVIDER,
        providerEventId: dto.eventId,
        transactionId: txn.id,
      });

      return txn.id;
    });

    return { status: 'processed', transactionId };
  }
}
