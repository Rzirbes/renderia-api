import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../../domain/repositories/user.repository';
import { HashService } from '../../domain/services/hash.service';
import { TokenService } from '../../domain/services/token.service';

type LoginUseCaseInput = {
  email: string;
  password: string;
};

type LoginUseCaseOutput = {
  user: {
    id: string;
    name: string | null;
    email: string;
    credits: number;
    createdAt: Date;
  };
  accessToken: string;
};

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly hashService: HashService,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: LoginUseCaseInput): Promise<LoginUseCaseOutput> {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordMatches = await this.hashService.compare(
      input.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const accessToken = await this.tokenService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        createdAt: user.createdAt,
      },
      accessToken,
    };
  }
}
