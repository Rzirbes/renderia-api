import { Queue } from 'bullmq';
import { bullConnection } from '../../queue/connection';

export const rendersQueue = new Queue('renders', {
  connection: bullConnection,
});
