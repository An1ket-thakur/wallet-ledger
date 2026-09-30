import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../database/entities/transaction.entity';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, LedgerEntry]),
    LedgerModule,
    IdempotencyModule,
  ],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
