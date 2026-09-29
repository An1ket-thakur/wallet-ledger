import { BadRequestException } from '@nestjs/common';

export class InsufficientFundsException extends BadRequestException {
  constructor(walletId: string) {
    super(`Wallet ${walletId} has insufficient funds for this operation`);
  }
}

export class CurrencyMismatchException extends BadRequestException {
  constructor() {
    super('Both wallets in a transaction must share the same currency');
  }
}
