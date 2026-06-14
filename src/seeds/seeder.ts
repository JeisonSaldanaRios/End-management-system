import type { DataSource } from 'typeorm';

export async function runSeeder(_dataSource: DataSource): Promise<void> {
  // Seed data is currently managed outside this build path.
}
