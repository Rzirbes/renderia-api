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
    ApiOperation({
      summary: 'Cria um render para o usuário logado',
      description:
        'Idempotente por clientRequestId (por usuário): repetir a mesma chave com o mesmo payload devolve o render já criado (header Idempotent-Replayed: true), sem novo job nem cobrança.',
    }),
    ApiResponse({
      status: 201,
      description:
        'Render criado (ou replay da mesma chave; ver header Idempotent-Replayed)',
    }),
    ApiResponse({
      status: 409,
      description:
        'IDEMPOTENCY_KEY_REUSED: clientRequestId já usado com outro payload',
    }),
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
    ApiResponse({
      status: 200,
      description: 'Render removido (PENDING, DONE ou ERROR)',
    }),
    ApiResponse({ status: 404, description: 'Render não encontrado' }),
    ApiResponse({
      status: 409,
      description:
        'RENDER_PROCESSING: render em processamento não pode ser removido',
    }),
  );
}

export function SwaggerProcessRender() {
  return applyDecorators(
    ApiOperation({
      summary: 'Garante que um render PENDING está na fila (idempotente)',
      description:
        'Não executa o processamento. Para render PENDING, garante um único job na fila (jobId = renderId); para outros status apenas devolve o estado atual. Acompanhe o resultado via GET /renders/:id.',
    }),

    ApiParam({
      name: 'id',
      description: 'Render ID',
      required: true,
    }),

    ApiResponse({
      status: 200,
      description: 'Estado atual do render',
    }),

    ApiResponse({
      status: 404,
      description: 'Render não encontrado',
    }),
  );
}

export function SwaggerCompleteRender() {
  return applyDecorators(
    ApiOperation({
      summary: 'Finaliza o render',
      description:
        'Simula o worker finalizando o render e definindo status DONE.',
    }),

    ApiParam({
      name: 'id',
      description: 'Render ID',
      required: true,
    }),

    ApiResponse({
      status: 200,
      description: 'Render finalizado com sucesso',
    }),

    ApiResponse({
      status: 404,
      description: 'Render não encontrado',
    }),
  );
}
