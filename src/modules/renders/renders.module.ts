import { Module } from '@nestjs/common';
import { RendersController } from './renders.controller';
import { RendersService } from './renders.service';
import { RenderProcessorService } from './render-processor.service';
import { GeminiRenderService } from './gemini-render.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [RendersController],
  providers: [
    RendersService,
    RenderProcessorService,
    GeminiRenderService,
    StorageService,
  ],
  exports: [RendersService, RenderProcessorService],
})
export class RendersModule {}
