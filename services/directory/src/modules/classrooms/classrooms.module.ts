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
import { IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { type Classroom } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

class CreateClassroomDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsInt()
  @Min(1)
  capacity!: number;
}

@Injectable()
class ClassroomsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClassroomDto): Promise<Classroom> {
    return this.prisma.classroom.create({ data: dto });
  }

  async findOne(id: string): Promise<Classroom> {
    const room = await this.prisma.classroom.findUnique({ where: { id } });
    if (!room) {
      throw new NotFoundException(`classroom ${id} not found`);
    }
    return room;
  }
}

@Controller('classrooms')
class ClassroomsController {
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

@Module({
  controllers: [ClassroomsController],
  providers: [ClassroomsService],
})
export class ClassroomsModule {}
