import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';

import { RegisterUseCase } from '../application/use-cases/register.use-case';
import { LoginUseCase } from '../application/use-cases/login.use-case';
import { MeUseCase } from '../application/use-cases/me.use-case';
import { ForgotPasswordUseCase } from '../application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from '../application/use-cases/reset-password.use-case';

import { RegisterDto } from '../application/dto/register.dto';
import { LoginDto } from '../application/dto/login.dto';

type RegisterResult = { id: string; email: string };
type LoginResult = { accessToken: string };

type RegisterUseCaseMock = {
  execute: jest.Mock<Promise<RegisterResult>, [RegisterDto]>;
};

type LoginUseCaseMock = {
  execute: jest.Mock<Promise<LoginResult>, [LoginDto]>;
};

type MeUseCaseMock = {
  execute: jest.Mock;
};

type ForgotPasswordUseCaseMock = {
  execute: jest.Mock;
};

type ResetPasswordUseCaseMock = {
  execute: jest.Mock;
};

describe('AuthController', () => {
  let controller: AuthController;

  const registerUseCaseMock: RegisterUseCaseMock = {
    execute: jest.fn<Promise<RegisterResult>, [RegisterDto]>(),
  };

  const loginUseCaseMock: LoginUseCaseMock = {
    execute: jest.fn<Promise<LoginResult>, [LoginDto]>(),
  };

  const meUseCaseMock: MeUseCaseMock = {
    execute: jest.fn(),
  };

  const forgotPasswordUseCaseMock: ForgotPasswordUseCaseMock = {
    execute: jest.fn(),
  };

  const resetPasswordUseCaseMock: ResetPasswordUseCaseMock = {
    execute: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterUseCase, useValue: registerUseCaseMock },
        { provide: LoginUseCase, useValue: loginUseCaseMock },
        { provide: MeUseCase, useValue: meUseCaseMock },
        { provide: ForgotPasswordUseCase, useValue: forgotPasswordUseCaseMock },
        { provide: ResetPasswordUseCase, useValue: resetPasswordUseCaseMock },
      ],
    }).compile();

    controller = module.get(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call registerUseCase.execute(dto) and return result', async () => {
      const dto: RegisterDto = {
        name: 'Rômulo',
        email: 'romulo@test.com',
        password: '123456',
      };

      const response: RegisterResult = { id: '1', email: dto.email };
      registerUseCaseMock.execute.mockResolvedValue(response);

      const result = await controller.register(dto);

      expect(registerUseCaseMock.execute).toHaveBeenCalledTimes(1);
      expect(registerUseCaseMock.execute).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });
  });

  describe('login', () => {
    it('should call loginUseCase.execute(dto) and return result', async () => {
      const dto: LoginDto = { email: 'romulo@test.com', password: '123456' };

      const response: LoginResult = { accessToken: 'fake-jwt' };
      loginUseCaseMock.execute.mockResolvedValue(response);

      const result = await controller.login(dto);

      expect(loginUseCaseMock.execute).toHaveBeenCalledTimes(1);
      expect(loginUseCaseMock.execute).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });
  });
});
