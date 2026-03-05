import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { CreateRenderDto } from './dto/create-render.dto';
import { ListRendersDto } from './dto/list-renders.dto';
import { toRenderResponse } from './dto/render-response.dto';
import { RendersService } from './renders.service';
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

type JwtPayload = { userId: string; email: string };

@SwaggerRendersController()
@Controller('renders')
@UseGuards(JwtAuthGuard)
export class RendersController {
  constructor(private readonly rendersService: RendersService) {}

  @Post()
  @SwaggerCreateRender()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateRenderDto) {
    const render = await this.rendersService.create(user.userId, dto);
    return toRenderResponse(render);
  }

  @Post(':id/process')
  @HttpCode(200)
  @SwaggerProcessRender()
  async process(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const render = await this.rendersService.process(user.userId, id);
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
