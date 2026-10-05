import { MigrationInterface, QueryRunner } from 'typeorm';
import { type PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresDataSourceOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class CreateLedgerSchema1790500000000 implements MigrationInterface {
  name = 'CreateLedgerSchema1790500000000';

  public async up(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);

    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // ---------- enum types ----------
    await q.query(
      `CREATE TYPE ${S}.wallet_status AS ENUM ('ACTIVE','FROZEN','CLOSED')`,
    );
    await q.query(
      `CREATE TYPE ${S}.transaction_type AS ENUM ('DEPOSIT','TRANSFER','WITHDRAWAL','REVERSAL')`,
    );
    await q.query(
      `CREATE TYPE ${S}.transaction_status AS ENUM ('PENDING','POSTED','FAILED')`,
    );
    await q.query(
      `CREATE TYPE ${S}.ledger_direction AS ENUM ('DEBIT','CREDIT')`,
    );

    // ---------- wallets ----------
    await q.query(`
      CREATE TABLE ${S}.wallets (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid,
        system_code  varchar(64) UNIQUE,
        currency     char(3) NOT NULL,
        status       ${S}.wallet_status NOT NULL DEFAULT 'ACTIVE',
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wallets_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES ${S}.users(id) ON DELETE RESTRICT,
        -- exactly one of user_id / system_code
        CONSTRAINT wallets_owner_chk CHECK ((user_id IS NOT NULL) <> (system_code IS NOT NULL)),
        -- target for the composite FK from ledger_entries (keeps currency consistent)
        CONSTRAINT wallets_id_currency_uq UNIQUE (id, currency)
      )
    `);
    await q.query(`CREATE INDEX wallets_user_id_idx ON ${S}.wallets (user_id)`);

    // ---------- transactions ----------
    await q.query(`
      CREATE TABLE ${S}.transactions (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type                     ${S}.transaction_type NOT NULL,
        status                   ${S}.transaction_status NOT NULL DEFAULT 'POSTED',
        reverses_transaction_id  uuid UNIQUE REFERENCES ${S}.transactions(id),
        initiated_by             uuid REFERENCES ${S}.users(id),
        metadata                 jsonb,
        created_at               timestamptz NOT NULL DEFAULT now(),
        -- a REVERSAL must reference an original, and only a REVERSAL may
        CONSTRAINT transactions_reversal_chk
          CHECK ((type = 'REVERSAL') = (reverses_transaction_id IS NOT NULL))
      )
    `);

    // ---------- ledger_entries ----------
    await q.query(`
      CREATE TABLE ${S}.ledger_entries (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id uuid NOT NULL REFERENCES ${S}.transactions(id),
        wallet_id      uuid NOT NULL,
        direction      ${S}.ledger_direction NOT NULL,
        amount         bigint NOT NULL,
        currency       char(3) NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ledger_entries_amount_chk CHECK (amount > 0),
        -- entry currency must equal the wallet's currency
        CONSTRAINT ledger_entries_wallet_fk
          FOREIGN KEY (wallet_id, currency) REFERENCES ${S}.wallets (id, currency),
        CONSTRAINT ledger_entries_tx_wallet_dir_uq
          UNIQUE (transaction_id, wallet_id, direction)
      )
    `);
    // Covering index so balance SUMs can be index-only scans.
    await q.query(`
      CREATE INDEX ledger_entries_wallet_idx
        ON ${S}.ledger_entries (wallet_id, direction) INCLUDE (amount)
    `);

    // ---------- append-only enforcement ----------
    // NOTE: trigger names are never schema-qualified in Postgres (they live on
    // the table); only the table and the function are.
    await q.query(`
      CREATE FUNCTION ${S}.ledger_entries_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger_entries is append-only (% is not allowed)', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`
      CREATE TRIGGER ledger_entries_no_update_delete
      BEFORE UPDATE OR DELETE ON ${S}.ledger_entries
      FOR EACH ROW EXECUTE FUNCTION ${S}.ledger_entries_immutable()
    `);
    await q.query(`
      CREATE TRIGGER ledger_entries_no_truncate
      BEFORE TRUNCATE ON ${S}.ledger_entries
      FOR EACH STATEMENT EXECUTE FUNCTION ${S}.ledger_entries_immutable()
    `);

    // ---------- debits = credits per transaction, checked at COMMIT ----------
    await q.query(`
      CREATE FUNCTION ${S}.ledger_check_transaction_balanced() RETURNS trigger AS $$
      DECLARE
        d bigint;
        c bigint;
      BEGIN
        SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0),
               COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)
          INTO d, c
          FROM ${S}.ledger_entries
         WHERE transaction_id = NEW.transaction_id;

        IF d <> c THEN
          RAISE EXCEPTION 'Transaction % is unbalanced: debits=% credits=%',
            NEW.transaction_id, d, c;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await q.query(`
      CREATE CONSTRAINT TRIGGER ledger_entries_balanced
      AFTER INSERT ON ${S}.ledger_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ${S}.ledger_check_transaction_balanced()
    `);

    // ---------- derived balances (credits - debits) ----------
    await q.query(`
      CREATE VIEW ${S}.wallet_balances AS
      SELECT w.id AS wallet_id,
             w.currency,
             COALESCE(SUM(CASE le.direction WHEN 'CREDIT' THEN le.amount ELSE -le.amount END), 0)::bigint AS balance
        FROM ${S}.wallets w
        LEFT JOIN ${S}.ledger_entries le ON le.wallet_id = w.id
       GROUP BY w.id, w.currency
    `);

    // ---------- seed system wallets ----------
    await q.query(`
      INSERT INTO ${S}.wallets (system_code, currency) VALUES ('PLATFORM_CASH_USD', 'USD')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    const S = schemaOf(q);

    await q.query(`DROP VIEW IF EXISTS ${S}.wallet_balances`);
    await q.query(
      `DROP TRIGGER IF EXISTS ledger_entries_balanced ON ${S}.ledger_entries`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ${S}.ledger_entries`,
    );
    await q.query(
      `DROP TRIGGER IF EXISTS ledger_entries_no_update_delete ON ${S}.ledger_entries`,
    );
    await q.query(
      `DROP FUNCTION IF EXISTS ${S}.ledger_check_transaction_balanced()`,
    );
    await q.query(`DROP FUNCTION IF EXISTS ${S}.ledger_entries_immutable()`);
    await q.query(`DROP TABLE IF EXISTS ${S}.ledger_entries`);
    await q.query(`DROP TABLE IF EXISTS ${S}.transactions`);
    await q.query(`DROP TABLE IF EXISTS ${S}.wallets`);
    await q.query(`DROP TYPE IF EXISTS ${S}.ledger_direction`);
    await q.query(`DROP TYPE IF EXISTS ${S}.transaction_status`);
    await q.query(`DROP TYPE IF EXISTS ${S}.transaction_type`);
    await q.query(`DROP TYPE IF EXISTS ${S}.wallet_status`);
  }
}
