import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

export function SwaggerRendersController() {
  return applyDecorators(ApiTags('renders'), ApiBearerAuth());
}

export function SwaggerCreateRender() {
  return applyDecorators(
    ApiOperation({ summary: 'Cria um render para o usuário logado' }),
    ApiResponse({ status: 201, description: 'Render criado com sucesso' }),
  );
}

export function SwaggerListRenders() {
  return applyDecorators(
    ApiOperation({ summary: 'Lista renders do usuário (paginação)' }),
    ApiQuery({ name: 'page', required: false, type: Number, example: 1 }),
    ApiQuery({ name: 'pageSize', required: false, type: Number, example: 10 }),
    ApiResponse({ status: 200, description: 'Lista paginada de renders' }),
  );
}

export function SwaggerGetRender() {
  return applyDecorators(
    ApiOperation({ summary: 'Busca um render por id' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiResponse({ status: 200, description: 'Render encontrado' }),
    ApiResponse({ status: 404, description: 'Render não encontrado' }),
  );
}

export function SwaggerDeleteRender() {
  return applyDecorators(
    ApiOperation({ summary: 'Remove um render por id' }),
    ApiParam({ name: 'id', type: String, format: 'uuid' }),
    ApiResponse({ status: 200, description: 'Render removido' }),
    ApiResponse({ status: 404, description: 'Render não encontrado' }),
  );
}
