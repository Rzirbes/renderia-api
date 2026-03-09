-- AlterTable
ALTER TABLE "Render" ADD COLUMN     "parentRenderId" TEXT;

-- CreateIndex
CREATE INDEX "Render_parentRenderId_idx" ON "Render"("parentRenderId");

-- AddForeignKey
ALTER TABLE "Render" ADD CONSTRAINT "Render_parentRenderId_fkey" FOREIGN KEY ("parentRenderId") REFERENCES "Render"("id") ON DELETE SET NULL ON UPDATE CASCADE;
