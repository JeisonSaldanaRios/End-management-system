import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import {
  assertEnumValue,
  assertNonEmptyPayload,
  COMMON_MAX_LENGTH,
  parseBooleanQuery,
  parsePositiveInt,
  validateStringFieldsMaxLength,
} from '../../common/validation/request-validation.util';

import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';

import { NotificationService } from './notification.service';
import type {
  CreateNotificationDTO,
  NotificationType,
  UpdateNotificationDTO,
} from './notification.model';
import { NOTIFICATION_TYPE_VALUES } from './notification.model';
import type { SystemRole } from '../systemUser/systemUser.model';
import { SYSTEM_ROLE_VALUES } from '../systemUser/systemUser.model';
import { NotificationEntity } from './notification.entity';
import { CreateNotificationDto, UpdateNotificationDto } from './dto';

@Controller('notifications')
@ApiTags('Notification')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Post()
  @ApiOperation({ summary: 'Create Notification' })
  @ApiBody({ type: CreateNotificationDto })
  @ApiCreatedResponseData(NotificationEntity, { description: 'Notification created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateNotificationDTO) {
    validateStringFieldsMaxLength([
      { fieldName: 'title', value: body.title, maxLength: COMMON_MAX_LENGTH.shortText, required: true },
      { fieldName: 'message', value: body.message, maxLength: COMMON_MAX_LENGTH.longText, required: true },
      { fieldName: 'sourceType', value: body.sourceType, maxLength: COMMON_MAX_LENGTH.shortText, allowNull: true },
    ]);

    assertEnumValue(body.type, NOTIFICATION_TYPE_VALUES, 'Invalid type');

    if (body.targetRole) {
      assertEnumValue(body.targetRole, SYSTEM_ROLE_VALUES, 'Invalid targetRole');
    }

    try {
      const notification = await this.service.createNotification(body);
      return {
        success: true,
        data: notification,
        message: 'Notification created successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating notification',
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get Notification by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Notification id' })
  @ApiOkResponseData(NotificationEntity, { description: 'Notification found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const notification = await this.service.getNotificationById(parsedId);
    if (!notification) throw new NotFoundException('Notification not found');

    return { success: true, data: notification };
  }

  @Get()
  @ApiOperation({ summary: 'List Notification' })
  @ApiOkResponseList(NotificationEntity, { description: 'Notification list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('userId') userId?: string,
    @Query('targetRole') targetRole?: SystemRole,
    @Query('type') type?: NotificationType,
    @Query('read') read?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        userId?: number;
        targetRole?: SystemRole;
        type?: NotificationType;
        read?: boolean;
        page?: number;
        limit?: number;
      } = {};

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
        filters.campId = parsedCampId;
      }

      if (userId) {
        const parsedUserId = parsePositiveInt(userId, 'Invalid userId');
        filters.userId = parsedUserId;
      }

      if (targetRole) {
        assertEnumValue(targetRole, SYSTEM_ROLE_VALUES, 'Invalid targetRole');
        filters.targetRole = targetRole;
      }

      if (type) {
        assertEnumValue(type, NOTIFICATION_TYPE_VALUES, 'Invalid type');
        filters.type = type;
      }

      if (read !== undefined) {
        filters.read = parseBooleanQuery(read, 'Invalid read value (use true/false)');
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllNotifications(filters);
      const resolvedPage = filters.page ?? 1;
      const resolvedLimit = filters.limit ?? 10;

      return {
        success: true,
        data: result.data,
        pagination: {
          page: resolvedPage,
          limit: resolvedLimit,
          total: result.total,
          pages: Math.ceil(result.total / resolvedLimit),
        },
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error getting notifications',
      );
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update Notification' })
  @ApiParam({ name: 'id', type: Number, description: 'Notification id' })
  @ApiBody({ type: UpdateNotificationDto })
  @ApiOkResponseData(NotificationEntity, { description: 'Notification updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  async update(@Param('id') id: string, @Body() body: UpdateNotificationDTO) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = parsePositiveInt(id, 'Invalid ID');

    assertNonEmptyPayload(body);

    validateStringFieldsMaxLength([
      { fieldName: 'title', value: body.title, maxLength: COMMON_MAX_LENGTH.shortText },
      { fieldName: 'message', value: body.message, maxLength: COMMON_MAX_LENGTH.longText },
      { fieldName: 'sourceType', value: body.sourceType, maxLength: COMMON_MAX_LENGTH.shortText, allowNull: true },
    ]);

    if (body.type) {
      assertEnumValue(body.type, NOTIFICATION_TYPE_VALUES, 'Invalid type');
    }

    if (body.targetRole) {
      assertEnumValue(body.targetRole, SYSTEM_ROLE_VALUES, 'Invalid targetRole');
    }

    try {
      const notification = await this.service.updateNotification(parsedId, body);
      if (!notification) throw new NotFoundException('Notification not found');

      return {
        success: true,
        data: notification,
        message: 'Notification updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating notification',
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete Notification' })
  @ApiParam({ name: 'id', type: Number, description: 'Notification id' })
  @ApiOkResponseMessage({ description: 'Notification deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteNotification(parsedId);
      if (!deleted) throw new NotFoundException('Notification not found');

      return { success: true, message: 'Notification deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting notification',
      );
    }
  }
}
