import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
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
  SwaggerRendersController,
} from '../../common/decorators/renders/renders.swagger';

type JwtPayload = { userId: string; email: string };

@SwaggerRendersController()
@Controller('renders')
@UseGuards(JwtAuthGuard)
export class RendersController {
  constructor(private readonly rendersService: RendersService) {}

  @Post()
  @SwaggerCreateRender()
  async create(
    @Req() req: Request & { user?: JwtPayload },
    @Body() dto: CreateRenderDto,
  ) {
    const render = await this.rendersService.create(req.user!.userId, dto);
    return toRenderResponse(render);
  }

  @Get()
  @SwaggerListRenders()
  async list(
    @Req() req: Request & { user?: JwtPayload },
    @Query() query: ListRendersDto,
  ) {
    const { items, page, pageSize, total } = await this.rendersService.list(
      req.user!.userId,
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
    @Req() req: Request & { user?: JwtPayload },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const render = await this.rendersService.findById(req.user!.userId, id);
    if (!render) throw new NotFoundException();
    return toRenderResponse(render);
  }

  @Delete(':id')
  @SwaggerDeleteRender()
  async remove(
    @Req() req: Request & { user?: JwtPayload },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const ok = await this.rendersService.remove(req.user!.userId, id);
    if (!ok) throw new NotFoundException();
    return { ok: true };
  }
}
