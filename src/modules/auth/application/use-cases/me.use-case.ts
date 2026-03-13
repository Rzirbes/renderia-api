import { Injectable } from '@nestjs/common';
import { UserRepository } from '../../domain/repositories/user.repository';
import { UserNotFoundError } from '../../domain/errors/user-not-found.error';

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
      throw new UserNotFoundError();
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
