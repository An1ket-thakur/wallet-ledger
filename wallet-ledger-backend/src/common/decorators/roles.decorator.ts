import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../types/roles.enum';

export const ROLES_KEY = 'roles';

/**
 * Attach allowed roles to a route handler.
 * Usage: @Roles(UserRole.ADMIN, UserRole.SUPPORT)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
