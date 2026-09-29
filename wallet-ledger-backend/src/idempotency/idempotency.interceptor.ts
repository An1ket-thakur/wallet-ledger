import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { IdempotencyService } from './idempotency.service';

const HEADER = 'idempotency-key';
const MAX_KEY_LENGTH = 255;

/**
 * Apply to any mutating (POST/PATCH/PUT) route that moves money or creates a
 * resource the client might retry blind (network timeout, etc).
 * Usage: @UseInterceptors(IdempotencyInterceptor)
 *
 * Requires the route to already be behind JwtAuthGuard, since it keys off
 * req.user.id - it does not itself check authentication.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.header(HEADER);
    if (!key) {
      throw new BadRequestException(
        `${HEADER} header is required for this operation`,
      );
    }
    if (key.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(
        `${HEADER} must be at most ${MAX_KEY_LENGTH} characters`,
      );
    }

    const userId = (req as any).user?.id;
    const requestHash = this.idempotency.hashRequest(
      req.method,
      req.path,
      req.body,
    );

    return from(this.idempotency.checkAndClaim(userId, key, requestHash)).pipe(
      switchMap((result) => {
        if (result.outcome === 'replay') {
          res.status(result.status);
          res.setHeader('Idempotent-Replay', 'true');
          return from([result.body]);
        }

        // outcome === 'proceed': run the real handler, then persist its result
        // against the claimed record so a retry of this exact key replays it.
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.idempotency.completeWithSuccess(
                result.recordId,
                res.statusCode,
                body,
              ),
            ).pipe(switchMap(() => from([body]))),
          ),
          catchError((err) =>
            from(this.idempotency.releaseOnFailure(result.recordId)).pipe(
              switchMap(() => {
                throw err;
              }),
            ),
          ),
        );
      }),
    );
  }
}
