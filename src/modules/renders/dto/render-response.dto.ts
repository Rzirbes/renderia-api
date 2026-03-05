import { RenderStatus } from '@prisma/client';

export type RenderResponse = {
  id: string;
  userId: string;

  originalImageUrl: string;
  generatedImageUrl: string | null;
  prompt: string | null;

  status: RenderStatus;
  creditsUsed: number;

  // rastreabilidade
  traceId: string | null; // ✅ aqui
  clientRequestId: string | null;
  providerJobId: string | null;
  providerRequestId: string | null;

  // timeline
  startedAt: string | null; // ISO
  completedAt: string | null; // ISO
  failedAt: string | null; // ISO

  // ERROR reason
  errorCode: string | null;
  errorMessage: string | null;

  createdAt: string; // ISO
  updatedAt: string; // ISO
};

type RenderToResponseInput = {
  id: string;
  userId: string;

  originalImageUrl: string;
  generatedImageUrl: string | null;
  prompt: string | null;

  status: RenderStatus;
  creditsUsed: number;

  traceId: string | null; // ✅ aqui
  clientRequestId: string | null;
  providerJobId: string | null;
  providerRequestId: string | null;

  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;

  errorCode: string | null;
  errorMessage: string | null;

  createdAt: Date;
  updatedAt: Date;
};

export function toRenderResponse(r: RenderToResponseInput): RenderResponse {
  return {
    id: r.id,
    userId: r.userId,
    originalImageUrl: r.originalImageUrl,
    generatedImageUrl: r.generatedImageUrl,
    prompt: r.prompt,

    status: r.status,
    creditsUsed: r.creditsUsed,

    traceId: r.traceId, // ✅ agora compila
    clientRequestId: r.clientRequestId,
    providerJobId: r.providerJobId,
    providerRequestId: r.providerRequestId,

    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    failedAt: r.failedAt ? r.failedAt.toISOString() : null,

    errorCode: r.errorCode,
    errorMessage: r.errorMessage,

    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
