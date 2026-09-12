import { Injectable, NotFoundException } from '@nestjs/common';
import { type Classroom } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';

@Injectable()
export class ClassroomsService {
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
