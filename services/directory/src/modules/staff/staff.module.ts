import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { type Staff } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

class CreateStaffDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  role!: string;
}

@Injectable()
class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateStaffDto): Promise<Staff> {
    return this.prisma.staff.create({ data: dto });
  }

  async findOne(id: string): Promise<Staff> {
    const member = await this.prisma.staff.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException(`staff ${id} not found`);
    }
    return member;
  }
}

@Controller('staff')
class StaffController {
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

@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
