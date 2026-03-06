import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

type RegisterResult = { id: string; email: string };
type LoginResult = { accessToken: string };

type AuthServiceMock = {
  register: jest.Mock<Promise<RegisterResult>, [RegisterDto]>;
  login: jest.Mock<Promise<LoginResult>, [LoginDto]>;
};

describe('AuthController', () => {
  let controller: AuthController;

  const authServiceMock: AuthServiceMock = {
    register: jest.fn<Promise<RegisterResult>, [RegisterDto]>(),
    login: jest.fn<Promise<LoginResult>, [LoginDto]>(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = module.get(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should call auth.register(dto) and return result', async () => {
      const dto: RegisterDto = {
        name: 'Rômulo',
        email: 'romulo@test.com',
        password: '123456',
      };

      const response: RegisterResult = { id: '1', email: dto.email };
      authServiceMock.register.mockResolvedValue(response);

      const result = await controller.register(dto);

      expect(authServiceMock.register).toHaveBeenCalledTimes(1);
      expect(authServiceMock.register).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });
  });

  describe('login', () => {
    it('should call auth.login(dto) and return result', async () => {
      const dto: LoginDto = { email: 'romulo@test.com', password: '123456' };

      const response: LoginResult = { accessToken: 'fake-jwt' };
      authServiceMock.login.mockResolvedValue(response);

      const result = await controller.login(dto);

      expect(authServiceMock.login).toHaveBeenCalledTimes(1);
      expect(authServiceMock.login).toHaveBeenCalledWith(dto);
      expect(result).toEqual(response);
    });
  });
});
