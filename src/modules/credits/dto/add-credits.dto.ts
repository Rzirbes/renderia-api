import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { CreditTxType, Prisma } from '@prisma/client';

export class AddCreditsDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsEnum(CreditTxType)
  type!: CreditTxType;

  @IsOptional()
  meta?: Prisma.InputJsonValue;
}
