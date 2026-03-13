import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRepository } from '../../domain/repositories/user.repository';

type MeUseCaseOutput = {
  user: {
    id: string;
    name: string | null;
    email: string;
    credits: number;
    createdAt: Date;
  };
};

@Injectable()
export class MeUseCase {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(userId: string): Promise<MeUseCaseOutput> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits,
        createdAt: user.createdAt,
      },
    };
  }
}
