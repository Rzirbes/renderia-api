import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

type StoredImageResult = {
  url: string;
  path: string;
  mimeType: string;
};

export type AllowedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT = '(?:png|jpg|webp)';
const UUID_RE = new RegExp(`^${UUID}$`);

/** Upload original (formato atual): uploads/originals/<userId>/<uuid>.<ext> */
const OWNED_ORIGINAL_RE = new RegExp(
  `^uploads/originals/(${UUID})/${UUID}\\.${EXT}$`,
);
/** Upload original legado (antes da correção): uploads/originals/<uuid>.<ext> */
const LEGACY_ORIGINAL_RE = new RegExp(`^uploads/originals/${UUID}\\.${EXT}$`);
/** Imagem gerada pelo servidor: uploads/renders/<renderId>-<uuid>.<ext> */
const GENERATED_RE = new RegExp(`^uploads/renders/(${UUID})-${UUID}\\.${EXT}$`);

const EXTENSION_BY_MIME: Record<AllowedImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Detecta o tipo real da imagem pelos bytes iniciais (magic bytes),
 * sem confiar no MIME/extensão informados pelo cliente.
 */
export function detectImageMimeType(
  buffer: Buffer,
): AllowedImageMimeType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

const INVALID_IMAGE_REFERENCE = 'Referência de imagem inválida.';
const IMAGE_NOT_FOUND = 'Imagem não encontrada.';
const IMAGE_FORBIDDEN = 'Imagem não pertence ao usuário autenticado.';
const NOT_AN_IMAGE = 'Arquivo não é uma imagem PNG, JPEG ou WEBP válida.';

@Injectable()
export class StorageService {
  /** Raiz única de onde a API pode ler/gravar imagens. */
  private get uploadsRoot(): string {
    return resolve(process.cwd(), 'uploads');
  }

  /**
   * Valida a referência de um upload original enviada pelo cliente em
   * `POST /renders` e devolve path/url/mimeType derivados pelo servidor.
   *
   * Só aceita arquivos no formato gerado por `uploadOriginalImage`
   * (uploads/originals/<userId>/<uuid>.<ext>) e pertencentes ao usuário.
   */
  async resolveUserOriginalImage(
    userId: string,
    relativePath: unknown,
  ): Promise<StoredImageResult> {
    if (typeof relativePath !== 'string') {
      throw new BadRequestException(INVALID_IMAGE_REFERENCE);
    }

    const match = OWNED_ORIGINAL_RE.exec(relativePath);
    if (!match) {
      throw new BadRequestException(INVALID_IMAGE_REFERENCE);
    }

    if (match[1] !== userId) {
      throw new ForbiddenException(IMAGE_FORBIDDEN);
    }

    const fullPath = await this.resolveInsideUploads(relativePath);
    const header = await this.readHeader(fullPath);
    const mimeType = detectImageMimeType(header);

    if (!mimeType) {
      throw new BadRequestException(NOT_AN_IMAGE);
    }

    return {
      path: relativePath,
      url: `${this.getAppUrl()}/${relativePath}`,
      mimeType,
    };
  }

  /**
   * Lê uma imagem já registrada em um render para processamento.
   * Nunca lê nada fora de `uploads/` nem fora dos formatos gerados pelo
   * servidor; o MIME é detectado pelo conteúdo.
   */
  async readStoredImage(
    relativePath: string,
    owner: { userId: string; parentRenderId?: string | null },
  ): Promise<{ buffer: Buffer; mimeType: AllowedImageMimeType }> {
    if (typeof relativePath !== 'string') {
      throw new BadRequestException(INVALID_IMAGE_REFERENCE);
    }

    const owned = OWNED_ORIGINAL_RE.exec(relativePath);
    const generated = GENERATED_RE.exec(relativePath);

    if (owned) {
      if (owned[1] !== owner.userId) {
        throw new ForbiddenException(IMAGE_FORBIDDEN);
      }
    } else if (generated) {
      // Imagem gerada só pode servir de base para edição de um render filho
      // cujo pai é exatamente o render que gerou o arquivo.
      if (!owner.parentRenderId || generated[1] !== owner.parentRenderId) {
        throw new ForbiddenException(IMAGE_FORBIDDEN);
      }
    } else if (!LEGACY_ORIGINAL_RE.test(relativePath)) {
      throw new BadRequestException(INVALID_IMAGE_REFERENCE);
    }

    const fullPath = await this.resolveInsideUploads(relativePath);
    const buffer = await readFile(fullPath);
    const mimeType = detectImageMimeType(buffer);

    if (!mimeType) {
      throw new BadRequestException(NOT_AN_IMAGE);
    }

    return { buffer, mimeType };
  }

  async uploadOriginalImage(params: {
    userId: string;
    buffer: Buffer;
    mimeType?: string;
  }): Promise<StoredImageResult> {
    if (!UUID_RE.test(params.userId)) {
      throw new BadRequestException('Usuário inválido.');
    }

    // O tipo vem do conteúdo, não do MIME informado no multipart.
    const mimeType = detectImageMimeType(params.buffer);
    if (!mimeType) {
      throw new BadRequestException(NOT_AN_IMAGE);
    }

    const fileName = `${randomUUID()}.${EXTENSION_BY_MIME[mimeType]}`;

    return this.saveImage({
      folder: join('originals', params.userId),
      urlFolder: `originals/${params.userId}`,
      fileName,
      buffer: params.buffer,
      mimeType,
    });
  }

  async uploadGeneratedImage(params: {
    renderId: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredImageResult> {
    this.validateImageMimeType(params.mimeType);

    const extension = this.getExtensionFromMimeType(params.mimeType);
    const fileName = `${params.renderId}-${randomUUID()}.${extension}`;

    return this.saveImage({
      folder: 'renders',
      urlFolder: 'renders',
      fileName,
      buffer: params.buffer,
      mimeType: params.mimeType,
    });
  }

  /**
   * Remove (best-effort) uma imagem gerada que não chegou a ser associada a
   * um render DONE. Só aceita caminhos no formato gerado pelo servidor e
   * dentro de `uploads/`; qualquer outra coisa é ignorada.
   */
  async deleteGeneratedImage(relativePath: string): Promise<void> {
    if (typeof relativePath !== 'string' || !GENERATED_RE.test(relativePath)) {
      return;
    }

    try {
      const fullPath = await this.resolveInsideUploads(relativePath);
      await unlink(fullPath);
    } catch {
      // Arquivo já inexistente ou inacessível: nada a fazer.
    }
  }

  /**
   * Resolve o caminho relativo garantindo que o arquivo real (após seguir
   * links simbólicos) é um arquivo regular dentro de `uploads/`.
   */
  private async resolveInsideUploads(relativePath: string): Promise<string> {
    const root = this.uploadsRoot;
    const candidate = resolve(process.cwd(), relativePath);

    if (!this.isInside(root, candidate)) {
      throw new BadRequestException(INVALID_IMAGE_REFERENCE);
    }

    let realRoot: string;
    let realCandidate: string;
    try {
      realRoot = await realpath(root);
      realCandidate = await realpath(candidate);
    } catch {
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }

    if (!this.isInside(realRoot, realCandidate)) {
      throw new BadRequestException(INVALID_IMAGE_REFERENCE);
    }

    const stats = await lstat(candidate).catch(() => null);
    if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }

    return realCandidate;
  }

  private isInside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return (
      rel !== '' &&
      rel !== '..' &&
      !rel.startsWith(`..${sep}`) &&
      !isAbsolute(rel)
    );
  }

  private async readHeader(fullPath: string): Promise<Buffer> {
    const handle = await open(fullPath, 'r');
    try {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return header.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  private async saveImage(params: {
    folder: string;
    urlFolder: string;
    fileName: string;
    buffer: Buffer;
    mimeType: string;
  }): Promise<StoredImageResult> {
    const uploadsDir = join(this.uploadsRoot, params.folder);
    await mkdir(uploadsDir, { recursive: true });

    const relativePath = `uploads/${params.urlFolder}/${params.fileName}`;
    const fullPath = join(uploadsDir, params.fileName);

    await writeFile(fullPath, params.buffer);

    const appUrl = this.getAppUrl();

    return {
      path: relativePath,
      url: `${appUrl}/${relativePath}`,
      mimeType: params.mimeType,
    };
  }

  private getAppUrl(): string {
    return process.env.APP_URL ?? 'http://localhost:3000';
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
