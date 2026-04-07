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
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';


import { EvaluatedCriteriaReportService } from './evaluatedCriteriaReport.service';
import type {
  CreateEvaluatedCriteriaReportDTO,
  UpdateEvaluatedCriteriaReportDTO,
} from './evaluatedCriteriaReport.model';
import { EvaluatedCriteriaReportEntity } from './evaluatedCriteriaReport.entity';

import { CreateEvaluatedCriteriaReportDto, UpdateEvaluatedCriteriaReportDto } from './dto';
@Controller('evaluated-criteria-reports')
@ApiTags('Evaluated Criteria Report')
export class EvaluatedCriteriaReportController {
  constructor(private readonly service: EvaluatedCriteriaReportService) {}
  @Post()
  @ApiOperation({ summary: 'Create Evaluated Criteria Report' })
  @ApiBody({ type: CreateEvaluatedCriteriaReportDto })
  @ApiCreatedResponseData(EvaluatedCriteriaReportEntity, { description: 'Evaluated Criteria Report created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateEvaluatedCriteriaReportDTO) {
    try {
      const item = await this.service.createItem(body);
      return {
        success: true,
        data: item,
        message: 'Evaluated criteria report created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating evaluated criteria report',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Evaluated Criteria Report by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Evaluated Criteria Report id' })
  @ApiOkResponseData(EvaluatedCriteriaReportEntity, { description: 'Evaluated Criteria Report found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Evaluated Criteria Report not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const item = await this.service.getItemById(parsedId);
    if (!item) throw new NotFoundException('Evaluated criteria report not found');

    return { success: true, data: item };
  }
  @Get()
  @ApiOperation({ summary: 'List Evaluated Criteria Report' })
  @ApiOkResponseList(EvaluatedCriteriaReportEntity, { description: 'Evaluated Criteria Report list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('reportId') reportId?: string,
    @Query('criteriaId') criteriaId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        reportId?: number;
        criteriaId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (reportId) {
        const parsedReportId = parsePositiveInt(reportId, 'Invalid reportId');
        filters.reportId = parsedReportId;
      }

      if (criteriaId) {
        const parsedCriteriaId = parsePositiveInt(criteriaId, 'Invalid criteriaId');
        filters.criteriaId = parsedCriteriaId;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllItems(filters);
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
        error instanceof Error ? error.message : 'Error getting evaluated criteria reports',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Evaluated Criteria Report' })
  @ApiParam({ name: 'id', type: Number, description: 'Evaluated Criteria Report id' })
  @ApiBody({ type: UpdateEvaluatedCriteriaReportDto })
  @ApiOkResponseData(EvaluatedCriteriaReportEntity, { description: 'Evaluated Criteria Report updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Evaluated Criteria Report not found' })
  async update(@Param('id') id: string, @Body() body: UpdateEvaluatedCriteriaReportDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const item = await this.service.updateItem(parsedId, body);
      if (!item) throw new NotFoundException('Evaluated criteria report not found');

      return {
        success: true,
        data: item,
        message: 'Evaluated criteria report updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating evaluated criteria report',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Evaluated Criteria Report' })
  @ApiParam({ name: 'id', type: Number, description: 'Evaluated Criteria Report id' })
  @ApiOkResponseMessage({ description: 'Evaluated Criteria Report deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Evaluated Criteria Report not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteItem(parsedId);
      if (!deleted) throw new NotFoundException('Evaluated criteria report not found');

      return { success: true, message: 'Evaluated criteria report deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting evaluated criteria report',
      );
    }
  }
}
