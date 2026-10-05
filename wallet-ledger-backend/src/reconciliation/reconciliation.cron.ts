import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';

@Injectable()
export class ReconciliationCron {
  private readonly logger = new Logger(ReconciliationCron.name);

  constructor(private readonly reconciliation: ReconciliationService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'nightly-ledger-reconciliation',
  })
  async handleNightlyReconciliation() {
    this.logger.log('Starting nightly ledger reconciliation...');
    const run = await this.reconciliation.runCheck('CRON');
    this.logger.log(
      `Reconciliation finished: status=${run.status} durationMs=${run.durationMs}`,
    );
  }
}
