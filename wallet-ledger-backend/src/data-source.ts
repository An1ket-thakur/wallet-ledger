import { DataSource, type DataSourceOptions } from 'typeorm';
import { config as loadEnv } from 'dotenv';

loadEnv({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  quiet: true,
});

export const typeOrmConfig: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  schema: process.env.DB_SCHEMA,
  extra: {
    options: `-c search_path=${process.env.DB_SCHEMA}`,
  },
  entities: ['src/database/entities/*.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

export default new DataSource(typeOrmConfig);
