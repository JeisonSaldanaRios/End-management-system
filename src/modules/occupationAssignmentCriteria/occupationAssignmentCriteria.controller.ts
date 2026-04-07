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
import { parsePositiveInt } from '../../common/validation/request-validation.util';


import { OccupationAssignmentCriteriaService } from './occupationAssignmentCriteria.service';
import type {
  CreateOccupationAssignmentCriteriaDTO,
  OccupationCriteriaEvaluatedField,
  UpdateOccupationAssignmentCriteriaDTO,
} from './occupationAssignmentCriteria.model';
import { OccupationAssignmentCriteriaEntity } from './occupationAssignmentCriteria.entity';

import { CreateOccupationAssignmentCriteriaDto, UpdateOccupationAssignmentCriteriaDto } from './dto';
@Controller('occupation-assignment-criteria')
@ApiTags('Occupation Assignment Criteria')
export class OccupationAssignmentCriteriaController {
  constructor(private readonly service: OccupationAssignmentCriteriaService) {}
  @Post()
  @ApiOperation({ summary: 'Create Occupation Assignment Criteria' })
  @ApiBody({ type: CreateOccupationAssignmentCriteriaDto })
  @ApiCreatedResponseData(OccupationAssignmentCriteriaEntity, { description: 'Occupation Assignment Criteria created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateOccupationAssignmentCriteriaDTO) {
    try {
      const criteria = await this.service.createCriteria(body);
      return {
        success: true,
        data: criteria,
        message: 'Criteria created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating criteria',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Occupation Assignment Criteria by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Occupation Assignment Criteria id' })
  @ApiOkResponseData(OccupationAssignmentCriteriaEntity, { description: 'Occupation Assignment Criteria found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Occupation Assignment Criteria not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const criteria = await this.service.getCriteriaById(parsedId);
    if (!criteria) throw new NotFoundException('Criteria not found');

    return { success: true, data: criteria };
  }
  @Get()
  @ApiOperation({ summary: 'List Occupation Assignment Criteria' })
  @ApiOkResponseList(OccupationAssignmentCriteriaEntity, { description: 'Occupation Assignment Criteria list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('occupationId') occupationId?: string,
    @Query('evaluatedField') evaluatedField?: OccupationCriteriaEvaluatedField,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        occupationId?: number;
        evaluatedField?: OccupationCriteriaEvaluatedField;
        active?: boolean;
        page?: number;
        limit?: number;
      } = {};

      if (occupationId) {
        const parsedOccupationId = parsePositiveInt(occupationId, 'Invalid occupationId');
        filters.occupationId = parsedOccupationId;
      }

      if (evaluatedField) {
        filters.evaluatedField = evaluatedField;
      }

      if (active !== undefined) {
        if (active !== 'true' && active !== 'false') {
          throw new BadRequestException('Invalid active');
        }
        filters.active = active === 'true';
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllCriteria(filters);
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
        error instanceof Error ? error.message : 'Error getting criteria',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Occupation Assignment Criteria' })
  @ApiParam({ name: 'id', type: Number, description: 'Occupation Assignment Criteria id' })
  @ApiBody({ type: UpdateOccupationAssignmentCriteriaDto })
  @ApiOkResponseData(OccupationAssignmentCriteriaEntity, { description: 'Occupation Assignment Criteria updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Occupation Assignment Criteria not found' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateOccupationAssignmentCriteriaDTO,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const criteria = await this.service.updateCriteria(parsedId, body);
      if (!criteria) throw new NotFoundException('Criteria not found');

      return {
        success: true,
        data: criteria,
        message: 'Criteria updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating criteria',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Occupation Assignment Criteria' })
  @ApiParam({ name: 'id', type: Number, description: 'Occupation Assignment Criteria id' })
  @ApiOkResponseMessage({ description: 'Occupation Assignment Criteria deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Occupation Assignment Criteria not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteCriteria(parsedId);
      if (!deleted) throw new NotFoundException('Criteria not found');

      return { success: true, message: 'Criteria deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting criteria',
      );
    }
  }
}
