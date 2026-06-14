import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TransferService } from './transfer.service';

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../common/validation/assert-exists', () => ({
  assertEntityExists: jest.fn(() => Promise.resolve()),
}));

const repository: any = {
  findById: jest.fn(),
  findByRequestId: jest.fn(),
  findAllAndCount: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  resolveRequestScope: jest.fn(),
  resolveTransferScope: jest.fn(),
  countTransferPeople: jest.fn(),
  countTransferTransportStaff: jest.fn(),
  countAppliedTransferRationMovements: jest.fn(),
  countAppliedTransferMovements: jest.fn(),
  countAppliedTransferSentMovements: jest.fn(),
  countAppliedTransferReceivedMovements: jest.fn(),
  findDeliveredResourcesByTransferId: jest.fn(),
  findRationInventoryCandidate: jest.fn(),
  countTransferRequestedPeople: jest.fn(),
  createTransferHistoryEntry: jest.fn(),
  setManifestInTransit: jest.fn(),
  completeManifest: jest.fn(),
  cancelManifest: jest.fn(),
};

const notificationService: any = {
  notifyCampRoles: jest.fn(),
};

const inventoryMovementService: any = {
  createMovement: jest.fn(),
};

const queryRunner: any = {
  connect: jest.fn(),
  startTransaction: jest.fn(),
  query: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
};

const dataSource: any = {
  getRepository: jest.fn().mockReturnValue({
    findOne: jest.fn(),
  }),
  query: jest.fn(),
  createQueryRunner: jest.fn().mockReturnValue(queryRunner),
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TransferService', () => {
  let service: TransferService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.countTransferTransportStaff.mockResolvedValue(1);
    repository.countAppliedTransferRationMovements.mockResolvedValue(0);
    repository.countAppliedTransferSentMovements.mockResolvedValue(0);
    repository.countAppliedTransferReceivedMovements.mockResolvedValue(0);
    repository.countTransferRequestedPeople.mockResolvedValue(0);
    queryRunner.query.mockResolvedValue([]);
    repository.findRationInventoryCandidate.mockResolvedValue({
      resourceTypeId: 9,
      currentAmount: '100.00',
      minimumAlertAmount: '0.00',
    });
    dataSource.query.mockResolvedValue([{ current_amount: '100.00', minimum_alert_amount: '0.00' }]);
    service = new TransferService(
      repository as never,
      notificationService as never,
      inventoryMovementService as never,
      dataSource as never,
    );
  });

  // ─── syncTransferRations ───────────────────────────────────────────────

  describe('syncTransferRations', () => {
    it('returns null if transfer not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.syncTransferRations(1)).toBeNull();
    });

    it('throws if camp not found', async () => {
      repository.findById.mockResolvedValue({ id: 1, requestId: 10 });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      dataSource.getRepository().findOne.mockResolvedValue(null);

      await expect(service.syncTransferRations(1)).rejects.toThrow(
        'Campamento de origen no encontrado',
      );
    });

    it('sets rations to 0 if dates missing', async () => {
      repository.findById.mockResolvedValue({ id: 1, requestId: 10 }); // no dates
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      dataSource.getRepository().findOne.mockResolvedValue({ minimumDailyRationPerPerson: '1.5' });
      repository.update.mockResolvedValue({ id: 1, rationsForTrip: '0.00' });

      await service.syncTransferRations(1);

      expect(repository.update).toHaveBeenCalledWith(1, { rationsForTrip: '0.00' });
    });

    it('sets rations to 0 if people count is 0', async () => {
      const dep = new Date('2026-05-15T00:00:00Z');
      const arr = new Date('2026-05-16T00:00:00Z');
      repository.findById.mockResolvedValue({
        id: 1,
        requestId: 10,
        plannedDepartureDate: dep,
        plannedArrivalDate: arr,
      });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      dataSource.getRepository().findOne.mockResolvedValue({ minimumDailyRationPerPerson: '1.5' });
      repository.countTransferPeople.mockResolvedValue(0);
      repository.update.mockResolvedValue({ id: 1, rationsForTrip: '0.00' });

      await service.syncTransferRations(1);

      expect(repository.update).toHaveBeenCalledWith(1, { rationsForTrip: '0.00' });
    });

    it('calculates total rations successfully', async () => {
      const dep = new Date('2026-05-15T00:00:00Z');
      const arr = new Date('2026-05-17T00:00:00Z'); // 2 days diff
      repository.findById.mockResolvedValue({
        id: 1,
        requestId: 10,
        plannedDepartureDate: dep,
        plannedArrivalDate: arr,
      });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      dataSource.getRepository().findOne.mockResolvedValue({ minimumDailyRationPerPerson: '1.5' });
      repository.countTransferPeople.mockResolvedValue(4);
      repository.update.mockResolvedValue({ id: 1, rationsForTrip: '12.00' });

      await service.syncTransferRations(1);

      // 4 people * 1.5 ration * 2 days = 12
      expect(repository.update).toHaveBeenCalledWith(1, { rationsForTrip: '12.00' });
    });
  });

  // ─── createTransfer ────────────────────────────────────────────────────

  describe('createTransfer', () => {
    it('throws if transfer already exists for request', async () => {
      repository.findByRequestId.mockResolvedValue({ id: 99 });
      await expect(service.createTransfer({ requestId: 1 } as never)).rejects.toThrow(
        'Ya existe un traslado para esta solicitud',
      );
    });

    it('creates transfer, syncs rations and notifies', async () => {
      repository.findByRequestId.mockResolvedValue(null);
      repository.create.mockResolvedValue({ id: 1, requestId: 10, status: 'PENDING_DEPARTURE' });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      dataSource.getRepository().findOne.mockResolvedValue({ minimumDailyRationPerPerson: '1.5' });
      repository.countTransferPeople.mockResolvedValue(0); // to make sync simple

      const result = await service.createTransfer({ requestId: 10 } as never);

      expect(repository.create).toHaveBeenCalled();
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2); // Origin and dest
      expect(result.id).toBe(1);
    });
  });

  // ─── updateTransfer ────────────────────────────────────────────────────

  describe('updateTransfer', () => {
    it('returns null if not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.updateTransfer(1, {})).toBeNull();
    });

    it('throws if completing without approvals', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        departureApprovedBy: null,
        arrivalApprovedBy: null,
        requestId: 10,
      });
      repository.resolveRequestScope.mockResolvedValue({
        originCampId: 1,
        destinationCampId: 2,
        createdBy: null,
        respondedBy: null,
      });

      await expect(service.updateTransfer(1, { status: 'COMPLETED' })).rejects.toThrow(
        /aprobaciones/i,
      );
    });

    it('throws if changing request and new request already has a transfer', async () => {
      repository.findById.mockResolvedValue({ id: 1, requestId: 10 });
      repository.findByRequestId.mockResolvedValue({ id: 2 }); // Another transfer exists for 20

      await expect(service.updateTransfer(1, { requestId: 20 })).rejects.toThrow(
        'Ya existe un traslado para esta solicitud',
      );
    });

    it('updates, creates history and applies inventory if COMPLETED', async () => {
      repository.findById.mockResolvedValue({
        id: 1,
        requestId: 10,
        status: 'PENDING_DEPARTURE',
        rationsForTrip: '12.00',
      });
      repository.update.mockResolvedValue({
        id: 1,
        requestId: 10,
        status: 'COMPLETED',
        departureApprovedBy: 5,
        arrivalApprovedBy: 5,
      });
      repository.resolveRequestScope.mockResolvedValue({
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 1,
      });
      repository.countAppliedTransferSentMovements.mockResolvedValue(0);
      repository.countAppliedTransferReceivedMovements.mockResolvedValue(0);
      repository.findDeliveredResourcesByTransferId.mockResolvedValue([
        { id: 100, resourceTypeId: 50, sentAmount: '10', receivedAmount: '10' },
      ]);
      dataSource.getRepository().findOne.mockResolvedValue({ minimumDailyRationPerPerson: '1.5' });

      await service.updateTransfer(1, {
        status: 'COMPLETED',
        arrivalApprovedBy: 5,
        departureApprovedBy: 5,
      });

      expect(repository.update).toHaveBeenCalled();
      expect(repository.createTransferHistoryEntry).toHaveBeenCalled();
      expect(inventoryMovementService.createMovement).toHaveBeenCalledTimes(3);
      expect(inventoryMovementService.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({ movementType: 'TRANSFER_SENT', campId: 2 }),
      );
      expect(inventoryMovementService.createMovement).toHaveBeenCalledWith(
        expect.objectContaining({ movementType: 'TRANSFER_RECEIVED', campId: 1 }),
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
    });
  });

  // ─── deleteTransfer ────────────────────────────────────────────────────

  describe('deleteTransfer', () => {
    it('returns false if not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.deleteTransfer(1)).toBe(false);
    });

    it('deletes and notifies', async () => {
      repository.findById.mockResolvedValue({ id: 1, requestId: 10 });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      repository.delete.mockResolvedValue(true);

      const result = await service.deleteTransfer(1);

      expect(result).toBe(true);
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
    });
  });

  // ─── scope assertions ───────────────────────────────────────────────────

  describe('scope assertions', () => {
    it('assertRequestCampAccess throws if request scope does not include camp', async () => {
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      await expect(service.assertRequestCampAccess(10, 3)).rejects.toThrow(
        'You can only access transfers involving your camp',
      );
    });

    it('assertTransferCampAccess throws NotFound if no scope', async () => {
      repository.resolveTransferScope.mockResolvedValue(null);
      await expect(service.assertTransferCampAccess(99, 1)).rejects.toThrow('Transfer not found');
    });

    it('assertTransferCampAccess throws if camp not in scope', async () => {
      repository.resolveTransferScope.mockResolvedValue({ originCampId: 5, destinationCampId: 6 });
      await expect(service.assertTransferCampAccess(1, 3)).rejects.toThrow(
        'You can only access transfers involving your camp',
      );
    });
  });
  describe('updateTransportStaff', () => {
    it('throws if transfer is not pending departure', async () => {
      repository.findById.mockResolvedValue({ id: 1, status: 'IN_TRANSIT', requestId: 10 });

      await expect(
        service.updateTransportStaff(1, { transportPersonIds: [31] }),
      ).rejects.toThrow('Solo se puede editar personal operativo antes de la salida');
    });

    it('throws if manifest has no scout', async () => {
      const dep = new Date('2026-06-10T00:00:00Z');
      const arr = new Date('2026-06-11T00:00:00Z');
      repository.findById.mockResolvedValue({
        id: 1,
        requestId: 10,
        status: 'PENDING_DEPARTURE',
        plannedDepartureDate: dep,
        plannedArrivalDate: arr,
      });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      dataSource.query.mockResolvedValueOnce([
        { id: 31, camp_id: 2, current_status: 'ACTIVE', occupation_name: 'Medic' },
      ]);

      await expect(
        service.updateTransportStaff(1, { transportPersonIds: [31] }),
      ).rejects.toThrow('Debe asignar al menos una persona operativa con oficio Scout');
    });

    it('replaces manifest and recalculates reserved rations', async () => {
      const dep = new Date('2026-06-10T00:00:00Z');
      const arr = new Date('2026-06-12T00:00:00Z');
      repository.findById
        .mockResolvedValueOnce({
          id: 1,
          requestId: 10,
          status: 'PENDING_DEPARTURE',
          plannedDepartureDate: dep,
          plannedArrivalDate: arr,
        })
        .mockResolvedValueOnce({ id: 1, requestId: 10, status: 'PENDING_DEPARTURE', rationsForTrip: '6.00' });
      repository.resolveRequestScope.mockResolvedValue({ originCampId: 1, destinationCampId: 2 });
      repository.countTransferRequestedPeople.mockResolvedValue(1);
      dataSource.getRepository().findOne.mockResolvedValue({ minimumDailyRationPerPerson: '1' });
      repository.findRationInventoryCandidate.mockResolvedValue({
        resourceTypeId: 9,
        currentAmount: '100.00',
        minimumAlertAmount: '10.00',
      });
      dataSource.query
        .mockResolvedValueOnce([
          { id: 31, camp_id: 2, current_status: 'ACTIVE', occupation_name: 'Scout' },
          { id: 32, camp_id: 2, current_status: 'ACTIVE', occupation_name: 'Medic' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: '5.00' }]);
      queryRunner.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return [{ id: 1 }];
        return [];
      });

      const result = await service.updateTransportStaff(1, { transportPersonIds: [31, 32] });

      expect(result?.rationsForTrip).toBe('6.00');
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('rations_for_trip = $2'),
        [1, '6.00'],
      );
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
    });
  });
});
