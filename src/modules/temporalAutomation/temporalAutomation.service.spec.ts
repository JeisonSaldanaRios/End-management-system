import { TemporalAutomationService } from './temporalAutomation.service';

const campInventoryRepo = { save: jest.fn() };
const dailyCollectionRecordRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
const dailyConsumptionRepo = { save: jest.fn(), create: jest.fn() };
const expeditionRepo = { save: jest.fn() };
const expeditionParticipantRepo = {}; // unused directly in service? It's injected but not used.
const inventoryAlertRepo = { save: jest.fn(), create: jest.fn() };
const inventoryMovementRepo = { save: jest.fn(), create: jest.fn() };

const expeditionParticipantRepository = {
  getActivePersonIdsByExpedition: jest.fn(),
  getTrackedExpeditionStatusesByPersonId: jest.fn(),
};

const expeditionRepository = {
  applyDepartureProvisioningIfNeeded: jest.fn(),
};

const temporalAutomationRepository = {
  findDailyCycleCamps: jest.fn(),
  findResourceTypeByCategory: jest.fn(),
  findAutomationRecorderUserId: jest.fn(),
  countCampOperationalPeople: jest.fn(),
  getOrCreateCampInventory: jest.fn(),
  findProductionOccupationRows: jest.fn(),
  findProductionOccupationsByIds: jest.fn(),
  findCampInventories: jest.fn(),
  findUnresolvedInventoryAlert: jest.fn(),
  findRelevantOccupationsForStaffing: jest.fn(),
  findActivePeopleOccupationIds: jest.fn(),
  findDailyCollectionRows: jest.fn(),
  findExpeditionsForAutoStateUpdate: jest.fn(),
  findPersonStatusById: jest.fn(),
  updatePersonStatus: jest.fn(),
  findActiveUserIdsByCampAndPersonIds: jest.fn(),
};

const notificationService = {
  notifyCampRoles: jest.fn(),
  notifyUsers: jest.fn(),
};

const systemTimeService = {
  now: jest.fn(),
};

describe('TemporalAutomationService', () => {
  let service: TemporalAutomationService;
  const NOW = new Date('2026-05-15T10:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    systemTimeService.now.mockReturnValue(new Date(NOW));

    dailyCollectionRecordRepo.create.mockImplementation((x) => x);
    dailyConsumptionRepo.create.mockImplementation((x) => x);
    inventoryAlertRepo.create.mockImplementation((x) => x);
    inventoryMovementRepo.create.mockImplementation((x) => x);

    inventoryAlertRepo.save.mockImplementation((x) => Promise.resolve({ id: 123, ...x }));
    inventoryMovementRepo.save.mockImplementation((x) => Promise.resolve({ id: 123, ...x }));
    temporalAutomationRepository.findActiveUserIdsByCampAndPersonIds.mockResolvedValue([]);

    service = new TemporalAutomationService(
      campInventoryRepo as never,
      dailyCollectionRecordRepo as never,
      dailyConsumptionRepo as never,
      expeditionRepo as never,
      expeditionParticipantRepo as never,
      expeditionParticipantRepository as never,
      expeditionRepository as never,
      inventoryAlertRepo as never,
      inventoryMovementRepo as never,
      temporalAutomationRepository as never,
      notificationService as never,
      systemTimeService as never,
    );
  });

  describe('runDailyResourceCycle', () => {
    it('returns early if FOOD or WATER resources are missing', async () => {
      temporalAutomationRepository.findDailyCycleCamps.mockResolvedValue([{ id: 1 }]);
      temporalAutomationRepository.findResourceTypeByCategory.mockResolvedValue(null);

      await service.runDailyResourceCycle();

      expect(temporalAutomationRepository.countCampOperationalPeople).not.toHaveBeenCalled();
    });

    it('processes camps, applying consumption and production', async () => {
      temporalAutomationRepository.findDailyCycleCamps.mockResolvedValue([
        { id: 1, minimumDailyRationPerPerson: '2.00', maxPersonCapacity: 10 },
      ]);
      temporalAutomationRepository.findResourceTypeByCategory
        .mockResolvedValueOnce({ id: 101 }) // FOOD
        .mockResolvedValueOnce({ id: 102 }); // WATER
      temporalAutomationRepository.findAutomationRecorderUserId.mockResolvedValue(99);
      temporalAutomationRepository.countCampOperationalPeople.mockResolvedValue(5);

      // Collection records
      temporalAutomationRepository.findDailyCollectionRows.mockResolvedValue([
        { personId: 5, resourceTypeId: 101, expectedAmount: '10.00' },
      ]);
      dailyCollectionRecordRepo.findOne.mockResolvedValue(null);

      // Camp Inventory
      temporalAutomationRepository.getOrCreateCampInventory.mockResolvedValue({
        currentAmount: '100',
        minimumAlertAmount: '10',
        resourceTypeId: 101,
      });

      // Production
      temporalAutomationRepository.findProductionOccupationRows.mockResolvedValue([
        { occupation_id: 1 },
      ]);
      temporalAutomationRepository.findProductionOccupationsByIds.mockResolvedValue([
        { id: 1, resourceTypeId: 101, dailyAmountProduced: '20' },
      ]);

      // Alerts & Overpopulation
      temporalAutomationRepository.findCampInventories.mockResolvedValue([]);
      temporalAutomationRepository.findRelevantOccupationsForStaffing.mockResolvedValue([]);

      await service.runDailyResourceCycle();

      // Total ration: 5 people * 2.0 = 10
      // 2 consumptions (food & water)
      expect(dailyConsumptionRepo.save).toHaveBeenCalledTimes(2);
      expect(dailyConsumptionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cantidad: '10.00' }),
      );

      // 1 collection record
      expect(dailyCollectionRecordRepo.save).toHaveBeenCalledTimes(1);
      expect(inventoryMovementRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          campId: 1,
          resourceTypeId: 101,
          amount: '10.00',
          movementType: 'DAILY_COLLECTION',
          sourceType: 'temporal_automation',
        }),
      );

      // Inventory updates: 2 from consumption + 1 from production = 3
      expect(campInventoryRepo.save).toHaveBeenCalledTimes(3);

      // Movements: 1 daily collection + 2 consumptions + 1 production = 4
      expect(inventoryMovementRepo.save).toHaveBeenCalledTimes(4);

      expect(dailyCollectionRecordRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          movementId: 123,
        }),
      );
    });

    it('handles camp overpopulation and missing staff alerts', async () => {
      temporalAutomationRepository.findDailyCycleCamps.mockResolvedValue([
        { id: 1, minimumDailyRationPerPerson: '1.00', maxPersonCapacity: 2 },
      ]);
      temporalAutomationRepository.findResourceTypeByCategory.mockResolvedValue({ id: 101 });
      temporalAutomationRepository.findAutomationRecorderUserId.mockResolvedValue(null); // No recorder
      temporalAutomationRepository.countCampOperationalPeople.mockResolvedValue(5); // 5 > 2 capacity
      temporalAutomationRepository.findDailyCollectionRows.mockResolvedValue([]);
      temporalAutomationRepository.getOrCreateCampInventory.mockResolvedValue({
        currentAmount: '100',
        minimumAlertAmount: '10',
        resourceTypeId: 101,
      });
      temporalAutomationRepository.findProductionOccupationRows.mockResolvedValue([]);
      temporalAutomationRepository.findCampInventories.mockResolvedValue([
        { resourceTypeId: 101, currentAmount: '5', minimumAlertAmount: '10' },
      ]);
      temporalAutomationRepository.findUnresolvedInventoryAlert.mockResolvedValue(null);
      temporalAutomationRepository.findRelevantOccupationsForStaffing.mockResolvedValue([
        { id: 1, name: 'Doctor' },
      ]);
      temporalAutomationRepository.findActivePeopleOccupationIds.mockResolvedValue([]); // No staff for Doctor

      await service.runDailyResourceCycle();

      // Inventory Alert
      expect(inventoryAlertRepo.save).toHaveBeenCalledTimes(1);

      // Notifications: Inventory Alert, Overpopulation, Occupation Without Staff
      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        1,
        expect.arrayContaining(['SYSTEM_ADMIN']),
        expect.objectContaining({ type: 'INVENTORY_ALERT' }),
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        1,
        ['SYSTEM_ADMIN'],
        expect.objectContaining({ type: 'OVERPOPULATION_ALERT' }),
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        1,
        ['SYSTEM_ADMIN'],
        expect.objectContaining({ type: 'OCCUPATION_WITHOUT_STAFF' }),
      );
    });
  });

  describe('runHourlyExpeditionStateUpdate', () => {
    it('returns early if no expeditions', async () => {
      temporalAutomationRepository.findExpeditionsForAutoStateUpdate.mockResolvedValue([]);
      await service.runHourlyExpeditionStateUpdate();
      expect(expeditionRepo.save).not.toHaveBeenCalled();
    });

    it('updates status and triggers provisioning for newly IN_PROGRESS expedition', async () => {
      const departure = new Date(NOW.getTime() - 1000); // Past departure
      const returnDate = new Date(NOW.getTime() + 1000000); // Future return
      temporalAutomationRepository.findExpeditionsForAutoStateUpdate.mockResolvedValue([
        {
          id: 1,
          status: 'PLANNED',
          plannedDepartureDate: departure,
          plannedReturnDate: returnDate,
          extraDaysAvailable: 0,
          extraDaysUsed: 0,
          campId: 1,
        },
      ]);

      expeditionParticipantRepository.getActivePersonIdsByExpedition.mockResolvedValue([10]);
      temporalAutomationRepository.findPersonStatusById.mockResolvedValue({
        id: 10,
        currentStatus: 'ACTIVE',
      });
      expeditionParticipantRepository.getTrackedExpeditionStatusesByPersonId.mockResolvedValue([
        'IN_PROGRESS',
      ]);

      await service.runHourlyExpeditionStateUpdate();

      expect(expeditionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'IN_PROGRESS' }),
      );
      expect(expeditionRepository.applyDepartureProvisioningIfNeeded).toHaveBeenCalledWith(1, NOW);
      expect(temporalAutomationRepository.updatePersonStatus).toHaveBeenCalledWith(
        10,
        'ON_EXPEDITION',
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalled();
    });

    it('updates status to DELAYED and calculates extra days', async () => {
      const returnDate = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      temporalAutomationRepository.findExpeditionsForAutoStateUpdate.mockResolvedValue([
        {
          id: 1,
          status: 'IN_PROGRESS',
          plannedDepartureDate: new Date(0),
          plannedReturnDate: returnDate,
          extraDaysAvailable: 5,
          extraDaysUsed: 0,
          campId: 1,
        },
      ]);
      expeditionParticipantRepository.getActivePersonIdsByExpedition.mockResolvedValue([]);

      await service.runHourlyExpeditionStateUpdate();

      expect(expeditionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DELAYED', extraDaysUsed: 2 }),
      );
    });

    it('updates status to LOST if past extra days', async () => {
      const returnDate = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      temporalAutomationRepository.findExpeditionsForAutoStateUpdate.mockResolvedValue([
        {
          id: 1,
          status: 'DELAYED',
          plannedDepartureDate: new Date(0),
          plannedReturnDate: returnDate,
          extraDaysAvailable: 2,
          extraDaysUsed: 2,
          campId: 1,
        },
      ]);
      expeditionParticipantRepository.getActivePersonIdsByExpedition.mockResolvedValue([]);

      await service.runHourlyExpeditionStateUpdate();

      expect(expeditionRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'LOST' }));
    });

    it('updates status to COMPLETED if returned', async () => {
      temporalAutomationRepository.findExpeditionsForAutoStateUpdate.mockResolvedValue([
        {
          id: 1,
          status: 'IN_PROGRESS',
          plannedDepartureDate: new Date(0),
          plannedReturnDate: new Date(),
          actualReturnDate: new Date(),
          extraDaysAvailable: 0,
          extraDaysUsed: 0,
          campId: 1,
        },
      ]);
      expeditionParticipantRepository.getActivePersonIdsByExpedition.mockResolvedValue([]);

      await service.runHourlyExpeditionStateUpdate();

      expect(expeditionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'COMPLETED' }),
      );
    });
  });
});
