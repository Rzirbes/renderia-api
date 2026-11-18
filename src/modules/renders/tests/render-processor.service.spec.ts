jest.mock('../renders.queue', () => ({
  rendersQueue: { add: jest.fn() },
  enqueueRenderJob: jest.fn(),
}));

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RenderProcessorService } from '../render-processor.service';
import { RendersService } from '../renders.service';
import { GeminiRenderService } from '../gemini-render.service';
import { StorageService } from '../storage.service';
import {
  FILE_ID,
  PNG_BYTES,
  RENDER_ID,
  USER_A,
  USER_B,
  createSandbox,
} from './sandbox.helper-spec';

describe('RenderProcessorService', () => {
  let sandbox: Awaited<ReturnType<typeof createSandbox>>;
  let service: RenderProcessorService;
  let storage: StorageService;

  const rendersService = {
    claimForProcessing: jest.fn(),
    failProcessing: jest.fn(),
    markAsDone: jest.fn(),
  };
  const gemini = { generateFromImage: jest.fn() };

  const ownPath = `uploads/originals/${USER_A}/${FILE_ID}.png`;

  const baseRender = {
    id: RENDER_ID,
    userId: USER_A,
    parentRenderId: null,
    prompt: null,
    presetId: 'daylight_9am',
    sourceImageMimeType: 'image/png',
    originalImagePath: ownPath,
  };

  const geminiOk = () => ({
    ok: true,
    imageBase64: PNG_BYTES.toString('base64'),
    mimeType: 'image/png',
    presetId: 'daylight_9am',
    text: null,
  });

  const claimed = (overrides: Record<string, unknown> = {}) => ({
    outcome: 'claimed',
    render: { ...baseRender, ...overrides },
  });

  beforeEach(async () => {
    sandbox = await createSandbox();
    jest.clearAllMocks();
    storage = new StorageService();
    service = new RenderProcessorService(
      rendersService as unknown as RendersService,
      gemini as unknown as GeminiRenderService,
      storage,
    );
    await writeFile(join(sandbox.root, ownPath), PNG_BYTES);
    rendersService.failProcessing.mockResolvedValue({
      failed: true,
      refundedCredits: 1,
      render: null,
    });
    rendersService.markAsDone.mockResolvedValue({
      completed: true,
      render: null,
    });
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  describe('arquivos autorizados (Etapa 1)', () => {
    it.each([
      ['caminho absoluto', '/etc/passwd'],
      ['traversal', '../fake-secret.txt'],
      [
        'traversal dentro de uploads',
        'uploads/originals/../../fake-secret.txt',
      ],
      ['upload de outro usuário', `uploads/originals/${USER_B}/${FILE_ID}.png`],
      [
        'arquivo inexistente',
        `uploads/originals/${USER_A}/aaaaaaaa-0000-4000-8000-000000000000.png`,
      ],
    ])(
      'marca ERROR (com reembolso) sem chamar o Gemini quando o original é %s',
      async (_label, originalImagePath) => {
        await writeFile(
          join(sandbox.root, `uploads/originals/${USER_B}/${FILE_ID}.png`),
          PNG_BYTES,
        );
        rendersService.claimForProcessing.mockResolvedValue(
          claimed({ originalImagePath }),
        );

        const outcome = await service.processRender(USER_A, RENDER_ID);

        expect(outcome).toBe('failed');
        expect(gemini.generateFromImage).not.toHaveBeenCalled();
        expect(rendersService.failProcessing).toHaveBeenCalledWith(
          USER_A,
          RENDER_ID,
          {
            code: 'ORIGINAL_IMAGE_INVALID',
            message: 'Imagem original inválida, inacessível ou não autorizada.',
          },
        );
        const failArgs = JSON.stringify(
          rendersService.failProcessing.mock.calls,
        );
        expect(failArgs).not.toContain('FAKE_SECRET');
      },
    );

    it('envia ao Gemini o arquivo autorizado com MIME detectado pelo conteúdo', async () => {
      rendersService.claimForProcessing.mockResolvedValue(
        // MIME gravado divergente não é confiado.
        claimed({ sourceImageMimeType: 'text/plain' }),
      );
      gemini.generateFromImage.mockResolvedValue({
        ok: false,
        error: 'sem imagem',
        text: null,
      });

      await service.processRender(USER_A, RENDER_ID);

      expect(gemini.generateFromImage).toHaveBeenCalledTimes(1);
      const [args] = gemini.generateFromImage.mock.calls[0] as [
        { mimeType: string; fileBuffer: Buffer },
      ];
      expect(args.mimeType).toBe('image/png');
      expect(args.fileBuffer.equals(PNG_BYTES)).toBe(true);
    });
  });

  describe('idempotência', () => {
    it.each([
      ['DONE', 'not-pending'],
      ['PROCESSING', 'not-pending'],
      ['inexistente', 'not-found'],
      ['sem créditos', 'insufficient-credits'],
    ])(
      'render %s: não chama o Gemini nem altera estado',
      async (_label, outcome) => {
        rendersService.claimForProcessing.mockResolvedValue({
          outcome,
          render: baseRender,
        });

        await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
          outcome,
        );

        expect(gemini.generateFromImage).not.toHaveBeenCalled();
        expect(rendersService.failProcessing).not.toHaveBeenCalled();
        expect(rendersService.markAsDone).not.toHaveBeenCalled();
      },
    );

    it('execução repetida (retry do BullMQ/ /process) após DONE chama o Gemini uma única vez', async () => {
      rendersService.claimForProcessing
        .mockResolvedValueOnce(claimed())
        .mockResolvedValue({
          outcome: 'not-pending',
          render: { ...baseRender, status: 'DONE' },
        });
      gemini.generateFromImage.mockResolvedValue(geminiOk());

      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'done',
      );
      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'not-pending',
      );
      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'not-pending',
      );

      expect(gemini.generateFromImage).toHaveBeenCalledTimes(1);
      expect(rendersService.markAsDone).toHaveBeenCalledTimes(1);
    });

    it('erro antes do claim (ex.: banco fora) é relançado para retry e não chama o Gemini', async () => {
      rendersService.claimForProcessing.mockRejectedValue(
        new Error('db unavailable'),
      );

      await expect(service.processRender(USER_A, RENDER_ID)).rejects.toThrow(
        'db unavailable',
      );
      expect(gemini.generateFromImage).not.toHaveBeenCalled();
    });
  });

  describe('falhas após o claim (nunca relança → sem retry com nova chamada)', () => {
    it('falha do Gemini: ERROR com reembolso, sem relançar', async () => {
      rendersService.claimForProcessing.mockResolvedValue(claimed());
      gemini.generateFromImage.mockRejectedValue(new Error('503 overloaded'));

      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'failed',
      );

      expect(gemini.generateFromImage).toHaveBeenCalledTimes(1);
      expect(rendersService.failProcessing).toHaveBeenCalledWith(
        USER_A,
        RENDER_ID,
        { code: 'GEMINI_ERROR', message: '503 overloaded' },
      );
      expect(rendersService.markAsDone).not.toHaveBeenCalled();
    });

    it('Gemini sem imagem: ERROR GEMINI_NO_IMAGE', async () => {
      rendersService.claimForProcessing.mockResolvedValue(claimed());
      gemini.generateFromImage.mockResolvedValue({
        ok: false,
        error: 'Modelo não retornou imagem',
        text: 'recusado',
      });

      await service.processRender(USER_A, RENDER_ID);

      expect(rendersService.failProcessing).toHaveBeenCalledWith(
        USER_A,
        RENDER_ID,
        expect.objectContaining({ code: 'GEMINI_NO_IMAGE' }),
      );
      expect(rendersService.markAsDone).not.toHaveBeenCalled();
    });

    it('Gemini retorna bytes que não são imagem: não conclui o render', async () => {
      rendersService.claimForProcessing.mockResolvedValue(claimed());
      gemini.generateFromImage.mockResolvedValue({
        ...geminiOk(),
        imageBase64: Buffer.from('not an image').toString('base64'),
      });

      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'failed',
      );
      expect(rendersService.failProcessing).toHaveBeenCalledWith(
        USER_A,
        RENDER_ID,
        expect.objectContaining({ code: 'GEMINI_INVALID_IMAGE' }),
      );
      expect(rendersService.markAsDone).not.toHaveBeenCalled();
    });

    it('falha ao salvar a imagem: ERROR PROCESSING_ERROR e não marca DONE', async () => {
      rendersService.claimForProcessing.mockResolvedValue(claimed());
      gemini.generateFromImage.mockResolvedValue(geminiOk());
      jest
        .spyOn(storage, 'uploadGeneratedImage')
        .mockRejectedValue(new Error('disk full'));

      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'failed',
      );
      expect(rendersService.markAsDone).not.toHaveBeenCalled();
      expect(rendersService.failProcessing).toHaveBeenCalledWith(
        USER_A,
        RENDER_ID,
        { code: 'PROCESSING_ERROR', message: 'disk full' },
      );
    });

    it('sucesso: marca DONE somente depois de salvar a imagem', async () => {
      rendersService.claimForProcessing.mockResolvedValue(claimed());
      gemini.generateFromImage.mockResolvedValue(geminiOk());
      const uploadSpy = jest.spyOn(storage, 'uploadGeneratedImage');

      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'done',
      );

      expect(uploadSpy).toHaveBeenCalledTimes(1);
      const uploadOrder = uploadSpy.mock.invocationCallOrder[0];
      const doneOrder = rendersService.markAsDone.mock.invocationCallOrder[0];
      expect(uploadOrder).toBeLessThan(doneOrder);

      const files = await readdir(join(sandbox.root, 'uploads/renders'));
      expect(files).toHaveLength(1);
      expect(rendersService.failProcessing).not.toHaveBeenCalled();
    });

    it('render deixou de estar PROCESSING antes de concluir: descarta a imagem gerada', async () => {
      rendersService.claimForProcessing.mockResolvedValue(claimed());
      gemini.generateFromImage.mockResolvedValue(geminiOk());
      rendersService.markAsDone.mockResolvedValue({
        completed: false,
        render: { ...baseRender, status: 'ERROR' },
      });

      await expect(service.processRender(USER_A, RENDER_ID)).resolves.toBe(
        'lost-race',
      );

      const files = await readdir(join(sandbox.root, 'uploads/renders'));
      expect(files).toHaveLength(0);
    });
  });
});
