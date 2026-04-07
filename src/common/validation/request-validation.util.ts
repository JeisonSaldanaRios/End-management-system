import { BadRequestException } from '@nestjs/common';

type StringFieldLengthRule = {
  fieldName: string;
  value: unknown;
  maxLength: number;
  required?: boolean;
  allowNull?: boolean;
};

export const COMMON_MAX_LENGTH = {
  name: 15,
  lastName: 15,
  email: 50,
  username: 20,
  shortText: 80,
  mediumText: 120,
  longText: 200,
  reason: 100,
  token: 255,
  url: 2048,
  ip: 45,
  coordinate: 30,
  numericText: 20,
} as const;

export function parsePositiveInt(value: string, errorMessage: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new BadRequestException(errorMessage);
  }
  return parsed;
}

export function assertNonEmptyPayload(payload: unknown, errorMessage = 'Payload cannot be empty'): void {
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    throw new BadRequestException(errorMessage);
  }
}

export function assertEnumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  errorMessage: string,
): asserts value is T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new BadRequestException(errorMessage);
  }
}

export function assertBooleanValue(value: unknown, errorMessage: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestException(errorMessage);
  }
}

export function parseBooleanQuery(
  value: string,
  errorMessage = 'Invalid boolean value (use true/false)',
): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException(errorMessage);
}

export function validateStringFieldsMaxLength(rules: StringFieldLengthRule[]): void {
  for (const rule of rules) {
    const {
      fieldName,
      value,
      maxLength,
      required = false,
      allowNull = false,
    } = rule;

    if (value === undefined) {
      if (required) {
        throw new BadRequestException(`${fieldName} is required`);
      }
      continue;
    }

    if (value === null) {
      if (allowNull) {
        continue;
      }
      if (required) {
        throw new BadRequestException(`${fieldName} is required`);
      }
      throw new BadRequestException(`${fieldName} must be a string`);
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`${fieldName} must be a string`);
    }

    if (value.length > maxLength) {
      throw new BadRequestException(`${fieldName} exceeds maximum length of ${maxLength} characters`);
    }
  }
}