import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class StorageService {
  async readLocalFile(
    filePath: string,
    mimeType: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await readFile(filePath);

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
    const uploadsDir = join(process.cwd(), 'uploads', 'originals');

    await mkdir(uploadsDir, { recursive: true });

    const extension = this.getExtensionFromMimeType(params.mimeType);
    const fileName = `${randomUUID()}.${extension}`;
    const fullPath = join(uploadsDir, fileName);

    await writeFile(fullPath, params.buffer);

    return {
      path: fullPath,
      url: `/uploads/originals/${fileName}`,
      mimeType: params.mimeType,
    };
  }

  async uploadGeneratedImage(params: {
    renderId: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<{ url: string; path: string; mimeType: string }> {
    const uploadsDir = join(process.cwd(), 'uploads', 'renders');

    await mkdir(uploadsDir, { recursive: true });

    const extension = this.getExtensionFromMimeType(params.mimeType);
    const fileName = `${params.renderId}-${randomUUID()}.${extension}`;
    const fullPath = join(uploadsDir, fileName);

    await writeFile(fullPath, params.buffer);

    return {
      path: fullPath,
      url: `/uploads/renders/${fileName}`,
      mimeType: params.mimeType,
    };
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
        return 'bin';
    }
  }
}
