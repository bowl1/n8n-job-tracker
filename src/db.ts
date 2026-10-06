import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { appConfig } from './config.js';

export const pgConfig: PoolConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || appConfig.POSTGRES_PORT),
  database: process.env.POSTGRES_DB || appConfig.POSTGRES_DB,
  user: process.env.POSTGRES_USER || appConfig.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD || appConfig.POSTGRES_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export const db = new Pool(pgConfig);

export async function query<T extends QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database ping failed', error);
    return false;
  }
}
