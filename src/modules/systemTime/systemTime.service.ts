import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemTimeEntity } from './systemTime.entity';

export interface ServerTimeResponse {
  serverTime: string;
}

@Injectable()
export class SystemTimeService implements OnModuleInit {
  private offsetMilliseconds: number = 0;

  constructor(
    @Optional()
    @InjectRepository(SystemTimeEntity)
    private readonly systemTimeRepo?: Repository<SystemTimeEntity>,
  ) {
    // Trivial comment to trigger automatic reload of ts-node-dev
  }

  async onModuleInit(): Promise<void> {
    if (this.systemTimeRepo) {
      await this.loadOffset();
    }
  }

  private async loadOffset(): Promise<void> {
    if (!this.systemTimeRepo) return;
    try {
      let record = await this.systemTimeRepo.findOne({ where: { id: 1 } });
      if (!record) {
        record = this.systemTimeRepo.create({ id: 1, offsetMilliseconds: 0, lastServerTime: new Date() });
        await this.systemTimeRepo.save(record);
      }
      this.offsetMilliseconds = record.offsetMilliseconds;
    } catch (error) {
      // In case table doesn't exist yet during bootstrap before migrations run
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `Could not load system time offset from database. Using default (0 ms). Error: ${errorMessage}`,
      );
    }
  }

  private async saveOffset(): Promise<void> {
    if (!this.systemTimeRepo) return;
    try {
      await this.systemTimeRepo.save({
        id: 1,
        offsetMilliseconds: this.offsetMilliseconds,
        lastServerTime: this.now(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error saving system time offset to database: ${errorMessage}`);
    }
  }

  now(): Date {
    return new Date(Date.now() + this.offsetMilliseconds);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  getServerTime(): ServerTimeResponse {
    return {
      serverTime: this.nowIso(),
    };
  }

  addOffset(milliseconds: number): { offset: number; newTime: string } {
    if (milliseconds < 0) {
      throw new Error('Cannot reduce the time offset.');
    }
    this.offsetMilliseconds += milliseconds;
    this.saveOffset().catch((err) => {
      console.error(`Background saveOffset error: ${err.message}`);
    });
    return {
      offset: this.offsetMilliseconds,
      newTime: this.nowIso(),
    };
  }

  getOffset(): number {
    return this.offsetMilliseconds;
  }

  resetOffset(): void {
    throw new Error('Resetting the time offset is not allowed.');
  }
}
