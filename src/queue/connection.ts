// src/queue/connection.ts
import type { ConnectionOptions } from 'bullmq';

export const bullConnection: ConnectionOptions = {
  url: process.env.REDIS_URL,
};
