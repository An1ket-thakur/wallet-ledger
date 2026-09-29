import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1790577416325 implements MigrationInterface {
  name = 'Migration1790577416325';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "nest_wallet_ledger_engine"."user_role" AS ENUM('CUSTOMER', 'SUPPORT', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TABLE "nest_wallet_ledger_engine"."users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" text NOT NULL, "password_hash" text NOT NULL, "full_name" text NOT NULL, "role" "nest_wallet_ledger_engine"."user_role" NOT NULL DEFAULT 'CUSTOMER', "disabled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "nest_wallet_ledger_engine"."users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ace513fa30d485cfd25c11a9e4" ON "nest_wallet_ledger_engine"."users"  ("role") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nest_wallet_ledger_engine"."refresh_tokens" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "token_hash" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON "nest_wallet_ledger_engine"."refresh_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "nest_wallet_ledger_engine"."refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "nest_wallet_ledger_engine"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nest_wallet_ledger_engine"."refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "nest_wallet_ledger_engine"."IDX_3ddc983c5f7bcf132fd8732c3f"`,
    );
    await queryRunner.query(
      `DROP TABLE "nest_wallet_ledger_engine"."refresh_tokens"`,
    );
    await queryRunner.query(
      `DROP INDEX "nest_wallet_ledger_engine"."IDX_ace513fa30d485cfd25c11a9e4"`,
    );
    await queryRunner.query(
      `DROP INDEX "nest_wallet_ledger_engine"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(`DROP TABLE "nest_wallet_ledger_engine"."users"`);
    await queryRunner.query(
      `DROP TYPE "nest_wallet_ledger_engine"."user_role"`,
    );
  }
}
