import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import {
  assertNonEmptyPayload,
  COMMON_MAX_LENGTH,
  parsePositiveInt,
  validateStringFieldsMaxLength,
} from '../../common/validation/request-validation.util';


import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';


import { AchievementService } from './achievement.service';
import type { CreateAchievementDTO, UpdateAchievementDTO } from './achievement.model';
import { AchievementEntity } from './achievement.entity';

import { CreateAchievementDto, UpdateAchievementDto } from './dto';
@Controller('achievements')
@ApiTags('Achievement')
export class AchievementController {
  constructor(private readonly service: AchievementService) {}
  @Post()
  @ApiOperation({ summary: 'Create Achievement' })
  @ApiBody({ type: CreateAchievementDto })
  @ApiCreatedResponseData(AchievementEntity, { description: 'Achievement created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateAchievementDTO) {
    validateStringFieldsMaxLength([
      { fieldName: 'name', value: body.name, maxLength: COMMON_MAX_LENGTH.name, required: true },
      { fieldName: 'description', value: body.description, maxLength: COMMON_MAX_LENGTH.longText, allowNull: true },
      { fieldName: 'unlockCondition', value: body.unlockCondition, maxLength: COMMON_MAX_LENGTH.longText, required: true },
      { fieldName: 'iconUrl', value: body.iconUrl, maxLength: COMMON_MAX_LENGTH.url, allowNull: true },
    ]);

    try {
      const achievement = await this.service.createAchievement(body);
      return {
        success: true,
        data: achievement,
        message: 'Achievement created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating achievement',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Achievement by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Achievement id' })
  @ApiOkResponseData(AchievementEntity, { description: 'Achievement found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Achievement not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const achievement = await this.service.getAchievementById(parsedId);
    if (!achievement) throw new NotFoundException('Achievement not found');
    return { success: true, data: achievement };
  }
  @Get()
  @ApiOperation({ summary: 'List Achievement' })
  @ApiOkResponseList(AchievementEntity, { description: 'Achievement list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('name') name?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: { name?: string; page?: number; limit?: number } = {};

      if (name) {
        validateStringFieldsMaxLength([
          { fieldName: 'name', value: name, maxLength: COMMON_MAX_LENGTH.name },
        ]);
        filters.name = name;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllAchievements(filters);
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
        error instanceof Error ? error.message : 'Error getting achievements',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Achievement' })
  @ApiParam({ name: 'id', type: Number, description: 'Achievement id' })
  @ApiBody({ type: UpdateAchievementDto })
  @ApiOkResponseData(AchievementEntity, { description: 'Achievement updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Achievement not found' })
  async update(@Param('id') id: string, @Body() body: UpdateAchievementDTO) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = parsePositiveInt(id, 'Invalid ID');

    assertNonEmptyPayload(body);

    validateStringFieldsMaxLength([
      { fieldName: 'name', value: body.name, maxLength: COMMON_MAX_LENGTH.name },
      { fieldName: 'description', value: body.description, maxLength: COMMON_MAX_LENGTH.longText, allowNull: true },
      { fieldName: 'unlockCondition', value: body.unlockCondition, maxLength: COMMON_MAX_LENGTH.longText },
      { fieldName: 'iconUrl', value: body.iconUrl, maxLength: COMMON_MAX_LENGTH.url, allowNull: true },
    ]);

    try {
      const achievement = await this.service.updateAchievement(parsedId, body);
      if (!achievement) throw new NotFoundException('Achievement not found');
      return {
        success: true,
        data: achievement,
        message: 'Achievement updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating achievement',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Achievement' })
  @ApiParam({ name: 'id', type: Number, description: 'Achievement id' })
  @ApiOkResponseMessage({ description: 'Achievement deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Achievement not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteAchievement(parsedId);
      if (!deleted) throw new NotFoundException('Achievement not found');
      return { success: true, message: 'Achievement deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting achievement',
      );
    }
  }
}
