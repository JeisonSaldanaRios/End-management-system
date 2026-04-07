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


import { AiAdmissionReportService } from './aiAdmissionReport.service';
import type {
  AiDecision,
  CreateAiAdmissionReportDTO,
  UpdateAiAdmissionReportDTO,
} from './aiAdmissionReport.model';
import { AiAdmissionReportEntity } from './aiAdmissionReport.entity';

import { CreateAiAdmissionReportDto, UpdateAiAdmissionReportDto } from './dto';
@Controller('ai-admission-reports')
@ApiTags('Ai Admission Report')
export class AiAdmissionReportController {
  constructor(private readonly service: AiAdmissionReportService) {}
  @Post()
  @ApiOperation({ summary: 'Create Ai Admission Report' })
  @ApiBody({ type: CreateAiAdmissionReportDto })
  @ApiCreatedResponseData(AiAdmissionReportEntity, { description: 'Ai Admission Report created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateAiAdmissionReportDTO) {
    try {
      const report = await this.service.createReport(body);
      return {
        success: true,
        data: report,
        message: 'AI admission report created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating AI admission report',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Ai Admission Report by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Ai Admission Report id' })
  @ApiOkResponseData(AiAdmissionReportEntity, { description: 'Ai Admission Report found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Ai Admission Report not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const report = await this.service.getReportById(parsedId);
    if (!report) throw new NotFoundException('AI admission report not found');

    return { success: true, data: report };
  }
  @Get()
  @ApiOperation({ summary: 'List Ai Admission Report' })
  @ApiOkResponseList(AiAdmissionReportEntity, { description: 'Ai Admission Report list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('requestId') requestId?: string,
    @Query('aiDecision') aiDecision?: AiDecision,
    @Query('suggestedOccupationId') suggestedOccupationId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        requestId?: number;
        aiDecision?: AiDecision;
        suggestedOccupationId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (requestId) {
        const parsedRequestId = parsePositiveInt(requestId, 'Invalid requestId');
        filters.requestId = parsedRequestId;
      }

      if (aiDecision) {
        filters.aiDecision = aiDecision;
      }

      if (suggestedOccupationId) {
        const parsedSuggestedOccupationId = parsePositiveInt(suggestedOccupationId, 'Invalid suggestedOccupationId');
        filters.suggestedOccupationId = parsedSuggestedOccupationId;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllReports(filters);
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
        error instanceof Error ? error.message : 'Error getting AI admission reports',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Ai Admission Report' })
  @ApiParam({ name: 'id', type: Number, description: 'Ai Admission Report id' })
  @ApiBody({ type: UpdateAiAdmissionReportDto })
  @ApiOkResponseData(AiAdmissionReportEntity, { description: 'Ai Admission Report updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Ai Admission Report not found' })
  async update(@Param('id') id: string, @Body() body: UpdateAiAdmissionReportDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const report = await this.service.updateReport(parsedId, body);
      if (!report) throw new NotFoundException('AI admission report not found');

      return {
        success: true,
        data: report,
        message: 'AI admission report updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating AI admission report',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Ai Admission Report' })
  @ApiParam({ name: 'id', type: Number, description: 'Ai Admission Report id' })
  @ApiOkResponseMessage({ description: 'Ai Admission Report deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Ai Admission Report not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteReport(parsedId);
      if (!deleted) throw new NotFoundException('AI admission report not found');

      return { success: true, message: 'AI admission report deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting AI admission report',
      );
    }
  }
}
