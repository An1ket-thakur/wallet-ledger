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

  /**
   * Atomically claims a key for this (user, key) pair.
   *  - No row yet -> insert a PENDING row, caller should proceed with the handler.
   *  - Row exists, COMPLETED, same request hash -> return the stored response (replay).
   *  - Row exists, COMPLETED, different request hash -> 409, key reuse is a client bug.
   *  - Row exists, PENDING -> a concurrent duplicate request is mid-flight -> 409.
   * The INSERT unique-violation path is what makes the PENDING claim atomic
   * under real concurrency (two requests racing to insert the same key).
   */
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

  /**
   * On handler failure we DELETE the PENDING row rather than leave it stuck,
   * so the client can safely retry the same key after fixing whatever caused
   * the failure (e.g. insufficient funds, a transient DB error).
   */
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
