-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RenderEventType" ADD VALUE 'QUEUE_ENQUEUE_FAILED';
ALTER TYPE "RenderEventType" ADD VALUE 'REQUEUED';

-- AlterTable
ALTER TABLE "Render" ADD COLUMN     "originalImagePath" TEXT,
ADD COLUMN     "outputImageMimeType" TEXT,
ADD COLUMN     "presetId" TEXT,
ADD COLUMN     "providerModel" TEXT,
ADD COLUMN     "sourceImageMimeType" TEXT;

-- CreateIndex
CREATE INDEX "Render_presetId_idx" ON "Render"("presetId");
