import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Catches everything, including errors Nest didn't convert to an
 * HttpException (a raw thrown Error from a driver, an unexpected null
 * dereference, etc). Without this, some error paths can leak a stack trace
 * or an internal error message (e.g. a raw Postgres error string) straight
 * to the client. Known HttpExceptions pass their real status/message through
 * unchanged - this only sanitizes the unknown case.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    // Anything else is unexpected - log the full detail server-side, return
    // a generic message to the client.
    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      `Unhandled exception on ${req.method} ${req.path}: ${err.message}`,
      err.stack,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
