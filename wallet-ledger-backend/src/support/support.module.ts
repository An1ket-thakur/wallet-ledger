import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerEntry } from 'src/database/entities/ledger-entry.entity';
import { Transaction } from 'src/database/entities/transaction.entity';
import { User } from 'src/database/entities/users.entity';
import { Wallet } from 'src/database/entities/wallet.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { LedgerModule } from 'src/ledger/ledger.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Wallet, Transaction, LedgerEntry]),
    LedgerModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
