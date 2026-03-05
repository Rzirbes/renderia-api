// src/queue/queues.ts
import { Queue } from 'bullmq';
import { bullConnection } from 'src/queue/connection';

export const rendersQueue = new Queue('renders', {
  connection: bullConnection,
});
