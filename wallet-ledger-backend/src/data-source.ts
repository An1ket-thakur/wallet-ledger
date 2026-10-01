import { DataSource, DataSourceOptions } from 'typeorm';
import { config as loadEnv } from 'dotenv';

loadEnv();

export const typeOrmConfig: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  schema: process.env.DB_SCHEMA,
  extra: {
    options: `-c search_path=${process.env.DB_SCHEMA}`,
  },
  entities: ['src/database/entities/*.ts'],
  migrations: ['src/database/migrations/*.ts'],
  // Never true outside local prototyping - the ledger tables especially need
  // real, reviewed migrations rather than auto-sync once money logic lands.
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

// Exported separately for the TypeORM CLI (migration generate/run), which
// needs a plain DataSource instance rather than the Nest-wrapped module.
export default new DataSource(typeOrmConfig);
