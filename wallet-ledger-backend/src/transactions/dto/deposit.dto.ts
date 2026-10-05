import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class DepositDto {
  @IsUUID()
  walletId!: string;

  @IsInt()
  @IsPositive()
  amount!: number;
}
