import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../guards/jwt-auth.guard';

/** Marks a route as not requiring a valid access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
