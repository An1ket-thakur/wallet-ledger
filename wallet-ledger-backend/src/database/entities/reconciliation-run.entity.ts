import { bigintTransformer } from 'src/common/transformers/bigint.transformer';
import { ReconciliationStatus } from 'src/common/types/reconciliation.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per reconciliation run (nightly cron or manual admin trigger).
 * Kept even when CLEAN - an unbroken history of clean runs is itself the
 * evidence that the ledger has stayed correct over time.
 */
@Entity('reconciliation_runs')
export class ReconciliationRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: ReconciliationStatus,
    enumName: 'reconciliation_status',
  })
  status!: ReconciliationStatus;

  @Column({
    name: 'total_debits',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  totalDebits!: bigint;

  @Column({
    name: 'total_credits',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  totalCredits!: bigint;

  @Column({ name: 'unbalanced_transaction_count', type: 'int', default: 0 })
  unbalancedTransactionCount!: number;

  // Transaction ids that failed the per-transaction debit=credit check, plus
  // any error detail if status = FAILED. Kept small and structured for
  // support/admin dashboards to render directly.
  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @Column({ name: 'triggered_by', type: 'varchar', length: 16 })
  triggeredBy!: 'CRON' | 'MANUAL';

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
