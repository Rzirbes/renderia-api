import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { HashService } from '../../domain/services/hash.service';

@Injectable()
export class ArgonHashService implements HashService {
  async hash(payload: string): Promise<string> {
    return argon2.hash(payload);
  }

  async compare(payload: string, hashed: string): Promise<boolean> {
    return argon2.verify(hashed, payload);
  }
}
