import { Injectable, NotFoundException } from '@nestjs/common';
import { RendersService } from './renders.service';
import { GeminiRenderService } from './gemini-render.service';
import { StorageService } from './storage.service';
import { RENDER_PRESETS, RenderPresetId } from './render-presets';

@Injectable()
export class RenderProcessorService {
  constructor(
    private readonly rendersService: RendersService,
    private readonly geminiRenderService: GeminiRenderService,
    private readonly storageService: StorageService,
  ) {}

  async processRender(userId: string, renderId: string) {
    const render = await this.rendersService.process(userId, renderId);

    if (!render) {
      throw new NotFoundException('Render não encontrado');
    }

    if (!render.originalImagePath) {
      await this.rendersService.fail(userId, renderId, {
        code: 'ORIGINAL_IMAGE_PATH_MISSING',
        message: 'Caminho da imagem original não encontrado',
      });
      return;
    }

    try {
      const originalFile = await this.storageService.readLocalFile(
        render.originalImagePath,
        render.sourceImageMimeType ?? 'image/png',
      );

      const presetId = (render.presetId as RenderPresetId) ?? 'daylight_9am';
      const preset = RENDER_PRESETS[presetId];

      const result = await this.geminiRenderService.generateFromImage({
        fileBuffer: originalFile.buffer,
        mimeType: originalFile.mimeType,
        prompt: render.prompt ?? undefined,
        presetId,
      });

      if (!result.ok) {
        await this.rendersService.fail(userId, renderId, {
          code: 'GEMINI_NO_IMAGE',
          message: result.error,
          meta: { text: result.text },
        });
        return;
      }

      const uploaded = await this.storageService.uploadGeneratedImage({
        renderId,
        buffer: Buffer.from(result.imageBase64, 'base64'),
        mimeType: result.mimeType,
      });

      await this.rendersService.markAsDone(userId, renderId, {
        generatedImageUrl: uploaded.url,
        generatedImagePath: uploaded.path,
        outputImageMimeType: uploaded.mimeType,
        sourceImageMimeType: originalFile.mimeType,
        providerModel: preset.model ?? null,
      });
    } catch (error) {
      await this.rendersService.fail(userId, renderId, {
        code: 'PROCESSING_ERROR',
        message:
          error instanceof Error ? error.message : 'Erro ao processar render',
      });
    }
  }
}
