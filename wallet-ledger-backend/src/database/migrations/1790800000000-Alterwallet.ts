import { MigrationInterface, QueryRunner } from 'typeorm';
import { type PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresConnectionOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class AlterWallet1790800000000 implements MigrationInterface {
  name = 'AlterWallet1790800000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`ALTER TABLE ${S}.wallets ADD COLUMN label varchar(100);`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`ALTER TABLE ${S}.wallets DROP COLUMN label;`);
  }
}
