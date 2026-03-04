import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CreditsModule } from './modules/credits/credits.module';
import { RendersModule } from './modules/renders/renders.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    CreditsModule,
    RendersModule,
  ],
})
export class AppModule {}
