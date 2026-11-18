import { Injectable, Logger } from '@nestjs/common';
import { RendersService } from './renders.service';
import { GeminiRenderService } from './gemini-render.service';
import { StorageService, detectImageMimeType } from './storage.service';
import { RENDER_PRESETS, RenderPresetId } from './render-presets';

export type ProcessRenderOutcome =
  | 'done'
  | 'failed'
  | 'not-found'
  | 'not-pending'
  | 'insufficient-credits'
  | 'lost-race';

/**
 * Executa um render. Deve ser chamado SOMENTE pelo worker do BullMQ.
 *
 * Contrato com os retries do BullMQ:
 * - Erros ANTES do claim (ex.: banco indisponível) são relançados: nada foi
 *   cobrado nem enviado ao Gemini, então o retry é seguro.
 * - Depois do claim nenhum erro é relançado: toda falha vira ERROR com
 *   reembolso. Assim um retry nunca dispara uma segunda chamada ao Gemini.
 */
@Injectable()
export class RenderProcessorService {
  private readonly logger = new Logger(RenderProcessorService.name);

  constructor(
    private readonly rendersService: RendersService,
    private readonly geminiRenderService: GeminiRenderService,
    private readonly storageService: StorageService,
  ) {}

  async processRender(
    userId: string,
    renderId: string,
  ): Promise<ProcessRenderOutcome> {
    const claim = await this.rendersService.claimForProcessing(
      userId,
      renderId,
    );

    if (claim.outcome !== 'claimed') {
      this.logger.log(
        `Render ${renderId} not processed by this execution: ${claim.outcome}`,
      );
      return claim.outcome;
    }

    const render = claim.render;

    try {
      return await this.runClaimed(userId, renderId, render);
    } catch (error) {
      // Falha inesperada após o claim (storage, banco ao concluir etc.).
      await this.rendersService.failProcessing(userId, renderId, {
        code: 'PROCESSING_ERROR',
        message:
          error instanceof Error ? error.message : 'Erro ao processar render',
      });
      return 'failed';
    }
  }

  private async runClaimed(
    userId: string,
    renderId: string,
    render: {
      userId: string;
      parentRenderId: string | null;
      originalImagePath: string | null;
      presetId: string | null;
      prompt: string | null;
    },
  ): Promise<ProcessRenderOutcome> {
    if (!render.originalImagePath) {
      await this.rendersService.failProcessing(userId, renderId, {
        code: 'ORIGINAL_IMAGE_PATH_MISSING',
        message: 'Caminho da imagem original não encontrado',
      });
      return 'failed';
    }

    let originalFile: { buffer: Buffer; mimeType: string };
    try {
      originalFile = await this.storageService.readStoredImage(
        render.originalImagePath,
        { userId: render.userId, parentRenderId: render.parentRenderId },
      );
    } catch {
      // Mensagem genérica: não expõe caminho nem conteúdo do arquivo.
      await this.rendersService.failProcessing(userId, renderId, {
        code: 'ORIGINAL_IMAGE_INVALID',
        message: 'Imagem original inválida, inacessível ou não autorizada.',
      });
      return 'failed';
    }

    const presetId = (render.presetId as RenderPresetId) ?? 'daylight_9am';
    const preset = RENDER_PRESETS[presetId];

    let result: Awaited<ReturnType<GeminiRenderService['generateFromImage']>>;
    try {
      result = await this.geminiRenderService.generateFromImage({
        fileBuffer: originalFile.buffer,
        mimeType: originalFile.mimeType,
        prompt: render.prompt ?? undefined,
        presetId,
      });
    } catch (error) {
      await this.rendersService.failProcessing(userId, renderId, {
        code: 'GEMINI_ERROR',
        message:
          error instanceof Error ? error.message : 'Erro na renderização IA',
      });
      return 'failed';
    }

    if (!result.ok || !result.imageBase64) {
      await this.rendersService.failProcessing(userId, renderId, {
        code: 'GEMINI_NO_IMAGE',
        message: result.ok ? 'Modelo retornou imagem vazia' : result.error,
        meta: { text: result.text ?? null },
      });
      return 'failed';
    }

    // Confirma que o retorno é de fato uma imagem antes de concluir.
    const outputBuffer = Buffer.from(result.imageBase64, 'base64');
    const outputMimeType = detectImageMimeType(outputBuffer);
    if (!outputMimeType) {
      await this.rendersService.failProcessing(userId, renderId, {
        code: 'GEMINI_INVALID_IMAGE',
        message: 'Modelo retornou um arquivo de imagem inválido',
      });
      return 'failed';
    }

    const uploaded = await this.storageService.uploadGeneratedImage({
      renderId,
      buffer: outputBuffer,
      mimeType: outputMimeType,
    });

    const completion = await this.rendersService.markAsDone(userId, renderId, {
      generatedImageUrl: uploaded.url,
      generatedImagePath: uploaded.path,
      outputImageMimeType: uploaded.mimeType,
      sourceImageMimeType: originalFile.mimeType,
      providerModel: preset.model ?? null,
    });

    if (!completion.completed) {
      // O render deixou de estar PROCESSING enquanto o Gemini respondia
      // (ex.: marcado como travado e reembolsado, ou removido pelo usuário).
      // Não entregamos a imagem: remove o arquivo órfão.
      this.logger.warn(
        `Render ${renderId} was no longer PROCESSING when completing; discarding output`,
      );
      await this.storageService.deleteGeneratedImage(uploaded.path);
      return 'lost-race';
    }

    return 'done';
  }
}
