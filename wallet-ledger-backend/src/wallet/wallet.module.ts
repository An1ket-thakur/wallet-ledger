import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from '../database/entities/wallet.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { WalletsController } from './wallet.controller';
import { WalletsService } from './wallet.service';
import { IdempotencyModule } from 'src/idempotency/idempotency.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet]),
    LedgerModule,
    IdempotencyModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
