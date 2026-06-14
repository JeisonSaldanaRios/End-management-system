import { AchievementEvaluatorService } from './achievementEvaluator.service';
import { SystemTimeService } from '../systemTime/systemTime.service';

describe('AchievementEvaluatorService', () => {
  let service: AchievementEvaluatorService;

  // Mock repos
  const achievementRepo = {
    findAllAndCount: jest.fn(),
  };
  const campRepo = {
    findAllAndCount: jest.fn(),
  };
  const campAchievementService = {
    getCampAchievementByKey: jest.fn(),
    createCampAchievement: jest.fn(),
  };

  const personRepo = {
    count: jest.fn(),
  };

  const getRawManyMock = jest.fn();
  const getManyMock = jest.fn();
  const getCountMock = jest.fn();

  const queryBuilderMock: any = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: getRawManyMock,
    getMany: getManyMock,
    getCount: getCountMock,
  };

  const expeditionRepo = {
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
  };
  const intercampRepo = {
    count: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
  };
  const inventoryAlertRepo = {
    count: jest.fn(),
    findOne: jest.fn(),
  };
  const inventoryMovementRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
  };
  const notificationRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
  };

  const dataSource = {
    query: jest.fn(),
  };

  const systemTimeService: jest.Mocked<SystemTimeService> = {
    now: jest.fn().mockImplementation(() => new Date()),
    nowIso: jest.fn().mockImplementation(() => new Date().toISOString()),
    getOffset: jest.fn().mockReturnValue(0),
    setOffset: jest.fn(),
    advanceTime: jest.fn(),
    resetTime: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AchievementEvaluatorService(
      achievementRepo as any,
      campRepo as any,
      campAchievementService as any,
      dataSource as any,
      personRepo as any,
      expeditionRepo as any,
      intercampRepo as any,
      inventoryAlertRepo as any,
      inventoryMovementRepo as any,
      notificationRepo as any,
      systemTimeService,
    );
  });

  describe('processAchievements', () => {
    it('runs evaluation for active achievements and all camps', async () => {
      achievementRepo.findAllAndCount.mockResolvedValue({
        data: [
          { id: 1, name: 'Hero', isActive: true, metricKey: 'population.active', operator: '>=', targetValue: 10 },
          { id: 2, name: 'Unused', isActive: false },
        ],
        total: 2,
      });

      campRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 101 }, { id: 102 }],
        total: 2,
      });

      campAchievementService.getCampAchievementByKey.mockResolvedValue(null);
      personRepo.count.mockResolvedValue(15); // metric population.active = 15

      await service.processAchievements();

      expect(campAchievementService.createCampAchievement).toHaveBeenCalledTimes(2);
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ campId: 101, achievementId: 1 }),
      );
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ campId: 102, achievementId: 1 }),
      );
    });

    it('logs error if achievement list retrieval fails', async () => {
      achievementRepo.findAllAndCount.mockRejectedValue(new Error('DB error'));
      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await service.processAchievements();

      expect(loggerSpy).toHaveBeenCalledWith('Failed to process achievements: DB error');
    });

    it('logs error if achievement list retrieval fails with non-Error object', async () => {
      achievementRepo.findAllAndCount.mockRejectedValue('string-db-error');
      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await service.processAchievements();

      expect(loggerSpy).toHaveBeenCalledWith('Failed to process achievements: string-db-error');
    });

    it('continues evaluating other achievements if one throws an error', async () => {
      achievementRepo.findAllAndCount.mockResolvedValue({
        data: [
          { id: 1, name: 'First', isActive: true, metricKey: 'population.active', operator: '>=', targetValue: 10 },
          { id: 2, name: 'Second', isActive: true, metricKey: 'population.active', operator: '>=', targetValue: 5 },
        ],
        total: 2,
      });

      campRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 101 }],
        total: 1,
      });

      // Let the first one throw during duplicate check or metric evaluation
      campAchievementService.getCampAchievementByKey
        .mockRejectedValueOnce(new Error('Evaluation failed'))
        .mockResolvedValueOnce(null);

      personRepo.count.mockResolvedValue(8); // metric = 8

      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await service.processAchievements();

      // Second should still succeed because evaluated count (8) >= targetValue (5)
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledTimes(1);
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ campId: 101, achievementId: 2 }),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        'Error evaluating achievement First for camp 101: Evaluation failed',
      );
    });

    it('continues evaluating other achievements if one throws a non-Error string', async () => {
      achievementRepo.findAllAndCount.mockResolvedValue({
        data: [
          { id: 1, name: 'First', isActive: true, metricKey: 'population.active', operator: '>=', targetValue: 10 },
          { id: 2, name: 'Second', isActive: true, metricKey: 'population.active', operator: '>=', targetValue: 5 },
        ],
        total: 2,
      });

      campRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 101 }],
        total: 1,
      });

      campAchievementService.getCampAchievementByKey
        .mockRejectedValueOnce('string-evaluation-failed')
        .mockResolvedValueOnce(null);

      personRepo.count.mockResolvedValue(8);

      const loggerSpy = jest.spyOn((service as any).logger, 'error');

      await service.processAchievements();

      expect(campAchievementService.createCampAchievement).toHaveBeenCalledTimes(1);
      expect(loggerSpy).toHaveBeenCalledWith(
        'Error evaluating achievement First for camp 101: string-evaluation-failed',
      );
    });

    it('does not evaluate achievement if it is already unlocked for the camp', async () => {
      achievementRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 1, name: 'Already Unlocked', isActive: true, metricKey: 'population.active', operator: '>=', targetValue: 10 }],
        total: 1,
      });

      campRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 101 }],
        total: 1,
      });

      campAchievementService.getCampAchievementByKey.mockResolvedValue({ id: 999, campId: 101, achievementId: 1 });

      await service.processAchievements();

      expect(personRepo.count).not.toHaveBeenCalled();
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });
  });

  describe('evaluateAchievement and comparisons', () => {
    const runComparisonTest = async (operator: string, metricVal: number, targetVal: number, expectedUnlocked: boolean) => {
      jest.clearAllMocks();
      achievementRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 1, name: 'Test', isActive: true, metricKey: 'population.active', operator, targetValue: targetVal }],
        total: 1,
      });
      campRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 101 }],
        total: 1,
      });
      campAchievementService.getCampAchievementByKey.mockResolvedValue(null);
      personRepo.count.mockResolvedValue(metricVal);

      await service.processAchievements();

      if (expectedUnlocked) {
        expect(campAchievementService.createCampAchievement).toHaveBeenCalled();
      } else {
        expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
      }
    };

    it('handles operator >= correctly', async () => {
      await runComparisonTest('>=', 10, 10, true);
      await runComparisonTest('>=', 11, 10, true);
      await runComparisonTest('>=', 9, 10, false);
    });

    it('handles operator > correctly', async () => {
      await runComparisonTest('>', 10, 10, false);
      await runComparisonTest('>', 11, 10, true);
    });

    it('handles operator <= correctly', async () => {
      await runComparisonTest('<=', 10, 10, true);
      await runComparisonTest('<=', 9, 10, true);
      await runComparisonTest('<=', 11, 10, false);
    });

    it('handles operator < correctly', async () => {
      await runComparisonTest('<', 10, 10, false);
      await runComparisonTest('<', 9, 10, true);
    });

    it('handles operator == correctly', async () => {
      await runComparisonTest('==', 10, 10, true);
      await runComparisonTest('==', 9, 10, false);
    });

    it('handles unknown operator correctly by not unlocking', async () => {
      await runComparisonTest('??', 10, 10, false);
    });
  });

  describe('calculateMetric cases', () => {
    const runMetricTest = async (metricKey: string, windowDays: number | undefined, mockSetup: () => void, targetVal = 1) => {
      achievementRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 1, name: 'Test', isActive: true, metricKey, operator: '>=', targetValue: targetVal, windowDays }],
        total: 1,
      });
      campRepo.findAllAndCount.mockResolvedValue({
        data: [{ id: 101 }],
        total: 1,
      });
      campAchievementService.getCampAchievementByKey.mockResolvedValue(null);
      mockSetup();

      await service.processAchievements();
    };

    it('evaluates population.zero_injured_days when clean', async () => {
      dataSource.query.mockResolvedValue([{ count: '0' }]);
      await runMetricTest('population.zero_injured_days', 5, () => {});
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('person_status_history'),
        [101, expect.any(Date)],
      );
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 5 }),
      );
    });

    it('evaluates population.zero_injured_days when dirty', async () => {
      dataSource.query.mockResolvedValue([{ count: '2' }]);
      await runMetricTest('population.zero_injured_days', 5, () => {}, 10);
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });

    it('evaluates expeditions.completed', async () => {
      expeditionRepo.count.mockResolvedValue(4);
      await runMetricTest('expeditions.completed', undefined, () => {});
      expect(expeditionRepo.count).toHaveBeenCalledWith({
        where: { campId: 101, status: 'COMPLETED' },
      });
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 4 }),
      );
    });

    it('evaluates expeditions.success_rate', async () => {
      getRawManyMock.mockResolvedValue([
        { status: 'COMPLETED', count: '4' },
        { status: 'LOST', count: '1' },
      ]);
      await runMetricTest('expeditions.success_rate', 30, () => {}, 0.5);
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 0.8 }),
      );
    });

    it('evaluates expeditions.success_rate with zero total', async () => {
      getRawManyMock.mockResolvedValue([]);
      await runMetricTest('expeditions.success_rate', 30, () => {}, 0.5);
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });

    it('evaluates intercamp.requests_approved', async () => {
      intercampRepo.count.mockResolvedValue(3);
      await runMetricTest('intercamp.requests_approved', undefined, () => {});
      expect(intercampRepo.count).toHaveBeenCalledWith({
        where: { originCampId: 101, status: 'APPROVED' },
      });
    });

    it('evaluates intercamp.response_time_fast_rate with data', async () => {
      const createdDate = new Date();
      const fastResponseDate = new Date(createdDate.getTime() + 10 * 60 * 60 * 1000); // 10h
      const slowResponseDate = new Date(createdDate.getTime() + 30 * 60 * 60 * 1000); // 30h

      getManyMock.mockResolvedValue([
        { createdDate, responseDate: fastResponseDate },
        { createdDate, responseDate: slowResponseDate },
        { createdDate, responseDate: null }, // missing response date should be ignored
      ]);

      await runMetricTest('intercamp.response_time_fast_rate', 30, () => {}, 0.3);
      // fastResponses / totalResponses = 1 / 3 = 0.333
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 1 / 3 }),
      );
    });

    it('evaluates intercamp.response_time_fast_rate with empty responses', async () => {
      getManyMock.mockResolvedValue([]);
      await runMetricTest('intercamp.response_time_fast_rate', 30, () => {}, 0.5);
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });

    it('evaluates inventory.no_critical_alerts_days when clean', async () => {
      inventoryAlertRepo.count.mockResolvedValue(0);
      await runMetricTest('inventory.no_critical_alerts_days', 7, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 7 }),
      );
    });

    it('evaluates inventory.no_critical_alerts_days when dirty', async () => {
      inventoryAlertRepo.count.mockResolvedValue(1);
      await runMetricTest('inventory.no_critical_alerts_days', 7, () => {}, 10);
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });

    it('evaluates inventory.inbound_movements_count', async () => {
      getCountMock.mockResolvedValue(15);
      await runMetricTest('inventory.inbound_movements_count', 14, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 15 }),
      );
    });

    it('evaluates stability.no_critical_notifications_days when clean', async () => {
      getCountMock.mockResolvedValue(0);
      await runMetricTest('stability.no_critical_notifications_days', 14, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 14 }),
      );
    });

    it('evaluates stability.no_critical_notifications_days when dirty (returns 0)', async () => {
      getCountMock.mockResolvedValue(3);
      await runMetricTest('stability.no_critical_notifications_days', 14, () => {}, 10);
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });

    it('evaluates stability.continuous_operational_days with last critical alert', async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      inventoryAlertRepo.findOne.mockResolvedValue({ alertDate: tenDaysAgo });

      await runMetricTest('stability.continuous_operational_days', undefined, () => {}, 5);
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 10 }),
      );
    });

    it('evaluates stability.continuous_operational_days with no critical alert ever', async () => {
      inventoryAlertRepo.findOne.mockResolvedValue(null);
      await runMetricTest('stability.continuous_operational_days', undefined, () => {}, 50);
      expect(campAchievementService.createCampAchievement).toHaveBeenCalled();
    });

    it('evaluates population.zero_injured_days with default windowDays (7)', async () => {
      dataSource.query.mockResolvedValue([{ count: '0' }]);
      await runMetricTest('population.zero_injured_days', undefined, () => {});
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('person_status_history'),
        [101, expect.any(Date)],
      );
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 7 }),
      );
    });

    it('evaluates expeditions.success_rate with default windowDays (30)', async () => {
      getRawManyMock.mockResolvedValue([{ status: 'COMPLETED', count: '5' }]);
      await runMetricTest('expeditions.success_rate', undefined, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 1 }),
      );
    });

    it('evaluates intercamp.response_time_fast_rate with default windowDays (30)', async () => {
      const createdDate = new Date();
      getManyMock.mockResolvedValue([{ createdDate, responseDate: createdDate }]);
      await runMetricTest('intercamp.response_time_fast_rate', undefined, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 1 }),
      );
    });

    it('evaluates inventory.no_critical_alerts_days with default windowDays (7)', async () => {
      inventoryAlertRepo.count.mockResolvedValue(0);
      await runMetricTest('inventory.no_critical_alerts_days', undefined, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 7 }),
      );
    });

    it('evaluates inventory.inbound_movements_count with default windowDays (14)', async () => {
      getCountMock.mockResolvedValue(10);
      await runMetricTest('inventory.inbound_movements_count', undefined, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 10 }),
      );
    });

    it('evaluates stability.no_critical_notifications_days with default windowDays (14)', async () => {
      getCountMock.mockResolvedValue(0);
      await runMetricTest('stability.no_critical_notifications_days', undefined, () => {});
      expect(campAchievementService.createCampAchievement).toHaveBeenCalledWith(
        expect.objectContaining({ progressSnapshot: 14 }),
      );
    });

    it('returns 0 for unknown metric key', async () => {
      await runMetricTest('unknown.metric', undefined, () => {}, 1);
      expect(campAchievementService.createCampAchievement).not.toHaveBeenCalled();
    });
  });
});
