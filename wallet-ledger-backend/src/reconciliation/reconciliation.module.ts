import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedgerEntry } from 'src/database/entities/ledger-entry.entity';
import { ReconciliationRun } from 'src/database/entities/reconciliation-run.entity';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationCron } from './reconciliation.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReconciliationRun, LedgerEntry]),
    ScheduleModule.forRoot(), // safe to call once here even if imported elsewhere; Nest dedupes
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService, ReconciliationCron],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
