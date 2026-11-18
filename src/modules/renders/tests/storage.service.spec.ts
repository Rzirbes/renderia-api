import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { StorageService, detectImageMimeType } from '../storage.service';
import {
  FILE_ID,
  JPEG_BYTES,
  OTHER_RENDER_ID,
  PNG_BYTES,
  RENDER_ID,
  TEXT_BYTES,
  USER_A,
  USER_B,
  createSandbox,
} from './sandbox.helper-spec';

describe('StorageService (segurança de caminhos)', () => {
  let sandbox: Awaited<ReturnType<typeof createSandbox>>;
  let service: StorageService;

  const ownPath = `uploads/originals/${USER_A}/${FILE_ID}.png`;

  beforeEach(async () => {
    sandbox = await createSandbox();
    service = new StorageService();
    await writeFile(join(sandbox.root, ownPath), PNG_BYTES);
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  describe('detectImageMimeType', () => {
    it('detecta PNG, JPEG e WEBP pelos bytes', () => {
      expect(detectImageMimeType(PNG_BYTES)).toBe('image/png');
      expect(detectImageMimeType(JPEG_BYTES)).toBe('image/jpeg');
      const webp = Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.from([0, 0, 0, 0]),
        Buffer.from('WEBPVP8 '),
      ]);
      expect(detectImageMimeType(webp)).toBe('image/webp');
    });

    it('rejeita conteúdo que não é imagem', () => {
      expect(detectImageMimeType(TEXT_BYTES)).toBeNull();
      expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('resolveUserOriginalImage', () => {
    it('aceita upload do próprio usuário e deriva url/mime no servidor', async () => {
      process.env.APP_URL = 'https://api.example.test';
      const res = await service.resolveUserOriginalImage(USER_A, ownPath);
      expect(res).toEqual({
        path: ownPath,
        url: `https://api.example.test/${ownPath}`,
        mimeType: 'image/png',
      });
      delete process.env.APP_URL;
    });

    const malicious: Array<[string, unknown]> = [
      ['caminho absoluto do sistema', '/etc/passwd'],
      ['caminho absoluto proc', '/proc/self/environ'],
      ['traversal simples', '../fake-secret.txt'],
      ['traversal a partir de uploads', 'uploads/../fake-secret.txt'],
      [
        'traversal dentro do formato esperado',
        `uploads/originals/${USER_A}/../../../fake-secret.txt`,
      ],
      ['.env relativo', '.env'],
      ['traversal codificado', 'uploads/originals/%2e%2e/%2e%2e/.env'],
      ['barra invertida', `uploads\\originals\\${USER_A}\\${FILE_ID}.png`],
      ['byte nulo', `${ownPath}\0.png`],
      ['URL externa', 'https://evil.example/x.png'],
      ['file://', `file://${ownPath}`],
      [
        'pasta de renders não é aceita no create',
        `uploads/renders/${RENDER_ID}-${FILE_ID}.png`,
      ],
      [
        'formato legado (sem dono) não é aceito no create',
        `uploads/originals/${FILE_ID}.png`,
      ],
      ['extensão não permitida', `uploads/originals/${USER_A}/${FILE_ID}.txt`],
      [
        'letras maiúsculas',
        `uploads/originals/${USER_A}/${FILE_ID.toUpperCase()}.png`,
      ],
      ['string vazia', ''],
      ['não-string', { path: ownPath }],
    ];

    it.each(malicious)('rejeita %s', async (_label, input) => {
      await expect(
        service.resolveUserOriginalImage(USER_A, input),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('não lê o arquivo fictício de fora de uploads em traversal', async () => {
      const err = (await service
        .resolveUserOriginalImage(USER_A, '../fake-secret.txt')
        .then(
          () => null,
          (e: unknown) => e,
        )) as Error;
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).not.toContain('FAKE_SECRET');
      expect(err.message).not.toContain('fake-secret');
    });

    it('rejeita upload de outro usuário (403)', async () => {
      const otherPath = `uploads/originals/${USER_B}/${FILE_ID}.png`;
      await writeFile(join(sandbox.root, otherPath), PNG_BYTES);
      await expect(
        service.resolveUserOriginalImage(USER_A, otherPath),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejeita arquivo inexistente (404)', async () => {
      await expect(
        service.resolveUserOriginalImage(
          USER_A,
          `uploads/originals/${USER_A}/${RENDER_ID}.png`,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejeita arquivo com extensão de imagem mas conteúdo que não é imagem', async () => {
      const fake = `uploads/originals/${USER_A}/${RENDER_ID}.png`;
      await writeFile(join(sandbox.root, fake), TEXT_BYTES);
      await expect(
        service.resolveUserOriginalImage(USER_A, fake),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita link simbólico que aponta para fora de uploads', async () => {
      const link = `uploads/originals/${USER_A}/${RENDER_ID}.png`;
      await symlink(
        join(sandbox.root, 'fake-secret.txt'),
        join(sandbox.root, link),
      );
      await expect(
        service.resolveUserOriginalImage(USER_A, link),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita link simbólico mesmo apontando para imagem dentro de uploads', async () => {
      const link = `uploads/originals/${USER_A}/${RENDER_ID}.png`;
      await symlink(join(sandbox.root, ownPath), join(sandbox.root, link));
      await expect(
        service.resolveUserOriginalImage(USER_A, link),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('readStoredImage (processamento)', () => {
    it('lê upload do dono e detecta o MIME pelo conteúdo', async () => {
      const res = await service.readStoredImage(ownPath, { userId: USER_A });
      expect(res.mimeType).toBe('image/png');
      expect(res.buffer.equals(PNG_BYTES)).toBe(true);
    });

    it('recusa caminhos absolutos/traversal gravados no banco (registros antigos)', async () => {
      for (const p of [
        '/etc/passwd',
        '../fake-secret.txt',
        'uploads/../fake-secret.txt',
        `uploads/originals/${USER_A}/../../../fake-secret.txt`,
      ]) {
        await expect(
          service.readStoredImage(p, { userId: USER_A }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('recusa upload de outro usuário', async () => {
      await expect(
        service.readStoredImage(ownPath, { userId: USER_B }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('aceita imagem gerada apenas como base de edição do render pai', async () => {
      const generated = `uploads/renders/${RENDER_ID}-${FILE_ID}.jpg`;
      await writeFile(join(sandbox.root, generated), JPEG_BYTES);

      await expect(
        service.readStoredImage(generated, {
          userId: USER_A,
          parentRenderId: RENDER_ID,
        }),
      ).resolves.toMatchObject({ mimeType: 'image/jpeg' });

      await expect(
        service.readStoredImage(generated, {
          userId: USER_A,
          parentRenderId: OTHER_RENDER_ID,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        service.readStoredImage(generated, { userId: USER_A }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('mantém compatibilidade com uploads legados no formato estrito', async () => {
      const legacy = `uploads/originals/${FILE_ID}.jpg`;
      await writeFile(join(sandbox.root, legacy), JPEG_BYTES);
      await expect(
        service.readStoredImage(legacy, { userId: USER_A }),
      ).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    });

    it('recusa arquivo inexistente e conteúdo não-imagem', async () => {
      await expect(
        service.readStoredImage(
          `uploads/originals/${USER_A}/${RENDER_ID}.png`,
          {
            userId: USER_A,
          },
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      const fake = `uploads/originals/${USER_A}/${RENDER_ID}.webp`;
      await writeFile(join(sandbox.root, fake), TEXT_BYTES);
      await expect(
        service.readStoredImage(fake, { userId: USER_A }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('uploadOriginalImage', () => {
    it('grava na pasta do usuário com extensão derivada do conteúdo', async () => {
      // MIME declarado pelo cliente (jpeg) é ignorado; o conteúdo é PNG.
      const res = await service.uploadOriginalImage({
        userId: USER_A,
        buffer: PNG_BYTES,
        mimeType: 'image/jpeg',
      });
      expect(res.mimeType).toBe('image/png');
      expect(res.path).toMatch(
        new RegExp(`^uploads/originals/${USER_A}/[0-9a-f-]{36}\\.png$`),
      );
      // O path devolvido é aceito de volta no create pelo mesmo usuário.
      await expect(
        service.resolveUserOriginalImage(USER_A, res.path),
      ).resolves.toMatchObject({ path: res.path });
    });

    it('rejeita conteúdo não-imagem mesmo com MIME de imagem', async () => {
      await expect(
        service.uploadOriginalImage({
          userId: USER_A,
          buffer: TEXT_BYTES,
          mimeType: 'image/png',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita userId fora do formato UUID (evita injeção de caminho)', async () => {
      await expect(
        service.uploadOriginalImage({
          userId: '../../etc',
          buffer: PNG_BYTES,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
