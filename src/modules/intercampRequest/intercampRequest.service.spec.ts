import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntercampRequestService } from './intercampRequest.service';
import { SystemTimeService } from '../systemTime/systemTime.service';


const repository = {
  findCampById: jest.fn(),
  findUserById: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findAllAndCount: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findRequestResourceAmountsByRequestId: jest.fn(),
  findCampInventoryAmount: jest.fn(),
  findCampInventoryWithMinimum: jest.fn(),
  findCommittedTransferAmountByCampAndResourceType: jest.fn(),
  findRationInventoryCandidate: jest.fn(),
  findCommittedTransferRationsByCamp: jest.fn(),
  countRequestDetailsByRequestId: jest.fn(),
  findPersonDetailRequirementsByRequestId: jest.fn(),
};

const notificationService = {
  notifyUser: jest.fn(),
  notifyCampRoles: jest.fn(),
};

const transferService = {
  getTransferByRequestId: jest.fn(),
  createTransfer: jest.fn(),
  syncTransferRations: jest.fn(),
  updateTransfer: jest.fn(),
  createRequestedPersonManifestFromRequest: jest.fn(),
};

const transferPersonService = {
  autoAssignGroupForTransfer: jest.fn(),
  assignTransportStaffForTransfer: jest.fn(),
  canFulfillRequirements: jest.fn(),
};


const systemTimeService: jest.Mocked<SystemTimeService> = {
  now: jest.fn().mockReturnValue(new Date()),
  nowIso: jest.fn(),
  getOffset: jest.fn(),
  setOffset: jest.fn(),
  advanceTime: jest.fn(),
  resetTime: jest.fn(),
} as any;

describe('IntercampRequestService', () => {
  let service: IntercampRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository.countRequestDetailsByRequestId.mockResolvedValue(1);
    repository.findPersonDetailRequirementsByRequestId.mockResolvedValue([]);
    repository.findRationInventoryCandidate.mockResolvedValue({
      resourceTypeId: 99,
      currentAmount: '1000',
      minimumAlertAmount: '0',
    });
    repository.findCommittedTransferRationsByCamp.mockResolvedValue('0');
    transferService.syncTransferRations.mockResolvedValue({ id: 1, rationsForTrip: '10.00' });
    service = new IntercampRequestService(
      repository as never,
      notificationService as never,
      transferService as never,
      transferPersonService as never,
      systemTimeService,
    );
  });


  const setupValidRouting = () => {
    repository.findCampById.mockImplementation(async (id) => ({ id }));
    repository.findUserById.mockImplementation(async (id) => {
      if (id === 10) return { id, campId: 1 }; // creator matches origin
      if (id === 20) return { id, campId: 2 }; // responder matches destination
      return null;
    });
  };

  describe('createRequest', () => {
    it('throws if origin and destination are the same', async () => {
      await expect(
        service.createRequest({ originCampId: 1, destinationCampId: 1 } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws if origin camp not found', async () => {
      repository.findCampById.mockResolvedValueOnce(null);
      await expect(
        service.createRequest({ originCampId: 1, destinationCampId: 2 } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if creator user camp does not match origin', async () => {
      repository.findCampById.mockResolvedValue({ id: 1 });
      repository.findUserById.mockResolvedValue({ id: 10, campId: 99 });
      await expect(
        service.createRequest({ originCampId: 1, destinationCampId: 2, createdBy: 10 } as never),
      ).rejects.toThrow('El usuario creador no pertenece al campamento de origen');
    });

    it('creates request draft on success', async () => {
      setupValidRouting();
      repository.create.mockResolvedValue({
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'DRAFT',
      });

      const result = await service.createRequest({
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        requestType: 'RESOURCE_REQUEST',
      } as never);

      expect(repository.create).toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'DRAFT',
          responseDate: null,
          respondedBy: null,
        }),
      );
      expect(notificationService.notifyUser).not.toHaveBeenCalled();
      expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
      expect(result.id).toBe(1);
    });
  });

  describe('submitRequest', () => {
    it('submits draft and notifies destination', async () => {
      setupValidRouting();
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'DRAFT',
        plannedDepartureDate: new Date(Date.now() + 86400000),
        plannedArrivalDate: new Date(Date.now() + 2 * 86400000),
      };
      repository.findById.mockResolvedValue(req);
      repository.countRequestDetailsByRequestId.mockResolvedValue(1);
      repository.update.mockResolvedValue({ ...req, status: 'PENDING' });

      const result = await service.submitRequest(1, {
        userId: 10,
        campId: 1,
        rol: 'RESOURCE_MANAGEMENT',
      });

      expect(result?.status).toBe('PENDING');
      expect(notificationService.notifyUser).toHaveBeenCalledWith(10, expect.any(Object));
      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        2,
        expect.any(Array),
        expect.any(Object),
      );
    });
  });


  describe('updateRequest', () => {
    it('returns null if request not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(
        await service.updateRequest(1, {}, { userId: 10, campId: 1, rol: 'RESOURCE_MANAGEMENT' }),
      ).toBeNull();
    });

    it('validates requirements when approving', async () => {
      setupValidRouting();
      repository.findById.mockResolvedValue({
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        plannedDepartureDate: new Date(Date.now() + 86400000),
        plannedArrivalDate: new Date(Date.now() + 2 * 86400000),
        personRequirements: [],
      });
      repository.findPersonDetailRequirementsByRequestId.mockResolvedValue([
        { occupationId: 5, quantity: 5 },
      ]);
      repository.update.mockResolvedValue({
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'APPROVED',
        plannedDepartureDate: new Date(Date.now() + 86400000),
        plannedArrivalDate: new Date(Date.now() + 2 * 86400000),
        personRequirements: [],
      });
      repository.findRequestResourceAmountsByRequestId.mockResolvedValue([]);
      transferService.getTransferByRequestId.mockResolvedValue({ id: 1 });

      await service.updateRequest(
        1,
        { status: 'APPROVED', transportPersonIds: [31, 32] },
        { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
      );

      expect(transferPersonService.assignTransportStaffForTransfer).toHaveBeenCalledWith(
        1,
        2,
        [31, 32],
      );
    });

    it('creates auto-transfer when approved and needs it', async () => {
      setupValidRouting();
      const plannedDepartureDate = new Date(Date.now() + 86400000);
      const plannedArrivalDate = new Date(Date.now() + 2 * 86400000);
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'PENDING',
        personRequirements: [],
        plannedDepartureDate,
        plannedArrivalDate,
      };
      repository.findById.mockResolvedValue(req);
      repository.update.mockResolvedValue({ ...req, status: 'APPROVED' });
      repository.findPersonDetailRequirementsByRequestId.mockResolvedValue([
        { occupationId: 2, quantity: 2 },
      ]);

      repository.findRequestResourceAmountsByRequestId.mockResolvedValue([]);
      repository.findCampInventoryWithMinimum.mockResolvedValue({ current: '100', minimum: '0' });
      repository.findCommittedTransferAmountByCampAndResourceType.mockResolvedValue('0');
      transferService.getTransferByRequestId.mockResolvedValue(null);
      transferService.createTransfer.mockResolvedValue({ id: 100 });
      transferPersonService.canFulfillRequirements.mockResolvedValue(true);

      await service.updateRequest(
        1,
        { status: 'APPROVED', transportPersonIds: [31, 32] },
        { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
      );

      expect(transferService.createTransfer).toHaveBeenCalled();
      expect(transferPersonService.assignTransportStaffForTransfer).toHaveBeenCalledWith(
        100,
        2,
        [31, 32],
      );
      expect(transferService.createRequestedPersonManifestFromRequest).toHaveBeenCalledWith(
        100,
        1,
        2,
      );
      expect(transferService.syncTransferRations).toHaveBeenCalledWith(100);
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2); // Origin and Dest
    });

    it('throws if reserved rations would leave food below minimum when approving', async () => {
      setupValidRouting();
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'PENDING',
        personRequirements: [],
        plannedDepartureDate: new Date(Date.now() + 86400000),
        plannedArrivalDate: new Date(Date.now() + 2 * 86400000),
      };
      repository.findById.mockResolvedValue(req);
      repository.update.mockResolvedValue({ ...req, status: 'APPROVED' });
      repository.findRequestResourceAmountsByRequestId.mockResolvedValue([]);
      repository.findRationInventoryCandidate.mockResolvedValue({
        resourceTypeId: 99,
        currentAmount: '20',
        minimumAlertAmount: '10',
      });
      repository.findCommittedTransferRationsByCamp.mockResolvedValue('5');
      transferService.getTransferByRequestId.mockResolvedValue({ id: 100 });
      transferService.syncTransferRations.mockResolvedValue({ id: 100, rationsForTrip: '8' });

      await expect(
        service.updateRequest(
          1,
          { status: 'APPROVED', transportPersonIds: [31, 32] },
          { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
        ),
      ).rejects.toThrow(
        'No se puede aprobar el traslado: las raciones quedarian por debajo del minimo requerido (10)',
      );
    });

    it('throws if planned departure is in the past when approving', async () => {
      setupValidRouting();
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'PENDING',
        personRequirements: [],
        plannedDepartureDate: new Date(Date.now() - 86400000),
        plannedArrivalDate: new Date(Date.now() + 86400000),
      };
      repository.findById.mockResolvedValue(req);
      repository.findRequestResourceAmountsByRequestId.mockResolvedValue([]);

      await expect(
        service.updateRequest(
          1,
          { status: 'APPROVED', transportPersonIds: [31, 32] },
          { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
        ),
      ).rejects.toThrow('No se puede aprobar una solicitud con la fecha planeada en el pasado');
    });

    it('throws if inventory is insufficient when approving', async () => {
      setupValidRouting();
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'PENDING',
        personRequirements: [],
        plannedDepartureDate: new Date(Date.now() + 86400000),
        plannedArrivalDate: new Date(Date.now() + 2 * 86400000),
      };
      repository.findById.mockResolvedValue(req);
      repository.findRequestResourceAmountsByRequestId.mockResolvedValue([
        { resourceTypeId: 7, amount: '10' },
      ]);
      repository.findCampInventoryWithMinimum.mockResolvedValue({ current: '5', minimum: '0' });
      repository.findCommittedTransferAmountByCampAndResourceType.mockResolvedValue('0');

      await expect(
        service.updateRequest(
          1,
          { status: 'APPROVED', transportPersonIds: [31, 32] },
          { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
        ),
      ).rejects.toThrow('No hay inventario suficiente para aprobar el recurso 7');
    });

    it('cancels pending transfer when an approved request is rejected', async () => {
      setupValidRouting();
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'APPROVED',
        personRequirements: [],
        plannedDepartureDate: new Date(Date.now() + 86400000),
        plannedArrivalDate: new Date(Date.now() + 2 * 86400000),
      };
      repository.findById.mockResolvedValue(req);
      repository.update.mockResolvedValue({ ...req, status: 'REJECTED' });
      transferService.getTransferByRequestId.mockResolvedValue({
        id: 100,
        status: 'PENDING_DEPARTURE',
      });
      transferService.updateTransfer.mockResolvedValue({ id: 100, status: 'CANCELED' });

      await service.updateRequest(
        1,
        { status: 'REJECTED' },
        { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
      );

      expect(transferService.updateTransfer).toHaveBeenCalledWith(100, { status: 'CANCELED' });
    });

    it('throws if arrival is before departure when creating transfer', async () => {
      setupValidRouting();
      const departure = new Date(Date.now() + 2 * 86400000);
      const older = new Date(Date.now() + 86400000);
      const req = {
        id: 1,
        originCampId: 1,
        destinationCampId: 2,
        createdBy: 10,
        status: 'PENDING',
        personRequirements: [],
        plannedDepartureDate: departure,
        plannedArrivalDate: older, // Invalid dates
      };
      repository.findById.mockResolvedValue(req);
      repository.update.mockResolvedValue({ ...req, status: 'APPROVED' });
      repository.findPersonDetailRequirementsByRequestId.mockResolvedValue([
        { occupationId: 2, quantity: 2 },
      ]);
      repository.findRequestResourceAmountsByRequestId.mockResolvedValue([]);
      transferService.getTransferByRequestId.mockResolvedValue(null);
      transferPersonService.canFulfillRequirements.mockResolvedValue(true);

      await expect(
        service.updateRequest(
          1,
          { status: 'APPROVED', transportPersonIds: [31, 32] },
          { userId: 20, campId: 2, rol: 'TRAVEL_MANAGER' },
        ),
      ).rejects.toThrow(
        'plannedArrivalDate must be at least 1 minute later than plannedDepartureDate',
      );
    });
  });


  describe('deleteRequest', () => {
    it('returns false if not found', async () => {
      repository.findById.mockResolvedValue(null);
      expect(await service.deleteRequest(1)).toBe(false);
    });

    it('returns false if delete fails', async () => {
      repository.findById.mockResolvedValue({ id: 1 });
      repository.delete.mockResolvedValue(false);
      expect(await service.deleteRequest(1)).toBe(false);
    });

    it('deletes and notifies', async () => {
      repository.findById.mockResolvedValue({ id: 1, originCampId: 1, destinationCampId: 2 });
      repository.delete.mockResolvedValue(true);

      const result = await service.deleteRequest(1);

      expect(result).toBe(true);
      expect(notificationService.notifyCampRoles).toHaveBeenCalledTimes(2);
    });
  });
});
