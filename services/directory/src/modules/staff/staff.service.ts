import { Injectable, NotFoundException } from '@nestjs/common';
import { type Staff } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';

@Injectable()
export class StaffService {
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
