import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LedgerEntry } from '../database/entities/ledger-entry.entity';
import { ReconciliationRun } from 'src/database/entities/reconciliation-run.entity';
import { ReconciliationStatus } from 'src/common/types/reconciliation.enum';

interface RawTotals {
  total_debits: string | null;
  total_credits: string | null;
}

interface RawUnbalancedRow {
  transaction_id: string;
  debits: string;
  credits: string;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ReconciliationRun)
    private readonly runs: Repository<ReconciliationRun>,
  ) {}

  async runCheck(triggeredBy: 'CRON' | 'MANUAL'): Promise<ReconciliationRun> {
    const startedAt = Date.now();

    try {
      const totals = await this.dataSource
        .getRepository(LedgerEntry)
        .createQueryBuilder('le')
        .select(
          `COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'DEBIT'), 0)`,
          'total_debits',
        )
        .addSelect(
          `COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'CREDIT'), 0)`,
          'total_credits',
        )
        .getRawOne<RawTotals>();

      const totalDebits = BigInt(totals?.total_debits ?? '0');
      const totalCredits = BigInt(totals?.total_credits ?? '0');

      const unbalanced = await this.dataSource.query<RawUnbalancedRow[]>(`
        SELECT
          transaction_id,
          SUM(amount) FILTER (WHERE direction = 'DEBIT')  AS debits,
          SUM(amount) FILTER (WHERE direction = 'CREDIT') AS credits
        FROM ledger_entries
        GROUP BY transaction_id
        HAVING SUM(amount) FILTER (WHERE direction = 'DEBIT')
             <> SUM(amount) FILTER (WHERE direction = 'CREDIT')
      `);

      const status: ReconciliationStatus =
        totalDebits === totalCredits && unbalanced.length === 0
          ? ReconciliationStatus.CLEAN
          : ReconciliationStatus.DISCREPANCY;

      if (status === ReconciliationStatus.DISCREPANCY) {
        this.logger.error(
          `Reconciliation DISCREPANCY: totalDebits=${totalDebits} totalCredits=${totalCredits} ` +
            `unbalancedTransactions=${unbalanced.length}`,
        );
      }

      const run = await this.runs.save(
        this.runs.create({
          status,
          totalDebits,
          totalCredits,
          unbalancedTransactionCount: unbalanced.length,
          details:
            unbalanced.length > 0
              ? { unbalancedTransactions: unbalanced }
              : null,
          triggeredBy,
          durationMs: Date.now() - startedAt,
        }),
      );

      return run;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Reconciliation run FAILED: ${message}`);

      return this.runs.save(
        this.runs.create({
          status: ReconciliationStatus.FAILED,
          totalDebits: 0n,
          totalCredits: 0n,
          unbalancedTransactionCount: 0,
          details: { error: message },
          triggeredBy,
          durationMs: Date.now() - startedAt,
        }),
      );
    }
  }

  async listRuns(limit = 30): Promise<ReconciliationRun[]> {
    return this.runs.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
