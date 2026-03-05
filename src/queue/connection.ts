// src/queue/connection.ts
import type { ConnectionOptions } from 'bullmq';

export const bullConnection: ConnectionOptions = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_URL ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };
