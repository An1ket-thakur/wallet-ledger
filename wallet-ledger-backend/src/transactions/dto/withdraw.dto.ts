import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class WithdrawDto {
  @IsUUID()
  walletId!: string;

  /** Minor units (cents). */
  @IsInt()
  @IsPositive()
  amount!: number;
}
