export abstract class TokenService {
  abstract sign(payload: { sub: string; email: string }): Promise<string>;
}
