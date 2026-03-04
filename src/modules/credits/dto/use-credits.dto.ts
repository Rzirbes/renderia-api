import { IsInt, IsOptional, Min } from 'class-validator';
import { Prisma } from '@prisma/client';

export class UseCreditsDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  meta?: Prisma.InputJsonValue;
}
