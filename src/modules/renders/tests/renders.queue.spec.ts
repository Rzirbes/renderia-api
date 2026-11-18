const queueMock = { add: jest.fn(), getJob: jest.fn() };

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => queueMock),
}));

import { enqueueRenderJob, RENDER_JOB_NAME } from '../renders.queue';
import { RENDER_ID, USER_A } from './sandbox.helper-spec';

describe('enqueueRenderJob', () => {
  const data = { renderId: RENDER_ID, userId: USER_A };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adiciona com jobId = renderId quando não existe job', async () => {
    queueMock.getJob.mockResolvedValue(undefined);

    await expect(enqueueRenderJob(data)).resolves.toBe('added');

    expect(queueMock.add).toHaveBeenCalledWith(
      RENDER_JOB_NAME,
      data,
      expect.objectContaining({ jobId: RENDER_ID, attempts: 3 }),
    );
  });

  it.each(['waiting', 'active', 'delayed', 'prioritized'])(
    'job %s: não adiciona outro (sem execução duplicada)',
    async (state) => {
      queueMock.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue(state),
        remove: jest.fn(),
      });

      await expect(enqueueRenderJob(data)).resolves.toBe('already-queued');
      expect(queueMock.add).not.toHaveBeenCalled();
    },
  );

  it.each(['failed', 'completed'])(
    'job terminal (%s): remove e re-adiciona (a execução é protegida pelo claim no banco)',
    async (state) => {
      const remove = jest.fn();
      queueMock.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue(state),
        remove,
      });

      await expect(enqueueRenderJob(data)).resolves.toBe('re-added');
      expect(remove).toHaveBeenCalledTimes(1);
      expect(queueMock.add).toHaveBeenCalledTimes(1);
    },
  );

  it('propaga falha do Redis (o chamador registra o evento)', async () => {
    queueMock.getJob.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(enqueueRenderJob(data)).rejects.toThrow('ECONNREFUSED');
  });
});
