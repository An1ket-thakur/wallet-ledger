import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import getRawBody from 'raw-body';

declare module 'express' {
  interface Request {
    rawBody?: Buffer;
  }
}

/**
 * Captures the raw request body onto req.rawBody for HMAC verification, then
 * parses it into req.body itself - since this middleware consumes the
 * request stream, Nest's global JSON body-parser never gets a chance to run
 * for this route (a stream can only be read once), so we have to do its job
 * here or every DTO field ends up undefined.
 */
@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
  async use(req: Request, _res: Response, next: NextFunction) {
    const buf = await getRawBody(req);
    req.rawBody = buf;

    if (buf.length === 0) {
      req.body = {};
      return next();
    }

    try {
      req.body = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON body');
    }

    next();
  }
}
