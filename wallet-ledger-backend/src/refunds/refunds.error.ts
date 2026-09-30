import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export class TransactionNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`Transaction ${id} not found`);
  }
}

export class TransactionAlreadyReversedException extends ConflictException {
  constructor(id: string) {
    super(`Transaction ${id} has already been reversed`);
  }
}

export class CannotReverseAReversalException extends BadRequestException {
  constructor() {
    super('A REVERSAL transaction cannot itself be reversed');
  }
}
