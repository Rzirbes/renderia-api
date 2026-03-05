-- CreateEnum
CREATE TYPE "RenderEventType" AS ENUM ('CREATED', 'PROCESSING_STARTED', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Render" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "errorMeta" JSONB,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "providerJobId" TEXT,
ADD COLUMN     "providerRequestId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "traceId" TEXT;

-- CreateTable
CREATE TABLE "RenderEvent" (
    "id" TEXT NOT NULL,
    "renderId" TEXT NOT NULL,
    "type" "RenderEventType" NOT NULL,
    "fromStatus" "RenderStatus",
    "toStatus" "RenderStatus",
    "message" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenderEvent_renderId_createdAt_idx" ON "RenderEvent"("renderId", "createdAt");

-- CreateIndex
CREATE INDEX "Render_traceId_idx" ON "Render"("traceId");

-- CreateIndex
CREATE INDEX "Render_clientRequestId_idx" ON "Render"("clientRequestId");

-- CreateIndex
CREATE INDEX "Render_status_createdAt_idx" ON "Render"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RenderEvent" ADD CONSTRAINT "RenderEvent_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE CASCADE ON UPDATE CASCADE;
