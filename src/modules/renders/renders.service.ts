import { Injectable } from '@nestjs/common';
import { Render, RenderStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateRenderDto } from './dto/create-render.dto';
import { ListRendersDto } from './dto/list-renders.dto';
import { PaginatedResult } from '../../common/pagination/paginated-result';

@Injectable()
export class RendersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateRenderDto): Promise<Render> {
    return this.prisma.render.create({
      data: {
        userId,
        originalImageUrl: dto.originalImageUrl,
        prompt: dto.prompt ?? null,
      },
    });
  }

  async list(
    userId: string,
    query: ListRendersDto,
  ): Promise<PaginatedResult<Render>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const where = { userId };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.render.count({ where }),
      this.prisma.render.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items, page, pageSize, total };
  }

  async findById(userId: string, id: string): Promise<Render | null> {
    return this.prisma.render.findFirst({
      where: { id, userId },
    });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const res = await this.prisma.render.deleteMany({
      where: { id, userId },
    });

    return res.count > 0;
  }

  async process(userId: string, id: string): Promise<Render | null> {
    return this.prisma.$transaction(async (tx) => {
      const render = await tx.render.findFirst({ where: { id, userId } });
      if (!render) return null;

      // idempotência
      if (render.status === RenderStatus.DONE) return render;
      if (render.status === RenderStatus.PROCESSING) return render;

      // marca como PROCESSING
      const processing = await tx.render.update({
        where: { id: render.id },
        data: { status: RenderStatus.PROCESSING },
      });

      // TODO: aqui entra Gemini / worker / queue.
      // Por enquanto: gera URL fake determinística.
      const fakeGeneratedUrl = `https://fake-cdn.renderia.local/renders/${processing.id}.png`;

      // finaliza
      const done = await tx.render.update({
        where: { id: processing.id },
        data: {
          status: RenderStatus.DONE,
          generatedImageUrl: fakeGeneratedUrl,
        },
      });

      return done;
    });
  }
}
