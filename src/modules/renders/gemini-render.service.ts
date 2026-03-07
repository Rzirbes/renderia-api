import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { GoogleGenAI, Part } from '@google/genai';

import { RENDER_PRESETS, RenderPresetId } from './render-presets';
import {
  GenConfig,
  hasInlineImageData,
  extractTextParts,
} from './types/gemini.types';

@Injectable()
export class GeminiRenderService {
  private getAi() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException(
        'GEMINI_API_KEY não configurada no servidor.',
      );
    }

    return new GoogleGenAI({ apiKey });
  }

  private getErrorMessage(err: unknown) {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;

    try {
      return JSON.stringify(err);
    } catch {
      return 'Erro na renderização IA';
    }
  }

  async generateFromImage(params: {
    fileBuffer: Buffer;
    mimeType: string;
    prompt?: string;
    presetId: RenderPresetId;
  }) {
    try {
      const ai = this.getAi();

      const preset = RENDER_PRESETS[params.presetId];

      if (!preset) {
        throw new InternalServerErrorException('Preset de render inválido.');
      }

      const base64Image = params.fileBuffer.toString('base64');

      const requestText =
        params.prompt?.trim() ||
        'Improve realism only. Do not add new objects.';

      const finalPrompt = [
        preset.systemPrompt.trim(),
        '',
        'USER INSTRUCTION:',
        requestText,
        '',
        'FINAL OUTPUT RULES:',
        '- Preserve the original composition exactly.',
        '- Improve realism, materials, lighting, reflections, shadows, and sharpness only within the preset rules.',
        '- Return IMAGE only.',
      ].join('\n');

      const contents: Part[] = [
        { text: finalPrompt },
        {
          inlineData: {
            mimeType: params.mimeType,
            data: base64Image,
          },
        },
      ];

      const config: GenConfig = {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: preset.aspectRatio ?? '16:9',
          imageSize: preset.imageSize ?? '2K',
        },
      };

      const response = await ai.models.generateContent({
        model: preset.model ?? 'gemini-3-pro-image-preview',
        contents,
        config,
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find(hasInlineImageData);

      if (!imagePart) {
        return {
          ok: false as const,
          error: 'Modelo não retornou imagem',
          text: extractTextParts(parts),
        };
      }

      return {
        ok: true as const,
        imageBase64: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType ?? 'image/png',
        presetId: params.presetId,
        text: extractTextParts(parts),
      };
    } catch (error) {
      throw new InternalServerErrorException(this.getErrorMessage(error));
    }
  }
}
