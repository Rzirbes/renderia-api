export class EmailAlreadyInUseError extends Error {
  constructor() {
    super('E-mail já cadastrado');
    this.name = 'EmailAlreadyInUseError';
  }
}
