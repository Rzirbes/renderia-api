export class InvalidOrExpiredResetTokenError extends Error {
  constructor() {
    super('Token inválido ou expirado');
    this.name = 'InvalidOrExpiredResetTokenError';
  }
}
