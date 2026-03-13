import { randomUUID } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';

import { User } from '../../domain/entities/auth-user.entity';
import { UserRepository } from '../../domain/repositories/user.repository';
import { HashService } from '../../domain/services/hash.service';
import { TokenService } from '../../domain/services/token.service';

interface RegisterInput {
  name?: string;
  email: string;
  password: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly tokenService: TokenService,
    private readonly hashService: HashService,
  ) {}

  async execute(input: RegisterInput) {
    const exists = await this.userRepository.findByEmail(input.email);

    if (exists) {
      throw new ConflictException('E-mail já cadastrado');
    }

    const passwordHash = await this.hashService.hash(input.password);

    const user = new User(
      randomUUID(),
      input.name ?? null,
      input.email,
      passwordHash,
      0,
      null,
      null,
      new Date(),
      new Date(),
    );

    const createdUser = await this.userRepository.create(user);

    const accessToken = await this.tokenService.sign({
      sub: createdUser.id,
      email: createdUser.email,
    });

    return {
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        credits: createdUser.credits,
        createdAt: createdUser.createdAt,
      },
      accessToken,
    };
  }
}
