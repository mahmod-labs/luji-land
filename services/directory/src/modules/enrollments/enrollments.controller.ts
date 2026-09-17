import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateEnrollmentDto) {
    return this.enrollments.create(dto);
  }
}
