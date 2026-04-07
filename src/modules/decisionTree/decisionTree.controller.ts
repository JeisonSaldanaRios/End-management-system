import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
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
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';

import { DecisionTreeService } from './decisionTree.service';
import type {
  ExplainDecisionTreeDTO,
  PredictDecisionTreeDTO,
  TrainDecisionTreeDTO,
} from './decisionTree.model';

import {
  DecisionTreeExplainResultDto,
  DecisionTreeModelDto,
  DecisionTreePredictResultDto,
  ExplainDecisionTreeDto,
  PredictDecisionTreeDto,
  TrainDecisionTreeDto,
} from './dto';

@Controller('decision-tree')
@ApiTags('Decision Tree')
export class DecisionTreeController {
  constructor(private readonly service: DecisionTreeService) {}

  @Post('train')
  @ApiOperation({ summary: 'Train decision tree model' })
  @ApiBody({ type: TrainDecisionTreeDto })
  @ApiCreatedResponseData(DecisionTreeModelDto, { description: 'Decision tree model trained' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async train(@Body() body: TrainDecisionTreeDTO) {
    try {
      const model = await this.service.trainModel(body);
      return {
        success: true,
        data: {
          id: model.id,
          modelName: model.modelName,
          featureNames: model.featureNames,
          trainingMetrics: model.trainingMetrics,
          modelFilePath: (model as any).modelFilePath ?? null,
          isActive: model.isActive,
          createdAt: model.createdAt,
          updatedAt: model.updatedAt,
        },
        message: 'Decision tree model trained successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error training decision tree model',
      );
    }
  }

  @Post('predict')
  @ApiOperation({ summary: 'Predict using a decision tree model' })
  @ApiBody({ type: PredictDecisionTreeDto })
  @ApiOkResponseData(DecisionTreePredictResultDto, { description: 'Prediction generated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async predict(@Body() body: PredictDecisionTreeDTO) {
    try {
      const result = await this.service.predict(body);
      return {
        success: true,
        data: result,
        message: 'Prediction generated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error generating prediction',
      );
    }
  }

  @Post('explain')
  @ApiOperation({ summary: 'Explain a prediction for a decision tree model' })
  @ApiBody({ type: ExplainDecisionTreeDto })
  @ApiOkResponseData(DecisionTreeExplainResultDto, { description: 'Prediction explanation generated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async explain(@Body() body: ExplainDecisionTreeDTO) {
    try {
      const result = await this.service.explain(body);
      return {
        success: true,
        data: result,
        message: 'Prediction explanation generated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error generating explanation',
      );
    }
  }

  @Get('models/:id')
  @ApiOperation({ summary: 'Get decision tree model by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Decision tree model id' })
  @ApiOkResponseData(DecisionTreeModelDto, { description: 'Decision tree model found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Decision tree model not found' })
  async getModelById(@Param('id') id: string) {
    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const model = await this.service.getModelById(parsedId);
    if (!model) {
      throw new NotFoundException('Decision tree model not found');
    }

    return {
      success: true,
      data: {
        id: model.id,
        modelName: model.modelName,
        featureNames: model.featureNames,
        trainingMetrics: model.trainingMetrics,
        modelFilePath: (model as any).modelFilePath ?? null,
        isActive: model.isActive,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
      },
    };
  }

  @Get('models')
  @ApiOperation({ summary: 'List decision tree models' })
  @ApiOkResponseList(DecisionTreeModelDto, { description: 'Decision tree models list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'modelName', required: false, type: String, description: 'Filter by modelName' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Filter by isActive (true/false)' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async listModels(
    @Query('modelName') modelName?: string,
    @Query('isActive') isActive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = page ? parsePositiveInt(page, 'Invalid page') : 1;
    const parsedLimit = limit ? parsePositiveInt(limit, 'Invalid limit') : 10;

    let parsedIsActive: boolean | undefined;
    if (isActive !== undefined) {
      if (isActive !== 'true' && isActive !== 'false') {
        throw new BadRequestException('Invalid isActive; use true or false');
      }

      parsedIsActive = isActive === 'true';
    }

    const filters: {
      modelName?: string;
      isActive?: boolean;
      page?: number;
      limit?: number;
    } = {
      page: parsedPage,
      limit: parsedLimit,
    };

    if (modelName !== undefined) {
      filters.modelName = modelName;
    }

    if (parsedIsActive !== undefined) {
      filters.isActive = parsedIsActive;
    }

    const result = await this.service.listModels(filters);

    return {
      success: true,
      data: result.data,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total: result.total,
        pages: Math.ceil(result.total / parsedLimit),
      },
    };
  }
}
