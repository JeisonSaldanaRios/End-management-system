import { SystemTimeService } from '../../modules/systemTime/systemTime.service';

describe('SystemTimeService - Offset Management (unit tests)', () => {
  let service: SystemTimeService;
  const realNow = Date.now();

  beforeEach(() => {
    service = new SystemTimeService();
  });

  describe('getOffset()', () => {
    it('returns 0 for new service instance', () => {
      expect(service.getOffset()).toBe(0);
    });

    it('returns number type', () => {
      expect(typeof service.getOffset()).toBe('number');
    });

    it('throws on reset', () => {
      service.addOffset(5000);
      expect(() => service.resetOffset()).toThrow('Resetting the time offset is not allowed.');
    });
  });

  describe('addOffset()', () => {
    it('returns object with offset and newTime properties', () => {
      const result = service.addOffset(1000);
      expect(result).toHaveProperty('offset');
      expect(result).toHaveProperty('newTime');
    });

    it('adds milliseconds to offset', () => {
      service.addOffset(3600000);
      expect(service.getOffset()).toBe(3600000);
    });

    it('cumulates offsets on multiple calls', () => {
      service.addOffset(1000);
      service.addOffset(2000);
      service.addOffset(3000);
      expect(service.getOffset()).toBe(6000);
    });

    it('returns correct offset in response', () => {
      const result = service.addOffset(5000);
      expect(result.offset).toBe(5000);
    });

    it('handles large offsets (24 hours)', () => {
      const oneDayMs = 24 * 60 * 60 * 1000;
      service.addOffset(oneDayMs);
      expect(service.getOffset()).toBe(oneDayMs);
    });

    it('handles fractional milliseconds', () => {
      service.addOffset(1234.56);
      expect(service.getOffset()).toBe(1234.56);
    });

    it('returns ISO string in newTime', () => {
      const result = service.addOffset(1000);
      expect(result.newTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('newTime is valid parseable date', () => {
      const result = service.addOffset(1000);
      const date = new Date(result.newTime);
      expect(isNaN(date.getTime())).toBe(false);
    });
  });

  describe('resetOffset()', () => {
    it('throws error', () => {
      expect(() => service.resetOffset()).toThrow('Resetting the time offset is not allowed.');
    });
  });

  describe('Offset impact on now()', () => {
    it('now() increases by offset amount', () => {
      const before = service.now().getTime();
      const offsetMs = 5000;
      service.addOffset(offsetMs);
      const after = service.now().getTime();

      const diff = after - before;

      expect(diff).toBeGreaterThanOrEqual(offsetMs - 1);
      expect(diff).toBeLessThanOrEqual(offsetMs + 200);
    });

    it('cumulative offsets affect now() correctly', () => {
      const offset1 = 3600000;
      const offset2 = 1800000;
      const totalOffset = offset1 + offset2;

      const before = service.now().getTime();
      service.addOffset(offset1);
      service.addOffset(offset2);
      const after = service.now().getTime();

      const diff = after - before;
      expect(diff).toBeGreaterThanOrEqual(totalOffset - 1);
      expect(diff).toBeLessThanOrEqual(totalOffset + 200);
    });

    it('throws error when adding a negative offset', () => {
      expect(() => service.addOffset(-1000)).toThrow('Cannot reduce the time offset.');
    });
  });

  describe('Offset impact on nowIso()', () => {
    it('ISO string reflects offset', () => {
      const before = new Date(service.nowIso()).getTime();
      service.addOffset(5000);
      const after = new Date(service.nowIso()).getTime();

      const diff = after - before;
      expect(diff).toBeGreaterThanOrEqual(4999);
      expect(diff).toBeLessThanOrEqual(5200);
    });

    it('ISO string is still valid after offset', () => {
      service.addOffset(1000);
      const result = service.nowIso();
      const date = new Date(result);
      expect(isNaN(date.getTime())).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('handles zero offset', () => {
      service.addOffset(0);
      expect(service.getOffset()).toBe(0);
      const result = service.now();
      expect(result).toBeInstanceOf(Date);
    });

    it('handles multiple rapid offset changes', () => {
      for (let i = 0; i < 100; i++) {
        service.addOffset(10);
      }
      expect(service.getOffset()).toBe(1000);
    });

    it('offset does not affect concurrent service instances', () => {
      const service1 = new SystemTimeService();
      const service2 = new SystemTimeService();

      service1.addOffset(5000);

      expect(service1.getOffset()).toBe(5000);
      expect(service2.getOffset()).toBe(0);
    });

    it('handles very large offsets (30 days)', () => {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      service.addOffset(thirtyDaysMs);
      expect(service.getOffset()).toBe(thirtyDaysMs);
    });
  });

  describe('Time progression with offset', () => {
    it('time still progresses forward with offset applied', (done) => {
      service.addOffset(3600000);
      const first = service.now().getTime();

      setTimeout(() => {
        const second = service.now().getTime();
        expect(second).toBeGreaterThan(first);
        done();
      }, 10);
    });

    it('adding more offset increases time further', () => {
      service.addOffset(1000);
      const time1 = service.now().getTime();

      service.addOffset(2000);
      const time2 = service.now().getTime();

      expect(time2).toBeGreaterThan(time1);
    });
  });

  describe('Interaction with getServerTime()', () => {
    it('getServerTime reflects offset', () => {
      const before = new Date(service.getServerTime().serverTime).getTime();
      service.addOffset(5000);
      const after = new Date(service.getServerTime().serverTime).getTime();

      const diff = after - before;
      expect(diff).toBeGreaterThanOrEqual(4999);
      expect(diff).toBeLessThanOrEqual(5200);
    });

    it('getServerTime returns valid time after offset operations', () => {
      service.addOffset(3600000);
      service.addOffset(1800000);

      const result = service.getServerTime();
      expect(result).toHaveProperty('serverTime');
      expect(result.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('Offset persistence across operations', () => {
    it('offset persists across multiple now() calls', () => {
      service.addOffset(5000);
      const offset1 = service.getOffset();
      service.now();
      service.nowIso();
      service.getServerTime();
      const offset2 = service.getOffset();

      expect(offset1).toBe(offset2);
      expect(offset2).toBe(5000);
    });

    it('offset only changes when explicitly modified', () => {
      service.addOffset(3000);
      const offset1 = service.getOffset();

      for (let i = 0; i < 100; i++) {
        service.now();
      }

      const offset2 = service.getOffset();
      expect(offset1).toBe(offset2);
    });
  });
});
