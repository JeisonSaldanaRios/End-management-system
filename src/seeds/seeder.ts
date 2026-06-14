import { hash } from 'bcrypt';
import { DataSource } from 'typeorm';

type BaseCampUser = {
  username: string;
  email: string;
  identificationNumber: string;
  role: 'SYSTEM_ADMIN' | 'WORKER' | 'RESOURCE_MANAGEMENT' | 'TRAVEL_MANAGER';
};

export async function runSeeder(dataSource: DataSource): Promise<void> {
  const existingCampRows = await dataSource.query('SELECT id FROM camp LIMIT 1');

  if (existingCampRows.length > 0) {
    console.log('[seeder] Skipped: camps already exist.');
    return;
  }

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const passwordHash = await hash('Seed1234!', 10);
    const campNames = [
      'Alpha Bunker',
      'Sierra Base',
      'Delta Refuge',
      'Omega Fortress',
      'Echo Outpost',
    ];
    const campIds: number[] = [];

    for (let index = 0; index < campNames.length; index += 1) {
      const campNumber = index + 1;

      const insertedCamp = await queryRunner.query(
        `
          INSERT INTO camp (
            name,
            foundation_date,
            session_inactivity_minutes,
            status,
            latitude,
            longitude
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `,
        [campNames[index], '2024-01-01', 20, 'ACTIVE', 9.934739, -84.087502],
      );

      const campId: number = insertedCamp[0].id;
      campIds.push(campId);

      const usersForCamp: BaseCampUser[] = [
        {
          username: `admin_camp${campNumber}`,
          email: `admin@camp${campNumber}.com`,
          identificationNumber: `10000000${campNumber}`,
          role: 'SYSTEM_ADMIN',
        },
      ];

      if (campNumber === 1) {
        usersForCamp.push(
          {
            username: 'worker_camp1',
            email: 'worker@camp1.com',
            identificationNumber: '200000001',
            role: 'WORKER',
          },
          {
            username: 'resource_camp1',
            email: 'resource@camp1.com',
            identificationNumber: '200000002',
            role: 'RESOURCE_MANAGEMENT',
          },
          {
            username: 'travel_camp1',
            email: 'travel@camp1.com',
            identificationNumber: '200000003',
            role: 'TRAVEL_MANAGER',
          },
        );
      }

      for (const userData of usersForCamp) {
        const insertedRequest = await queryRunner.query(
          `
            INSERT INTO admission_request (
              name,
              last_name1,
              email,
              desired_username,
              birth_date,
              gender,
              status,
              camp_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `,
          [
            'Camp',
            'Admin',
            userData.email,
            userData.username,
            '1990-01-01',
            'MALE',
            'APPROVED',
            campId,
          ],
        );

        const requestId: number = insertedRequest[0].id;

        const insertedPerson = await queryRunner.query(
          `
            INSERT INTO person (
              name,
              last_name1,
              identification_number,
              birth_date,
              gender,
              current_status,
              camp_id,
              admission_request_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
          `,
          [
            'Camp',
            'Admin',
            userData.identificationNumber,
            '1990-01-01',
            'MALE',
            'ACTIVE',
            campId,
            requestId,
          ],
        );

        const personId: number = insertedPerson[0].id;

        await queryRunner.query(
          `
            INSERT INTO "system_user" (
              username,
              email,
              password_hash,
              role,
              status,
              camp_id,
              person_id,
              request_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            userData.username,
            userData.email,
            passwordHash,
            userData.role,
            'ACTIVE',
            campId,
            personId,
            requestId,
          ],
        );
      }
    }

    const insertedDrinkingWater = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Drinking Water', 'liters', 'WATER', 'Potable water for daily consumption'],
    );
    const waterId: number = insertedDrinkingWater[0].id;

    const insertedCannedFood = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Canned Food', 'units', 'FOOD', 'Non-perishable canned food rations'],
    );
    const foodId: number = insertedCannedFood[0].id;

    const insertedMedicalKit = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Medical Kit', 'units', 'MEDICAL', 'First aid and essential medicine'],
    );
    const medicalId: number = insertedMedicalKit[0].id;

    const insertedHygieneKit = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Hygiene Kit', 'units', 'HYGIENE', 'Soap, toothpaste, and disinfectant'],
    );
    const hygieneId: number = insertedHygieneKit[0].id;

    const insertedAmmunition = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Ammunition', 'rounds', 'AMMUNITION', 'Bullets for defense weapons'],
    );
    const ammoId: number = insertedAmmunition[0].id;

    const insertedTacticalHelmet = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Tactical Helmet', 'units', 'DEFENSE', 'Protective headgear'],
    );
    const helmetId: number = insertedTacticalHelmet[0].id;

    const insertedBulletproofVest = await queryRunner.query(
      `
        INSERT INTO resource_type (name, unit_of_measure, category, description)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      ['Bulletproof Vest', 'units', 'DEFENSE', 'Body armor'],
    );
    const vestId: number = insertedBulletproofVest[0].id;

    await queryRunner.query(
      `
        INSERT INTO occupation (
          name,
          description,
          collects_resources,
          participates_in_expeditions,
          resource_type_id,
          daily_amount_produced,
          daily_ration_consumed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        'Water Collector',
        'Collects and purifies water daily',
        true,
        false,
        waterId,
        '10.00',
        '1.00',
      ],
    );

    await queryRunner.query(
      `
        INSERT INTO occupation (
          name,
          description,
          collects_resources,
          participates_in_expeditions,
          resource_type_id,
          daily_amount_produced,
          daily_ration_consumed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      ['Food Gatherer', 'Gathers and prepares food daily', true, false, foodId, '5.00', '1.00'],
    );

    await queryRunner.query(
      `
        INSERT INTO occupation (
          name,
          description,
          collects_resources,
          participates_in_expeditions,
          resource_type_id,
          daily_amount_produced,
          daily_ration_consumed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        'Engineer',
        'Maintains infrastructure and creates ammo',
        true,
        false,
        ammoId,
        '10.00',
        '1.00',
      ],
    );

    await queryRunner.query(
      `
        INSERT INTO occupation (
          name,
          description,
          collects_resources,
          participates_in_expeditions,
          resource_type_id,
          daily_amount_produced,
          daily_ration_consumed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        'Medic',
        'Provides medical care and creates medical kits',
        true,
        false,
        medicalId,
        '1.00',
        '1.00',
      ],
    );

    await queryRunner.query(
      `
        INSERT INTO occupation (
          name,
          description,
          collects_resources,
          participates_in_expeditions,
          resource_type_id,
          daily_amount_produced,
          daily_ration_consumed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        'Scout',
        'Goes on expeditions. Gathers food when at camp',
        true,
        true,
        foodId,
        '3.00',
        '1.00',
      ],
    );

    await queryRunner.query(
      `
        INSERT INTO occupation (
          name,
          description,
          collects_resources,
          participates_in_expeditions,
          resource_type_id,
          daily_amount_produced,
          daily_ration_consumed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      ['Guard', 'Protects the camp perimeter. Does not gather', false, false, null, '0.00', '1.00'],
    );

    for (const campId of campIds) {
      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, waterId, '200.00', '50.00'],
      );

      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, foodId, '100.00', '30.00'],
      );

      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, medicalId, '20.00', '5.00'],
      );

      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, hygieneId, '30.00', '10.00'],
      );

      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, ammoId, '500.00', '100.00'],
      );

      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, helmetId, '15.00', '5.00'],
      );

      await queryRunner.query(
        `
          INSERT INTO camp_inventory (
            camp_id,
            resource_type_id,
            current_amount,
            minimum_alert_amount
          )
          VALUES ($1, $2, $3, $4)
        `,
        [campId, vestId, '10.00', '5.00'],
      );
    }

    await queryRunner.commitTransaction();
    console.log('[seeder] Completed: initial camps and users were inserted.');
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error('[seeder] Failed: transaction rolled back.');
    throw error;
  } finally {
    await queryRunner.release();
  }
}
