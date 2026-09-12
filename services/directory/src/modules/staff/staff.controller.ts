import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto } from './dto/create-staff.dto';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staff.findOne(id);
  }
}
