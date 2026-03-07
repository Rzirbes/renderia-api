import { Module } from '@nestjs/common';

import { PrismaService } from '../../database/prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { RendersService } from './renders.service';
import { RendersController } from './renders.controller';
import { RenderProcessorService } from './render-processor.service';
import { GeminiRenderService } from './gemini-render.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [RendersController],
  providers: [
    PrismaService,
    RendersService,
    RenderProcessorService,
    GeminiRenderService,
    StorageService,
    CreditsService,
  ],

  exports: [RendersService],
})
export class RendersModule {}
