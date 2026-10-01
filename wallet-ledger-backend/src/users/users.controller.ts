import { Controller, Get, Patch, Param, Body, Req } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import type { Request } from 'express';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // No @Roles() -> any authenticated user, but only their own record.
  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  // Support and Admin can list all users for investigation; Customers cannot.
  @Roles(UserRole.SUPPORT, UserRole.ADMIN)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  // Only Admin can disable/re-enable accounts.
  @Roles(UserRole.ADMIN)
  @Patch(':id/disabled')
  setDisabled(
    @Param('id') id: string,
    @Body() body: { disabled: boolean },
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.usersService.setDisabled(id, body.disabled, admin, req.ip);
  }
}
