import { MigrationInterface, QueryRunner } from 'typeorm';
import { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresDataSourceOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class CreateReconciliationRuns1791000000000 implements MigrationInterface {
  name = 'CreateReconciliationRuns1791000000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(
      `CREATE TYPE ${S}.reconciliation_status AS ENUM ('CLEAN','DISCREPANCY','FAILED')`,
    );
    await q.query(`
      CREATE TABLE ${S}.reconciliation_runs (
        id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        status                        ${S}.reconciliation_status NOT NULL,
        total_debits                  bigint NOT NULL,
        total_credits                 bigint NOT NULL,
        unbalanced_transaction_count  int NOT NULL DEFAULT 0,
        details                       jsonb,
        triggered_by                  varchar(16) NOT NULL,
        duration_ms                   int NOT NULL,
        created_at                    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT reconciliation_runs_triggered_by_chk CHECK (triggered_by IN ('CRON','MANUAL'))
      )
    `);
    await q.query(
      `CREATE INDEX reconciliation_runs_created_at_idx ON ${S}.reconciliation_runs (created_at DESC)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`DROP TABLE IF EXISTS ${S}.reconciliation_runs`);
    await q.query(`DROP TYPE IF EXISTS ${S}.reconciliation_status`);
  }
}
