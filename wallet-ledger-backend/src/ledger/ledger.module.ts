import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerService } from './ledger.service';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { Transaction } from '../database/entities/transaction.entity';
import { Wallet } from 'src/database/entities/wallet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry, Transaction, Wallet])],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
