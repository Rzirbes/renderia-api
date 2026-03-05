import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { RendersController } from '../renders.controller';
import { RendersService } from '../renders.service';
import { CreateRenderDto } from '../dto/create-render.dto';
import { ListRendersDto } from '../dto/list-renders.dto';
import { RenderResponse, toRenderResponse } from '../dto/render-response.dto';

type JwtPayload = { userId: string; email: string };

jest.mock('../dto/render-response.dto', () => ({
  toRenderResponse: jest.fn(),
}));

const toRenderResponseMock = toRenderResponse as unknown as jest.Mock<
  RenderResponse,
  [unknown]
>;

type RendersServiceMock = jest.Mocked<
  Pick<
    RendersService,
    'create' | 'list' | 'findById' | 'remove' | 'process' | 'complete' | 'fail'
  >
>;
describe('RendersController (unit)', () => {
  let controller: RendersController;
  let rendersServiceMock: RendersServiceMock;

  const makeUser = (userId = 'u1'): JwtPayload => ({
    userId,
    email: 'romulo@test.com',
  });

  beforeEach(async () => {
    rendersServiceMock = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn(),
      remove: jest.fn(),
      process: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RendersController],
      providers: [{ provide: RendersService, useValue: rendersServiceMock }],
    }).compile();

    controller = moduleRef.get(RendersController);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('calls service.create with userId and dto and maps response', async () => {
      const dto: CreateRenderDto = {
        originalImageUrl: 'https://img/original.png',
        prompt: 'blue hour',
      };

      const renderFromService = {
        id: 'r1',
        userId: 'u1',
        originalImageUrl: dto.originalImageUrl,
        prompt: dto.prompt,
      };

      const mapped = { id: 'r1' } as RenderResponse;

      rendersServiceMock.create.mockResolvedValueOnce(
        renderFromService as never,
      );
      toRenderResponseMock.mockReturnValueOnce(mapped);

      const result = await controller.create(makeUser('u1'), dto);

      expect(rendersServiceMock.create).toHaveBeenCalledWith('u1', dto);
      expect(toRenderResponseMock).toHaveBeenCalledWith(renderFromService);
      expect(result).toBe(mapped);
    });
  });

  describe('list', () => {
    it('calls service.list with userId and query and maps items', async () => {
      const query: ListRendersDto = { page: 2, pageSize: 5 };

      const items = [{ id: 'r1' }, { id: 'r2' }];

      rendersServiceMock.list.mockResolvedValueOnce({
        items: items as never,
        page: 2,
        pageSize: 5,
        total: 12,
      } as never);

      toRenderResponseMock
        .mockReturnValueOnce({ id: 'r1' } as RenderResponse)
        .mockReturnValueOnce({ id: 'r2' } as RenderResponse);

      const result = await controller.list(makeUser('u1'), query);

      expect(rendersServiceMock.list).toHaveBeenCalledWith('u1', query);
      expect(toRenderResponseMock).toHaveBeenCalledTimes(2);

      expect(result).toEqual({
        page: 2,
        pageSize: 5,
        total: 12,
        items: [{ id: 'r1' }, { id: 'r2' }],
      });
    });

    it('returns empty items when service returns empty list', async () => {
      rendersServiceMock.list.mockResolvedValueOnce({
        items: [] as never,
        page: 1,
        pageSize: 10,
        total: 0,
      } as never);

      const result = await controller.list(makeUser('u1'), {});

      expect(result).toEqual({
        page: 1,
        pageSize: 10,
        total: 0,
        items: [],
      });
      expect(toRenderResponseMock).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns mapped render when found', async () => {
      const renderFromService = { id: 'r1' };
      const mapped = { id: 'r1' } as RenderResponse;

      rendersServiceMock.findById.mockResolvedValueOnce(
        renderFromService as never,
      );
      toRenderResponseMock.mockReturnValueOnce(mapped);

      const result = await controller.findOne(makeUser('u1'), 'r1');

      expect(rendersServiceMock.findById).toHaveBeenCalledWith('u1', 'r1');
      expect(toRenderResponseMock).toHaveBeenCalledWith(renderFromService);
      expect(result).toBe(mapped);
    });

    it('throws NotFoundException when not found', async () => {
      rendersServiceMock.findById.mockResolvedValueOnce(null);

      await expect(
        controller.findOne(makeUser('u1'), 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(rendersServiceMock.findById).toHaveBeenCalledWith('u1', 'missing');
      expect(toRenderResponseMock).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('returns { ok: true } when removed', async () => {
      rendersServiceMock.remove.mockResolvedValueOnce(true);

      const result = await controller.remove(makeUser('u1'), 'r1');

      expect(rendersServiceMock.remove).toHaveBeenCalledWith('u1', 'r1');
      expect(result).toEqual({ ok: true });
    });

    it('throws NotFoundException when service returns false', async () => {
      rendersServiceMock.remove.mockResolvedValueOnce(false);

      await expect(
        controller.remove(makeUser('u1'), 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(rendersServiceMock.remove).toHaveBeenCalledWith('u1', 'missing');
    });
  });

  describe('process', () => {
    it('calls service.process with userId and id and maps response', async () => {
      const renderFromService = { id: 'r1', status: 'DONE' };
      const mapped = { id: 'r1' } as RenderResponse;

      rendersServiceMock.process.mockResolvedValueOnce(
        renderFromService as never,
      );
      toRenderResponseMock.mockReturnValueOnce(mapped);

      const result = await controller.process(makeUser('u1'), 'r1');

      expect(rendersServiceMock.process).toHaveBeenCalledWith('u1', 'r1');
      expect(toRenderResponseMock).toHaveBeenCalledWith(renderFromService);
      expect(result).toBe(mapped);
    });

    it('throws NotFoundException when service returns null', async () => {
      rendersServiceMock.process.mockResolvedValueOnce(null);

      await expect(
        controller.process(makeUser('u1'), 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(rendersServiceMock.process).toHaveBeenCalledWith('u1', 'missing');
      expect(toRenderResponseMock).not.toHaveBeenCalled();
    });
  });
});
