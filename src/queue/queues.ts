// src/queue/queues.ts
import { Queue } from 'bullmq';
import { bullConnection } from './connection';

export const queues = {
  renders: new Queue('renders', { connection: bullConnection }),
};
