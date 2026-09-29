import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookEvent } from 'src/database/entities/webhook-event.entity';
import { Wallet } from 'src/database/entities/wallet.entity';
import { LedgerModule } from 'src/ledger/ledger.module';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEvent, Wallet]), LedgerModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
