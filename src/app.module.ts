import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CreditsModule } from './modules/credits/credits.module';
import { RendersModule } from './modules/renders/renders.module';
import { ConfigModule } from '@nestjs/config';
import { QueueModule } from './queue/queue.module';
import { RendersWorkerRunner } from './queue/workers/renders.worker.runner';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),

    PrismaModule,
    AuthModule,
    UsersModule,
    CreditsModule,
    RendersModule,
    QueueModule,
  ],
  providers: [RendersWorkerRunner],
})
export class AppModule {}
