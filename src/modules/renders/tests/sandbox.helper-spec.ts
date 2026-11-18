import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const FILE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const RENDER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const OTHER_RENDER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/** Assinatura PNG + bytes arbitrários (suficiente para detecção por magic bytes). */
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
]);
export const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('fake-jpeg-body'),
]);
/** Conteúdo não-imagem (texto inofensivo, nunca um arquivo sensível real). */
export const TEXT_BYTES = Buffer.from('isto nao e uma imagem');

/**
 * Cria um diretório temporário isolado que faz o papel de `process.cwd()`,
 * com `uploads/` e um arquivo "secreto" FICTÍCIO fora de `uploads/`
 * para testar traversal sem tocar em arquivos reais do sistema.
 */
export async function createSandbox() {
  const root = await mkdtemp(join(tmpdir(), 'renderia-storage-test-'));
  await mkdir(join(root, 'uploads', 'originals', USER_A), { recursive: true });
  await mkdir(join(root, 'uploads', 'originals', USER_B), { recursive: true });
  await mkdir(join(root, 'uploads', 'renders'), { recursive: true });
  await writeFile(join(root, 'fake-secret.txt'), 'FAKE_SECRET=nao-real');

  const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(root);

  return {
    root,
    async cleanup() {
      cwdSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    },
  };
}
