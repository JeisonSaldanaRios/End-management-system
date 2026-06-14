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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';

import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { Roles } from '../../common/decorators';

import { PersonService } from './person.service';
import type { CreatePersonDTO, PersonStatus } from './person.model';
import { PersonEntity } from './person.entity';
import { CreatePersonDto, UpdatePersonDto } from './dto';

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const imageUploadOptions = {
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
};

@Controller('person')
@ApiTags('Person')
export class PersonController {
  constructor(private readonly service: PersonService) {}

  private getCurrentUser(req: Request): { userId: number; campId: number; rol: string } {
    const currentUser = req.user as { userId?: number; campId?: number; rol?: string } | undefined;

    if (
      typeof currentUser?.userId !== 'number' ||
      currentUser.userId <= 0 ||
      typeof currentUser.campId !== 'number' ||
      currentUser.campId <= 0 ||
      typeof currentUser.rol !== 'string' ||
      !currentUser.rol
    ) {
      throw new BadRequestException('Authenticated user context is invalid');
    }

    return {
      userId: currentUser.userId,
      campId: currentUser.campId,
      rol: currentUser.rol,
    };
  }

  @Post()
  @Roles('NO_ACCESS')
  @ApiOperation({ summary: 'Create Person' })
  @ApiBody({ type: CreatePersonDto })
  @ApiCreatedResponseData(PersonEntity, { description: 'Person created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async create(@Body() body: CreatePersonDTO) {
    try {
      const person = await this.service.createPerson(body);
      return {
        success: true,
        data: person,
        message: 'Person created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating person',
      );
    }
  }

  @Get(':id')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Get Person by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiOkResponseData(PersonEntity, { description: 'Person found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Person not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getById(@Param('id') id: string, @Req() req: Request) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    const person = await this.service.getPersonWithSignedUrl(parsedId);
    if (!person) throw new NotFoundException('Person not found');

    const currentUser = this.getCurrentUser(req);
    if (person.campId !== currentUser.campId) {
      throw new BadRequestException('You do not have permission to view this person');
    }

    return { success: true, data: person };
  }

  @Get()
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'List Person' })
  @ApiOkResponseList(PersonEntity, { description: 'Person list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (pagination)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('currentStatus') currentStatus?: PersonStatus,
    @Query('occupationId') occupationId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ) {
    try {
      const filters: {
        campId?: number;
        currentStatus?: PersonStatus;
        occupationId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (!req) {
        throw new BadRequestException('Request context is required');
      }

      const currentUser = this.getCurrentUser(req);
      filters.campId = currentUser.campId;

      if (campId) {
        const parsedCampId = Number.parseInt(campId, 10);
        if (Number.isNaN(parsedCampId)) {
          throw new BadRequestException('Invalid camp ID');
        }

        if (parsedCampId !== currentUser.campId) {
          throw new BadRequestException('You cannot query persons from another camp');
        }

        filters.campId = parsedCampId;
      }

      if (currentStatus) {
        filters.currentStatus = currentStatus;
      }

      if (occupationId) {
        const parsedOccupationId = Number.parseInt(occupationId, 10);
        if (Number.isNaN(parsedOccupationId)) {
          throw new BadRequestException('Invalid occupation ID');
        }
        filters.occupationId = parsedOccupationId;
      }

      if (page) {
        const parsedPage = Number.parseInt(page, 10);
        if (Number.isNaN(parsedPage) || parsedPage < 1) {
          throw new BadRequestException('Invalid page');
        }
        filters.page = parsedPage;
      }

      if (limit) {
        const parsedLimit = Number.parseInt(limit, 10);
        if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
          throw new BadRequestException('Invalid limit');
        }
        filters.limit = parsedLimit;
      }

      const result = await this.service.getAllPersonsWithSignedUrls(filters);
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
        error instanceof Error ? error.message : 'Error getting persons',
      );
    }
  }

  @Put(':id')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Update Person' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiBody({ type: UpdatePersonDto })
  @ApiOkResponseData(PersonEntity, { description: 'Person updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Person not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async update(@Param('id') id: string, @Body() body: UpdatePersonDto, @Req() req: Request) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    try {
      const currentUser = this.getCurrentUser(req);
      const existingPerson = await this.service.getPersonById(parsedId);
      if (!existingPerson) throw new NotFoundException('Person not found');

      if (existingPerson.campId !== currentUser.campId) {
        throw new BadRequestException('You do not have permission to update this person');
      }

      const payload: any = { ...body };
      if (payload.birthDate && typeof payload.birthDate === 'string') {
        payload.birthDate = new Date(payload.birthDate);
      }

      const person = await this.service.updatePerson(parsedId, payload);
      if (!person) throw new NotFoundException('Person not found');

      return {
        success: true,
        data: person,
        message: 'Person updated successfully',
      };
    } catch (error) {
      if (error && typeof (error as any).getStatus === 'function') {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating person',
      );
    }
  }

  @Post(':id/photo')
  @Roles('SYSTEM_ADMIN', 'WORKER', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER')
  @ApiOperation({ summary: 'Upload person photo' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponseData(PersonEntity, { description: 'Photo uploaded successfully' })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    if (!file) throw new BadRequestException('No file uploaded');

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed');
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException('File too large. Maximum size is 5MB');
    }

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    try {
      const currentUser = this.getCurrentUser(req);
      const existingPerson = await this.service.getPersonById(parsedId);
      if (!existingPerson) throw new NotFoundException('Person not found');

      const user = await this.service.findUserByPersonId(parsedId);
      const isOwner = user && user.id === currentUser.userId;

      if (!isOwner) {
        throw new BadRequestException(
          `You can only update your own profile photo. Your User ID: ${currentUser.userId}, Person ID in URL: ${parsedId}, Found Linked User: ${user?.id ?? 'none'}`,
        );
      }

      const person = await this.service.uploadPersonPhoto(parsedId, file);
      return {
        success: true,
        data: person,
        message: 'Photo uploaded successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error uploading photo',
      );
    }
  }

  @Put(':id/photo')
  @Roles('SYSTEM_ADMIN', 'WORKER', 'RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER')
  @ApiOperation({ summary: 'Update person photo' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponseData(PersonEntity, { description: 'Photo updated successfully' })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async updatePhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    if (!file) throw new BadRequestException('No file uploaded');

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed');
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException('File too large. Maximum size is 5MB');
    }

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    try {
      const currentUser = this.getCurrentUser(req);
      const existingPerson = await this.service.getPersonById(parsedId);
      if (!existingPerson) throw new NotFoundException('Person not found');

      const user = await this.service.findUserByPersonId(parsedId);
      const isOwner = user && user.id === currentUser.userId;

      if (!isOwner) {
        throw new BadRequestException(
          `You can only update your own profile photo. Your User ID: ${currentUser.userId}, Person ID in URL: ${parsedId}, Found Linked User: ${user?.id ?? 'none'}`,
        );
      }

      const person = await this.service.uploadPersonPhoto(parsedId, file);
      return {
        success: true,
        data: person,
        message: 'Photo updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating photo',
      );
    }
  }

  @Delete(':id')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Delete Person' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiOkResponseMessage({ description: 'Person deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Person not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async delete(@Param('id') id: string, @Req() req: Request) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    try {
      const currentUser = this.getCurrentUser(req);
      const existingPerson = await this.service.getPersonById(parsedId);
      if (!existingPerson) throw new NotFoundException('Person not found');

      if (existingPerson.campId !== currentUser.campId) {
        throw new BadRequestException('You do not have permission to delete this person');
      }

      const deleted = await this.service.deletePerson(parsedId);
      if (!deleted) throw new NotFoundException('Person not found');

      return { success: true, message: 'Person deleted successfully' };
    } catch (error) {
      if (error && typeof (error as any).getStatus === 'function') {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting person',
      );
    }
  }
}