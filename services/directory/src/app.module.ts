import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ChildrenModule } from './modules/children/children.module';
import { ClassroomsModule } from './modules/classrooms/classrooms.module';
import { StaffModule } from './modules/staff/staff.module';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
class PrismaModule {}

@Module({
  imports: [PrismaModule, ChildrenModule, ClassroomsModule, StaffModule],
})
export class AppModule {}
