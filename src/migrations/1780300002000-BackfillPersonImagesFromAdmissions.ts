import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillPersonImagesFromAdmissions1780300002000 implements MigrationInterface {
  name = 'BackfillPersonImagesFromAdmissions1780300002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE public.person AS person
      SET image_url = admission.photo_url
      FROM public.admission_request AS admission
      WHERE person.admission_request_id = admission.id
        AND person.image_url IS NULL
        AND admission.photo_url IS NOT NULL
        AND admission.status = 'APPROVED'
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
