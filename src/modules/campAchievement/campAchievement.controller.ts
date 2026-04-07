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
  Req,
} from '@nestjs/common';


import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseList,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';


import { CampAchievementService } from './campAchievement.service';
import type {
  CreateCampAchievementDTO,
  UpdateCampAchievementDTO,
} from './campAchievement.model';
import { CampAchievementEntity } from './campAchievement.entity';

import { CreateCampAchievementDto, UpdateCampAchievementDto } from './dto';
@Controller('camp-achievements')
@ApiTags('Camp Achievement')
export class CampAchievementController {
  constructor(private readonly service: CampAchievementService) {}
  @Post()
  @ApiOperation({ summary: 'Create Camp Achievement' })
  @ApiBody({ type: CreateCampAchievementDto })
  @ApiCreatedResponseData(CampAchievementEntity, { description: 'Camp Achievement created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateCampAchievementDTO) {
    try {
      const campAchievement = await this.service.createCampAchievement(body);
      return {
        success: true,
        data: campAchievement,
        message: 'Camp achievement created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating camp achievement',
      );
    }
  }

  @Get(':campId/:achievementId')
  async getByKey(@Param('campId') campId: string, @Param('achievementId') achievementId: string) {
    const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
    const parsedAchievementId = parsePositiveInt(achievementId, 'Invalid achievementId');

    const campAchievement = await this.service.getCampAchievementByKey(
      parsedCampId,
      parsedAchievementId,
    );
    if (!campAchievement) throw new NotFoundException('Camp achievement not found');

    return { success: true, data: campAchievement };
  }
  @Get()
  @ApiOperation({ summary: 'List Camp Achievement' })
  @ApiOkResponseList(CampAchievementEntity, { description: 'Camp Achievement list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('achievementId') achievementId?: string,
    @Query('unlockedBy') unlockedBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        achievementId?: number;
        unlockedBy?: number;
        page?: number;
        limit?: number;
      } = {};

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
        filters.campId = parsedCampId;
      }

      if (achievementId) {
        const parsedAchievementId = parsePositiveInt(achievementId, 'Invalid achievementId');
        filters.achievementId = parsedAchievementId;
      }

      if (unlockedBy) {
        const parsedUnlockedBy = parsePositiveInt(unlockedBy, 'Invalid unlockedBy');
        filters.unlockedBy = parsedUnlockedBy;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllCampAchievements(filters);
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
        error instanceof Error ? error.message : 'Error getting camp achievements',
      );
    }
  }

  @Put(':campId/:achievementId')
  async update(
    @Param('campId') campId: string,
    @Param('achievementId') achievementId: string,
    @Body() body: UpdateCampAchievementDTO,
  ) {
    const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
    const parsedAchievementId = parsePositiveInt(achievementId, 'Invalid achievementId');

    try {
      const campAchievement = await this.service.updateCampAchievement(
        parsedCampId,
        parsedAchievementId,
        body,
      );
      if (!campAchievement) throw new NotFoundException('Camp achievement not found');

      return {
        success: true,
        data: campAchievement,
        message: 'Camp achievement updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating camp achievement',
      );
    }
  }

  @Delete(':campId/:achievementId')
  async delete(@Param('campId') campId: string, @Param('achievementId') achievementId: string) {
    const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
    const parsedAchievementId = parsePositiveInt(achievementId, 'Invalid achievementId');

    try {
      const deleted = await this.service.deleteCampAchievement(parsedCampId, parsedAchievementId);
      if (!deleted) throw new NotFoundException('Camp achievement not found');

      return { success: true, message: 'Camp achievement deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting camp achievement',
      );
    }
  }
}
