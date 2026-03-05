import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FailRenderDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @IsString()
  @MaxLength(500)
  message: string;
}
