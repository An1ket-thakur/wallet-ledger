import { Controller, Get, Patch, Param, Body, Req, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import type { Request } from 'express';
import { CreateStaffDto } from './dto/create-staff.dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.findById(user.id);
  }

  @Roles(UserRole.SUPPORT, UserRole.ADMIN)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

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

  @Roles(UserRole.ADMIN)
  @Post('staff')
  createStaff(
    @Body() dto: CreateStaffDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.usersService.createStaff(dto, admin, req.ip);
  }
}
