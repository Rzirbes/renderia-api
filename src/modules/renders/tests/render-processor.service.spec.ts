jest.mock('../renders.queue', () => ({ rendersQueue: { add: jest.fn() } }));

import { writeFile } from 'node:fs/promises';
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

describe('RenderProcessorService (arquivos autorizados)', () => {
  let sandbox: Awaited<ReturnType<typeof createSandbox>>;
  let service: RenderProcessorService;

  const rendersService = {
    process: jest.fn(),
    fail: jest.fn(),
    markAsDone: jest.fn(),
  };
  const gemini = { generateFromImage: jest.fn() };

  const baseRender = {
    id: RENDER_ID,
    userId: USER_A,
    parentRenderId: null,
    prompt: null,
    presetId: 'daylight_9am',
    sourceImageMimeType: 'image/png',
  };

  beforeEach(async () => {
    sandbox = await createSandbox();
    jest.clearAllMocks();
    service = new RenderProcessorService(
      rendersService as unknown as RendersService,
      gemini as unknown as GeminiRenderService,
      new StorageService(),
    );
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  it.each([
    ['caminho absoluto', '/etc/passwd'],
    ['traversal', '../fake-secret.txt'],
    ['traversal dentro de uploads', 'uploads/originals/../../fake-secret.txt'],
    ['upload de outro usuário', `uploads/originals/${USER_B}/${FILE_ID}.png`],
    ['arquivo inexistente', `uploads/originals/${USER_A}/${FILE_ID}.png`],
  ])(
    'marca ERROR sem chamar o Gemini quando o original é %s',
    async (_label, originalImagePath) => {
      await writeFile(
        join(sandbox.root, `uploads/originals/${USER_B}/${FILE_ID}.png`),
        PNG_BYTES,
      );
      rendersService.process.mockResolvedValue({
        ...baseRender,
        originalImagePath,
      });

      await service.processRender(USER_A, RENDER_ID);

      expect(gemini.generateFromImage).not.toHaveBeenCalled();
      expect(rendersService.fail).toHaveBeenCalledWith(USER_A, RENDER_ID, {
        code: 'ORIGINAL_IMAGE_INVALID',
        message: 'Imagem original inválida, inacessível ou não autorizada.',
      });
      const failArgs = JSON.stringify(rendersService.fail.mock.calls);
      expect(failArgs).not.toContain('FAKE_SECRET');
    },
  );

  it('envia ao Gemini o arquivo autorizado com MIME detectado pelo conteúdo', async () => {
    const ownPath = `uploads/originals/${USER_A}/${FILE_ID}.png`;
    await writeFile(join(sandbox.root, ownPath), PNG_BYTES);
    rendersService.process.mockResolvedValue({
      ...baseRender,
      // MIME gravado divergente não é confiado.
      sourceImageMimeType: 'text/plain',
      originalImagePath: ownPath,
    });
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
