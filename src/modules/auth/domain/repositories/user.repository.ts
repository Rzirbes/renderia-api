import { User } from '../entities/auth-user.entity';

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findByResetPasswordTokenHash(
    tokenHash: string,
  ): Promise<User | null>;
  abstract create(user: User): Promise<User>;
  abstract save(user: User): Promise<User>;
}
