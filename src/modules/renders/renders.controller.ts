import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CreateRenderDto } from './dto/create-render.dto';
import { ListRendersDto } from './dto/list-renders.dto';
import { toRenderResponse } from './dto/render-response.dto';
import { RendersService } from './renders.service';
import { StorageService } from './storage.service';
import {
  SwaggerCreateRender,
  SwaggerDeleteRender,
  SwaggerGetRender,
  SwaggerListRenders,
  SwaggerProcessRender,
  SwaggerRendersController,
} from '../../common/decorators/renders/renders.swagger';
import { CurrentUser } from '../../common/decorators/auth/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { EditRenderDto } from './dto/edit-render.dto';
import { RenderStatus } from '@prisma/client';
import type { Response } from 'express';

type JwtPayload = { userId: string; email: string };

@SwaggerRendersController()
@Controller('renders')
@UseGuards(JwtAuthGuard)
export class RendersController {
  constructor(
    private readonly rendersService: RendersService,
    private readonly storageService: StorageService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado.');
    }

    const uploaded = await this.storageService.uploadOriginalImage({
      userId: user.userId,
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    return uploaded;
  }

  @Post()
  @SwaggerCreateRender()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRenderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // path, URL e MIME da imagem original são derivados pelo servidor a partir
    // de um upload do próprio usuário; `originalImageUrl` e
    // `originalImageMimeType` enviados pelo cliente são ignorados.
    const originalImage = await this.storageService.resolveUserOriginalImage(
      user.userId,
      dto.originalImagePath,
    );

    const { render, replayed } = await this.rendersService.create(
      user.userId,
      dto,
      originalImage,
    );

    // Mesmo status (201) e corpo no replay; o header permite ao cliente
    // distinguir sem quebrar quem só verifica 2xx.
    res.setHeader('Idempotent-Replayed', replayed ? 'true' : 'false');

    return toRenderResponse(render);
  }

  @Post('requeue-pendings')
  @HttpCode(200)
  async requeuePendings(
    @Headers('x-admin-key') adminKey: string | undefined,
    @Query('minutes', new DefaultValuePipe(2), ParseIntPipe) minutes: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    if (!process.env.ADMIN_REQUEUE_KEY) {
      throw new NotFoundException();
    }

    if (!adminKey || adminKey !== process.env.ADMIN_REQUEUE_KEY) {
      throw new NotFoundException();
    }

    const safeMinutes = Math.min(Math.max(minutes, 1), 60);
    const safeLimit = Math.min(Math.max(limit, 1), 500);

    return this.rendersService.requeuePendings(safeMinutes, safeLimit);
  }

  /**
   * Mantido por compatibilidade, mas NÃO executa o Gemini: o processamento é
   * feito exclusivamente pelo worker do BullMQ. Para render PENDING apenas
   * garante (de forma idempotente, jobId = renderId) que existe um job na
   * fila; para os demais status só devolve o estado atual. Chamadas
   * repetidas ou concorrentes nunca disparam processamento ou cobrança extra.
   * Clientes devem acompanhar o status via `GET /renders/:id`.
   */
  @Post(':id/process')
  @HttpCode(200)
  @SwaggerProcessRender()
  async process(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const render = await this.rendersService.findById(user.userId, id);
    if (!render) throw new NotFoundException();

    if (render.status === RenderStatus.PENDING) {
      await this.rendersService.enqueue(render);
    }

    return toRenderResponse(render);
  }

  // `POST /renders/:id/fail` foi removido: permitia ao próprio usuário forçar
  // PROCESSING -> ERROR (com reembolso) enquanto o Gemini ainda gerava a
  // imagem. Falhas agora só são registradas pelo worker/recuperação.

  @Post(':id/edit')
  async edit(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) renderId: string,
    @Body() dto: EditRenderDto,
  ) {
    console.log('EDIT ROUTE HIT', renderId, dto);

    const render = await this.rendersService.editRender(
      user.userId,
      renderId,
      dto,
    );

    return toRenderResponse(render);
  }

  @Get()
  @SwaggerListRenders()
  async list(@CurrentUser() user: JwtPayload, @Query() query: ListRendersDto) {
    const { items, page, pageSize, total } = await this.rendersService.list(
      user.userId,
      query,
    );

    return {
      page,
      pageSize,
      total,
      items: items.map(toRenderResponse),
    };
  }

  @Get(':id')
  @SwaggerGetRender()
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const render = await this.rendersService.findById(user.userId, id);
    if (!render) throw new NotFoundException();
    return toRenderResponse(render);
  }

  @Delete(':id')
  @SwaggerDeleteRender()
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const result = await this.rendersService.remove(user.userId, id);

    if (result === 'not-found') throw new NotFoundException();

    if (result === 'processing') {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'RENDER_PROCESSING',
        message:
          'Render em processamento não pode ser removido. Aguarde a conclusão.',
      });
    }

    return { ok: true };
  }
}
