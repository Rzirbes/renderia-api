import { Module } from '@nestjs/common';

import { PrismaService } from '../../database/prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { RendersController } from './renders.controller';
import { RendersService } from './renders.service';

@Module({
  controllers: [RendersController],
  providers: [RendersService, PrismaService, CreditsService],
  exports: [RendersService],
})
export class RendersModule {}
