import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

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
  setDisabled(@Param('id') id: string, @Body() body: { disabled: boolean }) {
    return this.usersService.setDisabled(id, body.disabled);
  }
}
