import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateRefundDto {
  @IsUUID()
  transactionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
