import { MigrationInterface, QueryRunner } from 'typeorm';
import { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresDataSourceOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class CreateAdminAction1792000000000 implements MigrationInterface {
  name = 'CreateAdminAction1792000000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(`
      CREATE TABLE ${S}.admin_actions (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id  uuid NOT NULL REFERENCES ${S}.users(id),
        actor_role     varchar(16) NOT NULL,
        action         varchar(64) NOT NULL,
        target_type    varchar(32),
        target_id      uuid,
        details        jsonb,
        ip_address     varchar(64),
        created_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(
      `CREATE INDEX admin_actions_actor_idx ON ${S}.admin_actions (actor_user_id)`,
    );
    await q.query(
      `CREATE INDEX admin_actions_action_idx ON ${S}.admin_actions (action)`,
    );
    await q.query(
      `CREATE INDEX admin_actions_created_at_idx ON ${S}.admin_actions (created_at DESC)`,
    );

    // append-only, same reasoning as ledger_entries - an audit log that can
    // be edited after the fact is not an audit log
    await q.query(`
      CREATE OR REPLACE FUNCTION ${S}.admin_actions_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'admin_actions is append-only (% is not allowed)', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`
      CREATE TRIGGER admin_actions_no_update_delete
      BEFORE UPDATE OR DELETE ON ${S}.admin_actions
      FOR EACH ROW EXECUTE FUNCTION ${S}.admin_actions_immutable()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);
    await q.query(
      `DROP TRIGGER IF EXISTS admin_actions_no_update_delete ON ${S}.admin_actions`,
    );
    await q.query(`DROP FUNCTION IF EXISTS ${S}.admin_actions_immutable()`);
    await q.query(`DROP TABLE IF EXISTS ${S}.admin_actions`);
  }
}
