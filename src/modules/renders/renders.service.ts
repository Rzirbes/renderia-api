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
        status: RenderStatus.PENDING,
        generatedImageUrl: null,
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
    return this.prisma.render.findFirst({ where: { id, userId } });
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const res = await this.prisma.render.deleteMany({ where: { id, userId } });
    return res.count > 0;
  }

  /**
   * Enfileira/começa: PENDING -> PROCESSING
   * Idempotente: se já estiver PROCESSING/DONE/ERROR, só devolve o estado atual.
   */
  async process(userId: string, id: string): Promise<Render | null> {
    // tenta transicionar PENDING -> PROCESSING de forma atômica
    await this.prisma.render.updateMany({
      where: { id, userId, status: RenderStatus.PENDING },
      data: { status: RenderStatus.PROCESSING },
    });

    // sempre retorna o estado atual
    return this.prisma.render.findFirst({ where: { id, userId } });
  }

  /**
   * Worker fake: PROCESSING -> DONE
   * (se quiser permitir PENDING -> DONE pra debug local, dá pra colocar em um flag)
   */
  async complete(userId: string, id: string): Promise<Render | null> {
    const fakeGeneratedUrl = `https://fake-cdn.renderia.local/renders/${id}.png`;

    // tenta completar somente se estiver PROCESSING
    await this.prisma.render.updateMany({
      where: { id, userId, status: RenderStatus.PROCESSING },
      data: {
        status: RenderStatus.DONE,
        generatedImageUrl: fakeGeneratedUrl,
      },
    });

    return this.prisma.render.findFirst({ where: { id, userId } });
  }

  /**
   * Worker fake: PROCESSING -> ERROR
   */
  async fail(userId: string, id: string): Promise<Render | null> {
    await this.prisma.render.updateMany({
      where: { id, userId, status: RenderStatus.PROCESSING },
      data: {
        status: RenderStatus.ERROR,
        // errorMessage: reason ?? null (se tiver no schema)
      },
    });

    return this.prisma.render.findFirst({ where: { id, userId } });
  }
}
