import { ConflictException } from '@nestjs/common';

export class IdempotencyKeyReusedWithDifferentBodyException extends ConflictException {
  constructor() {
    super(
      'This Idempotency-Key was already used with a different request body',
    );
  }
}

export class IdempotencyKeyInProgressException extends ConflictException {
  constructor() {
    super(
      'A request with this Idempotency-Key is still being processed; retry shortly',
    );
  }
}
