export class User {
  constructor(
    public readonly id: string,
    public name: string | null,
    public email: string,
    public passwordHash: string,
    public credits: number,
    public resetPasswordTokenHash: string | null,
    public resetPasswordExpiresAt: Date | null,
    public createdAt: Date,
    public updatedAt: Date,
  ) {}

  changeEmail(newEmail: string) {
    if (!newEmail.includes('@')) {
      throw new Error('Invalid email');
    }

    this.email = newEmail;
  }

  addCredits(amount: number) {
    if (amount <= 0) {
      throw new Error('Invalid credit amount');
    }

    this.credits += amount;
  }

  removeCredits(amount: number) {
    if (amount <= 0) {
      throw new Error('Invalid credit amount');
    }

    if (this.credits < amount) {
      throw new Error('Insufficient credits');
    }

    this.credits -= amount;
  }
}
