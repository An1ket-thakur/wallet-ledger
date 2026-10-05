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
import {
  buildSignedPayload,
  isTimestampFresh,
  verifyHmacSignature,
} from './hmac.util';
import { WebhookEvent } from 'src/database/entities/webhook-event.entity';

const PROVIDER = 'mock-payment-provider';
const TIMESTAMP_TOLERANCE_SECONDS = 300;

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

  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    timestampHeader: string | undefined,
  ): void {
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Webhook verification is not configured');
    }

    if (!isTimestampFresh(timestampHeader, TIMESTAMP_TOLERANCE_SECONDS)) {
      throw new UnauthorizedException(
        'Webhook timestamp is missing, malformed, or outside the allowed window',
      );
    }

    const signedPayload = buildSignedPayload(
      timestampHeader as string,
      rawBody,
    );
    if (!verifyHmacSignature(signedPayload, signatureHeader, secret)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  async handlePaymentSucceeded(
    dto: PaymentWebhookDto,
  ): Promise<{ status: string; transactionId?: string }> {
    const existing = await this.events.findOne({
      where: { provider: PROVIDER, providerEventId: dto.eventId },
    });
    if (existing) {
      return { status: 'already_processed' };
    }

    const userWallet = await this.wallets.findOne({
      where: { id: dto.walletId },
    });
    if (!userWallet)
      throw new BadRequestException('Unknown wallet in webhook payload');
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
