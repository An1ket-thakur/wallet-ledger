import { MigrationInterface, QueryRunner } from 'typeorm';
import { type PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresConnectionOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class CreateWebhookEvents1790900000000 implements MigrationInterface {
  name = 'CreateWebhookEvents1790900000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`
      CREATE TABLE ${S}.webhook_events (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider           varchar(64) NOT NULL,
        provider_event_id  varchar(255) NOT NULL,
        transaction_id     uuid REFERENCES ${S}.transactions(id),
        received_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT webhook_events_provider_event_uq UNIQUE (provider, provider_event_id)
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`DROP TABLE IF EXISTS ${S}.webhook_events`);
  }
}
