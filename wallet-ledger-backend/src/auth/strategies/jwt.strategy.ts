import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/database/entities/users.entity';

export interface JwtAccessPayload {
  sub: string; // user id
  email: string;
  role: string;
  type: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtAccessPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Re-check the user still exists / isn't disabled on every request.
    // Slight DB cost, but prevents a revoked/disabled user from acting on a still-valid token.
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.disabledAt) {
      throw new UnauthorizedException('Account no longer active');
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}
