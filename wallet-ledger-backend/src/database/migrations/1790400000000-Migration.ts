import { MigrationInterface, QueryRunner } from 'typeorm';
import { type PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

function schemaOf(q: QueryRunner): string {
  const name =
    (q.connection.options as PostgresDataSourceOptions).schema ?? 'public';
  return `"${name.replace(/"/g, '""')}"`;
}

export class Migration1790400000000 implements MigrationInterface {
  name = 'Migration1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const S = schemaOf(queryRunner);
    await queryRunner.query(
      `CREATE TYPE ${S}."user_role" AS ENUM('CUSTOMER', 'SUPPORT', 'ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TABLE ${S}."users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" text NOT NULL, "password_hash" text NOT NULL, "full_name" text NOT NULL, "role" ${S}."user_role" NOT NULL DEFAULT 'CUSTOMER', "disabled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON ${S}."users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ace513fa30d485cfd25c11a9e4" ON ${S}."users"  ("role") `,
    );
    await queryRunner.query(
      `CREATE TABLE ${S}."refresh_tokens" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "token_hash" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON ${S}."refresh_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE ${S}."refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES ${S}."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const S = schemaOf(queryRunner);
    await queryRunner.query(
      `ALTER TABLE ${S}."refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(`DROP INDEX ${S}."IDX_3ddc983c5f7bcf132fd8732c3f"`);
    await queryRunner.query(`DROP TABLE ${S}."refresh_tokens"`);
    await queryRunner.query(`DROP INDEX ${S}."IDX_ace513fa30d485cfd25c11a9e4"`);
    await queryRunner.query(`DROP INDEX ${S}."IDX_97672ac88f789774dd47f7c8be"`);
    await queryRunner.query(`DROP TABLE ${S}."users"`);
    await queryRunner.query(`DROP TYPE ${S}."user_role"`);
  }
}
