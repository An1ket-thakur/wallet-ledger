import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import getRawBody from 'raw-body';

declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}

/**
 * Captures the raw request body onto req.rawBody BEFORE Nest's global JSON
 * body-parser consumes the stream. HMAC verification needs the exact bytes
 * the provider signed - the parsed-then-reserialized body is not guaranteed
 * to match byte-for-byte. Applied only to the webhook route in main.ts.
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction) {
    req.rawBody = await getRawBody(req);
    next();
  }
}
