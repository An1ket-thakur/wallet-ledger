import { MigrationInterface, QueryRunner } from 'typeorm';
import { type PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresDataSourceOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class SeedPlatformWallet1790600000000 implements MigrationInterface {
  name = 'SeedPlatformWallet1790600000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`
      INSERT INTO ${S}.wallets (system_code, currency) VALUES ('PLATFORM_CASH_EUR', 'EUR')
    `);
    await q.query(`
      INSERT INTO ${S}.wallets (system_code, currency) VALUES ('PLATFORM_CASH_INR', 'INR')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(
      `DELETE FROM ${S}.wallets WHERE system_code = 'PLATFORM_CASH_EUR'`,
    );
    await q.query(
      `DELETE FROM ${S}.wallets WHERE system_code = 'PLATFORM_CASH_INR'`,
    );
  }
}
