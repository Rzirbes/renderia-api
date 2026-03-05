import { Queue } from 'bullmq';

export const rendersQueue = new Queue('renders', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});
