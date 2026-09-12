import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';

@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classrooms: ClassroomsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateClassroomDto) {
    return this.classrooms.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.classrooms.findOne(id);
  }
}
