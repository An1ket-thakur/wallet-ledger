import { MigrationInterface, QueryRunner } from 'typeorm';
import { type PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresConnectionOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class CreateIdempotencyKeys1790700000000 implements MigrationInterface {
  name = 'CreateIdempotencyKeys1790700000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);

    await q.query(
      `CREATE TYPE ${S}.idempotency_status AS ENUM ('PENDING','COMPLETED')`,
    );

    await q.query(`
      CREATE TABLE ${S}.idempotency_keys (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         uuid NOT NULL REFERENCES ${S}.users(id) ON DELETE CASCADE,
        key             varchar(255) NOT NULL,
        request_hash    varchar(64) NOT NULL,
        status          ${S}.idempotency_status NOT NULL DEFAULT 'PENDING',
        response_status int,
        response_body   text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT idempotency_keys_user_key_uq UNIQUE (user_id, key)
      )
    `);

    // Cheap cleanup target for a future cron: old COMPLETED rows can be pruned
    // after e.g. 7 days without affecting correctness (the client won't retry that long).
    await q.query(
      `CREATE INDEX idempotency_keys_created_at_idx ON ${S}.idempotency_keys (created_at)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`DROP TABLE IF EXISTS ${S}.idempotency_keys`);
    await q.query(`DROP TYPE IF EXISTS ${S}.idempotency_status`);
  }
}
