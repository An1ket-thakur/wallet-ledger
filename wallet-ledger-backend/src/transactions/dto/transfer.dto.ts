import {
  IsInt,
  IsPositive,
  IsUUID,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'walletsDiffer', async: false })
class WalletsDifferConstraint implements ValidatorConstraintInterface {
  validate(toWalletId: string, args: any) {
    return toWalletId !== args.object.fromWalletId;
  }
  defaultMessage() {
    return 'fromWalletId and toWalletId must be different wallets';
  }
}

export class TransferDto {
  @IsUUID()
  fromWalletId!: string;

  @IsUUID()
  @Validate(WalletsDifferConstraint)
  toWalletId!: string;

  @IsInt()
  @IsPositive()
  amount!: number;
}
