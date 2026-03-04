import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';

import { UsersService } from './users.service';
import { PrismaService } from '../../database/prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const makeUser = (overrides?: Partial<any>) => ({
    id: 'u1',
    name: 'Rômulo',
    email: 'romulo@test.com',
    password: 'HASHED',
    credits: 10,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());

      const user = await service.findById('u1');

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
      });
      expect(user.id).toBe('u1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateMe', () => {
    it('should update name successfully', async () => {
      prismaMock.user.update.mockResolvedValue(makeUser({ name: 'Novo Nome' }));

      const user = await service.updateMe('u1', { name: 'Novo Nome' });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { name: 'Novo Nome' },
      });
      expect(user.name).toBe('Novo Nome');
    });

    it('should check email uniqueness when email is provided', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.update.mockResolvedValue(
        makeUser({ email: 'novo@test.com' }),
      );

      const user = await service.updateMe('u1', { email: 'novo@test.com' });

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'novo@test.com' },
        select: { id: true },
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { email: 'novo@test.com' },
      });

      expect(user.email).toBe('novo@test.com');
    });

    it('should throw ConflictException when email is already used by another user', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });

      await expect(
        service.updateMe('u1', { email: 'duplicado@test.com' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('should allow setting the same email (no conflict) when it belongs to the same user', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });
      prismaMock.user.update.mockResolvedValue(
        makeUser({ email: 'romulo@test.com' }),
      );

      const user = await service.updateMe('u1', { email: 'romulo@test.com' });

      expect(prismaMock.user.update).toHaveBeenCalled();
      expect(user.email).toBe('romulo@test.com');
    });

    it('should throw ConflictException if prisma update fails (e.g. unique violation)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.update.mockRejectedValue(new Error('boom'));

      await expect(
        service.updateMe('u1', { email: 'novo@test.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
