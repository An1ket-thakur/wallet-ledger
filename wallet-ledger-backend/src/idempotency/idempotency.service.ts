import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { QueryFailedError } from 'typeorm';
import {
  IdempotencyKeyInProgressException,
  IdempotencyKeyReusedWithDifferentBodyException,
} from './idempotency.error';
import { IdempotencyKeyRecord } from 'src/database/entities/idempotency-key.entity';
import { IdempotencyStatus } from 'src/common/types/idempotency.enum';

export type IdempotencyCheckResult =
  | { outcome: 'proceed'; recordId: string }
  | { outcome: 'replay'; status: number; body: unknown };

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKeyRecord)
    private readonly records: Repository<IdempotencyKeyRecord>,
  ) {}

  hashRequest(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(method)
      .update('\n')
      .update(path)
      .update('\n')
      .update(JSON.stringify(body ?? {}))
      .digest('hex');
  }

  async checkAndClaim(
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyCheckResult> {
    try {
      const inserted = await this.records.insert({
        userId,
        key,
        requestHash,
        status: IdempotencyStatus.PENDING,
      });
      return {
        outcome: 'proceed',
        recordId: inserted.identifiers[0].id as string,
      };
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;

      const existing = await this.records.findOneOrFail({
        where: { userId, key },
      });

      if (existing.requestHash !== requestHash) {
        throw new IdempotencyKeyReusedWithDifferentBodyException();
      }
      if (existing.status === IdempotencyStatus.PENDING) {
        throw new IdempotencyKeyInProgressException();
      }
      return {
        outcome: 'replay',
        status: existing.responseStatus ?? 200,
        body: existing.responseBody ? JSON.parse(existing.responseBody) : null,
      };
    }
  }

  async completeWithSuccess(
    recordId: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    await this.records.update(
      { id: recordId },
      {
        status: IdempotencyStatus.COMPLETED,
        responseStatus: status,
        responseBody: JSON.stringify(body ?? null),
      },
    );
  }

  async releaseOnFailure(recordId: string): Promise<void> {
    await this.records.delete({ id: recordId });
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError &&
      (err as any).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
