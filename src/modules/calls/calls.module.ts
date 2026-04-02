import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { CallOrchestratorService } from './call-orchestrator.service.js';
import { CallRepository } from './repositories/call.repository.js';
import { Call } from './entities/call.entity.js';
import { CallLeg } from './entities/call-leg.entity.js';
import { CallEvent } from './entities/call-event.entity.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Call, CallLeg, CallEvent]),
    ProvidersModule,
    RealtimeModule,
  ],
  controllers: [CallsController],
  providers: [CallsService, CallOrchestratorService, CallRepository],
  exports: [CallOrchestratorService, CallRepository],
})
export class CallsModule {}
