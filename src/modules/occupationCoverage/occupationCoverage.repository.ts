import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { OccupationCoverage } from './occupationCoverage.model';
import { SystemTimeService } from '../systemTime/systemTime.service';

type OccupationCoverageRow = {
  occupationId: number;
  occupationName: string;
  minimumRequiredWorkers: number | string;
  preferredWorkers: number | string | null;
  criticalThresholdPercent: number | string;
  campId: number | string;
  activeWorkers: number | string;
  availableWorkers: number | string;
};

@Injectable()
export class OccupationCoverageRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly systemTimeService?: SystemTimeService,
  ) {}

  async getOccupationCoverageByCamp(campId: number): Promise<OccupationCoverage[]> {
    const systemTime = this.systemTimeService ? this.systemTimeService.now() : new Date();
    const query = `
      SELECT
        o.id as "occupationId",
        o.name as "occupationName",
        o.minimum_required_workers as "minimumRequiredWorkers",
        o.preferred_workers as "preferredWorkers",
        o.critical_threshold_percent as "criticalThresholdPercent",
        $1::int as "campId",
        COALESCE(
          (SELECT COUNT(DISTINCT p.id)
           FROM person p
           LEFT JOIN temporary_occupation_assignment taa
             ON taa.person_id = p.id
             AND taa.start_date <= $2
             AND (taa.end_date IS NULL OR taa.end_date + INTERVAL '1 day' > $2)
           WHERE p.camp_id = $1::int
           AND p.current_status IN ('ACTIVE', 'INACTIVE')
           AND (
             (taa.id IS NULL AND p.occupation_id = o.id)
             OR (taa.id IS NOT NULL AND taa.temporary_occupation_id = o.id)
           )),
          0
        ) as "activeWorkers",
        COALESCE(
          (SELECT COUNT(DISTINCT p.id)
           FROM person p
           LEFT JOIN temporary_occupation_assignment taa
             ON taa.person_id = p.id
             AND taa.start_date <= $2
             AND (taa.end_date IS NULL OR taa.end_date + INTERVAL '1 day' > $2)
           WHERE p.camp_id = $1::int
           AND p.current_status = 'ACTIVE'
           AND (
             (taa.id IS NULL AND p.occupation_id = o.id)
             OR (taa.id IS NOT NULL AND taa.temporary_occupation_id = o.id)
           )),
          0
        ) as "availableWorkers"
      FROM occupation o
      WHERE o.id IN (
        SELECT DISTINCT p.occupation_id
        FROM person p
        WHERE p.camp_id = $1::int AND p.occupation_id IS NOT NULL
        UNION
        SELECT DISTINCT taa.temporary_occupation_id
        FROM temporary_occupation_assignment taa
        JOIN person p ON p.id = taa.person_id
        WHERE p.camp_id = $1::int
        AND taa.start_date <= $2
        AND (taa.end_date IS NULL OR taa.end_date + INTERVAL '1 day' > $2)
      )
      ORDER BY o.name
    `;

    const results: OccupationCoverageRow[] = await this.dataSource.query(query, [campId, systemTime]);

    return results.map((row) => {
      const availableWorkers = Number(row.availableWorkers);
      const minimumRequired = Number(row.minimumRequiredWorkers);
      const coveragePercent =
        minimumRequired > 0 ? Number(((availableWorkers / minimumRequired) * 100).toFixed(2)) : 100;
      const criticalThreshold = Number(row.criticalThresholdPercent);

      return {
        occupationId: row.occupationId,
        occupationName: row.occupationName,
        minimumRequiredWorkers: minimumRequired,
        preferredWorkers: row.preferredWorkers ? Number(row.preferredWorkers) : null,
        criticalThresholdPercent: String(row.criticalThresholdPercent),
        availableWorkers,
        activeWorkers: Number(row.activeWorkers),
        coveragePercent,
        isCritical: availableWorkers === 0,
        isAtRisk: coveragePercent < criticalThreshold && availableWorkers < minimumRequired,
        deficit: Math.max(0, minimumRequired - availableWorkers),
        surplus: Math.max(0, availableWorkers - minimumRequired),
        campId: Number(row.campId),
      };
    });
  }

  async getOccupationCoverageById(
    occupationId: number,
    campId: number,
  ): Promise<OccupationCoverage | null> {
    const coverages = await this.getOccupationCoverageByCamp(campId);
    return coverages.find((c) => c.occupationId === occupationId) || null;
  }

  async getAvailablePersonsForReplacement(
    fromOccupationId: number,
    toOccupationId: number,
    campId: number,
  ): Promise<Array<{ id: number; name: string; lastName1: string; currentStatus: string }>> {
    const systemTime = this.systemTimeService ? this.systemTimeService.now() : new Date();
    const query = `
      SELECT p.id, p.name, p.last_name1, p.current_status
      FROM person p
      WHERE p.occupation_id = $1
      AND p.camp_id = $2
      AND p.current_status = 'ACTIVE'
      AND p.id NOT IN (
        SELECT person_id
        FROM temporary_occupation_assignment
        WHERE start_date <= $3
        AND (end_date IS NULL OR end_date + INTERVAL '1 day' > $3)
      )
      ORDER BY p.name
      LIMIT 10
    `;

    return await this.dataSource.query(query, [fromOccupationId, campId, systemTime]);
  }

  async getCriticalOccupationsByCamp(campId: number): Promise<OccupationCoverage[]> {
    const coverages = await this.getOccupationCoverageByCamp(campId);
    return coverages.filter((c) => c.isCritical || c.isAtRisk);
  }
}
