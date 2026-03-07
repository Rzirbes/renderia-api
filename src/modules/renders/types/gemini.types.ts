import type { Part } from '@google/genai';

export type GenConfig = {
  responseModalities: ('TEXT' | 'IMAGE')[];
  imageConfig?: {
    aspectRatio?: '1:1' | '4:3' | '16:9';
    imageSize?: '1K' | '2K' | '4K';
  };
};

type InlineDataLike = {
  inlineData?: {
    data?: unknown;
    mimeType?: unknown;
  };
};

export function hasInlineImageData(
  part: Part,
): part is Part & { inlineData: { data: string; mimeType?: string } } {
  const p = part as unknown as InlineDataLike;

  return typeof p.inlineData?.data === 'string' && p.inlineData.data.length > 0;
}

type TextPartLike = { text?: unknown };

export function extractTextParts(parts: Part[]): string | null {
  const text = parts
    .map((p) => (p as TextPartLike).text)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join('\n')
    .trim();

  return text || null;
}
