import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../database/entities/wallet.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { IdempotencyModule } from 'src/idempotency/idempotency.module';
import { MockPayoutProcessorService } from './mock-payout-processor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet]),
    LedgerModule,
    IdempotencyModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService, MockPayoutProcessorService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
