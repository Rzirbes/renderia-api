import {
  BadRequestException,
  Body,
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
  SwaggerCompleteRender,
  SwaggerFailRender,
} from '../../common/decorators/renders/renders.swagger';
import { CurrentUser } from '../../common/decorators/auth/current-user.decorator';
import { FailRenderDto } from './dto/fail-render.dto';
import { RenderProcessorService } from './render-processor.service';
import { FileInterceptor } from '@nestjs/platform-express';

type JwtPayload = { userId: string; email: string };

@SwaggerRendersController()
@Controller('renders')
@UseGuards(JwtAuthGuard)
export class RendersController {
  constructor(
    private readonly rendersService: RendersService,
    private readonly storageService: StorageService,
    private readonly renderProcessorService: RenderProcessorService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado.');
    }

    const uploaded = await this.storageService.uploadOriginalImage({
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    return uploaded;
  }

  @Post()
  @SwaggerCreateRender()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRenderDto) {
    const render = await this.rendersService.create(user.userId, dto, {
      url: dto.originalImageUrl,
      path: dto.originalImagePath,
      mimeType: dto.originalImageMimeType,
    });

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

  @Post(':id/process')
  @HttpCode(200)
  @SwaggerProcessRender()
  async process(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.renderProcessorService.processRender(user.userId, id);

    const render = await this.rendersService.findById(user.userId, id);
    if (!render) throw new NotFoundException();

    return toRenderResponse(render);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @SwaggerCompleteRender()
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const render = await this.rendersService.complete(user.userId, id);
    if (!render) throw new NotFoundException();
    return toRenderResponse(render);
  }

  @Post(':id/fail')
  @HttpCode(200)
  @SwaggerFailRender()
  async fail(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: FailRenderDto,
  ) {
    const render = await this.rendersService.fail(user.userId, id, {
      code: body.code,
      message: body.message,
    });

    if (!render) throw new NotFoundException();
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
    const ok = await this.rendersService.remove(user.userId, id);
    if (!ok) throw new NotFoundException();
    return { ok: true };
  }
}
