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
