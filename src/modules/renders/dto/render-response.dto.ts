import { RenderStatus } from '@prisma/client';

export type RenderResponse = {
  id: string;
  userId: string;

  originalImageUrl: string;
  generatedImageUrl: string | null;
  prompt: string | null;

  status: RenderStatus;
  creditsUsed: number;

  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export function toRenderResponse(r: {
  id: string;
  userId: string;
  originalImageUrl: string;
  generatedImageUrl: string | null;
  prompt: string | null;
  status: RenderStatus;
  creditsUsed: number;
  createdAt: Date;
  updatedAt: Date;
}): RenderResponse {
  return {
    id: r.id,
    userId: r.userId,
    originalImageUrl: r.originalImageUrl,
    generatedImageUrl: r.generatedImageUrl,
    prompt: r.prompt,
    status: r.status,
    creditsUsed: r.creditsUsed,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
