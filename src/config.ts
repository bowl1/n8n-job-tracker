import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_LOG_LEVEL: z.string().default('info'),
  POSTGRES_DB: z.string().default('job_tracker'),
  POSTGRES_USER: z.string().default('job_tracker'),
  POSTGRES_PASSWORD: z.string().default('change_me'),
  POSTGRES_PORT: z.coerce.number().default(5432),
  N8N_ENCRYPTION_KEY: z.string().min(8).default('replace_with_strong_secret'),
  N8N_HOST: z.string().default('localhost'),
  N8N_WEBHOOK_URL: z.string().default('http://localhost:5678/'),
  JOB_CRAWL_SCHEDULE: z.string().default('0 7,19 * * *'),
  LINKEDIN_PUBLIC_MODE: z.coerce.boolean().default(true),
  MAX_RETRIES: z.coerce.number().default(2),
  CANDIDATE_PROFILE_VERSION: z.string().default('A1'),
});

export const appConfig = envSchema.parse(process.env);
