import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class StorageService {
  async readLocalFile(
    filePath: string,
    mimeType: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const resolvedPath = isAbsolute(filePath)
      ? filePath
      : join(process.cwd(), filePath);

    const buffer = await readFile(resolvedPath);

    return {
      buffer,
      mimeType,
    };
  }

  async downloadFromUrl(
    url: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Falha ao baixar arquivo: ${response.status} ${response.statusText}`,
      );
    }

    const mimeType =
      response.headers.get('content-type')?.split(';')[0]?.trim() ||
      'application/octet-stream';

    if (!mimeType.startsWith('image/')) {
      throw new Error(`URL não aponta para uma imagem válida: ${mimeType}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  }

  async uploadOriginalImage(params: {
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ url: string; path: string; mimeType: string }> {
    this.validateImageMimeType(params.mimeType);

    const uploadsDir = join(process.cwd(), 'uploads', 'originals');
    await mkdir(uploadsDir, { recursive: true });

    const extension = this.getExtensionFromMimeType(params.mimeType);
    const fileName = `${randomUUID()}.${extension}`;
    const relativePath = join('uploads', 'originals', fileName);
    const fullPath = join(process.cwd(), relativePath);

    await writeFile(fullPath, params.buffer);

    const appUrl = process.env.APP_URL ?? 'http://localhost:3333';

    return {
      path: relativePath,
      url: `${appUrl}/uploads/originals/${fileName}`,
      mimeType: params.mimeType,
    };
  }

  async uploadGeneratedImage(params: {
    renderId: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ url: string; path: string; mimeType: string }> {
    this.validateImageMimeType(params.mimeType);

    const uploadsDir = join(process.cwd(), 'uploads', 'renders');
    await mkdir(uploadsDir, { recursive: true });

    const extension = this.getExtensionFromMimeType(params.mimeType);
    const fileName = `${params.renderId}-${randomUUID()}.${extension}`;
    const relativePath = join('uploads', 'renders', fileName);
    const fullPath = join(process.cwd(), relativePath);

    await writeFile(fullPath, params.buffer);

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

    return {
      path: relativePath,
      url: `${appUrl}/uploads/renders/${fileName}`,
      mimeType: params.mimeType,
    };
  }

  private validateImageMimeType(mimeType: string) {
    if (!mimeType.startsWith('image/')) {
      throw new BadRequestException(
        `Tipo de arquivo inválido para upload: ${mimeType}`,
      );
    }
  }

  private getExtensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/webp':
        return 'webp';
      default:
        throw new BadRequestException(
          `Formato de imagem não suportado: ${mimeType}`,
        );
    }
  }
}
