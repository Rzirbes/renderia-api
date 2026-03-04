import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  const usersServiceMock = {
    findById: jest.fn(),
    updateMe: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersServiceMock }],
    }).compile();

    controller = moduleRef.get(UsersController);
    jest.clearAllMocks();
  });

  it('GET /users/me returns mapped user response', async () => {
    usersServiceMock.findById.mockResolvedValue({
      id: 'u1',
      name: 'Rômulo',
      email: 'romulo@test.com',
      password: 'HASHED',
      credits: 10,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    });

    const res = await controller.me({
      user: { userId: 'u1', email: 'x' },
    } as any);

    expect(res).toEqual({
      id: 'u1',
      name: 'Rômulo',
      email: 'romulo@test.com',
      credits: 10,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
  });

  it('PATCH /users/me updates and returns mapped user response', async () => {
    usersServiceMock.updateMe.mockResolvedValue({
      id: 'u1',
      name: 'Novo',
      email: 'romulo@test.com',
      password: 'HASHED',
      credits: 10,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    });

    const res = await controller.updateMe(
      { user: { userId: 'u1', email: 'x' } } as any,
      { name: 'Novo' } as any,
    );

    expect(usersServiceMock.updateMe).toHaveBeenCalledWith('u1', {
      name: 'Novo',
    });
    expect(res.name).toBe('Novo');
  });
});
