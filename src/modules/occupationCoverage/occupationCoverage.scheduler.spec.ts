import { OccupationCoverageScheduler } from './occupationCoverage.scheduler';
import { SystemTimeService } from '../systemTime/systemTime.service';

describe('OccupationCoverageScheduler', () => {
  let scheduler: OccupationCoverageScheduler;
  let coverageService: any;
  let dataSource: any;
  let notificationService: any;
  let systemTimeService: any;

  beforeEach(() => {
    coverageService = {
      getCriticalOccupations: jest.fn(),
      getSuggestedReplacements: jest.fn(),
    };
    dataSource = {
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn().mockImplementation((d) => d),
        findOne: jest.fn().mockResolvedValue({ name: 'John', lastName1: 'Doe' }),
      }),
    };
    notificationService = {
      notifyCampRoles: jest.fn(),
    };
    systemTimeService = {
      now: jest.fn().mockReturnValue(new Date()),
    } as jest.Mocked<SystemTimeService>;
    scheduler = new OccupationCoverageScheduler(
      coverageService,
      dataSource,
      notificationService,
      systemTimeService,
    );
  });

  describe('checkCriticalOccupations', () => {
    it('should process active camps and notify if critical', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 1 }]); // camps
      coverageService.getCriticalOccupations.mockResolvedValueOnce([
        { occupationId: 10, occupationName: 'Medic', isCritical: true },
      ]);
      coverageService.getSuggestedReplacements.mockResolvedValueOnce([
        { personId: 5, personName: 'Jane Smith' },
      ]);
      dataSource.query.mockResolvedValueOnce([{ id: 100 }]); // systemAdmin

      await scheduler.checkCriticalOccupations();

      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        1,
        ['SYSTEM_ADMIN'],
        expect.objectContaining({
          type: 'TEMPORARY_OCCUPATION_ASSIGNED',
        }),
      );
    });

    it('should notify if no suggestions available', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 1 }]); // camps
      coverageService.getCriticalOccupations.mockResolvedValueOnce([
        { occupationId: 10, occupationName: 'Medic', isCritical: true },
      ]);
      coverageService.getSuggestedReplacements.mockResolvedValueOnce([]);

      await scheduler.checkCriticalOccupations();

      expect(notificationService.notifyCampRoles).toHaveBeenCalledWith(
        1,
        ['SYSTEM_ADMIN'],
        expect.objectContaining({
          type: 'OCCUPATION_WITHOUT_STAFF',
        }),
      );
    });

    it('should skip if not critical', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 1 }]);
      coverageService.getCriticalOccupations.mockResolvedValueOnce([
        { occupationId: 10, isCritical: false },
      ]);

      await scheduler.checkCriticalOccupations();
      expect(notificationService.notifyCampRoles).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      dataSource.query.mockRejectedValue(new Error('DB Error'));
      await expect(scheduler.checkCriticalOccupations()).resolves.not.toThrow();
    });
  });
});
