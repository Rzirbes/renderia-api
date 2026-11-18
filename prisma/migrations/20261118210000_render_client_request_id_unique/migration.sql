-- Idempotência da criação de renders por (userId, clientRequestId).
--
-- O que faz: cria um índice UNIQUE e remove o índice simples antigo. Não
-- altera, apaga nem reescreve nenhuma linha/coluna. NULLs não conflitam em
-- UNIQUE no PostgreSQL: renders sem clientRequestId não são afetados, e a
-- mesma chave em usuários diferentes é permitida.
--
-- Atomicidade: o Prisma envia o arquivo inteiro como uma única consulta, que
-- o PostgreSQL executa numa transação implícita. Se o pré-check ou o CREATE
-- falhar, nada é aplicado (o índice antigo permanece). Validado com
-- `prisma migrate deploy` em PostgreSQL 16 descartável.
--
-- Duplicatas: o bloco DO aborta com mensagem clara (Prisma P3018) sem
-- tocar nos dados. Uma duplicata inserida entre o pré-check e o CREATE faz o
-- próprio CREATE UNIQUE INDEX falhar, com o mesmo efeito (rollback).
--
-- Se abortar:
--   1. Diagnóstico (somente leitura):
--        SELECT "userId", "clientRequestId", count(*), array_agg(id)
--        FROM "Render" WHERE "clientRequestId" IS NOT NULL
--        GROUP BY 1, 2 HAVING count(*) > 1;
--   2. Decidir manualmente qual render mantém a chave e liberar as demais
--      (ex.: anexar sufixo ao clientRequestId), sem apagar renders.
--   3. npx prisma migrate resolve --rolled-back 20261118210000_render_client_request_id_unique
--   4. npx prisma migrate deploy
--
-- Lock: CREATE INDEX (não CONCURRENTLY, que não roda em transação) bloqueia
-- escritas em "Render" durante a construção; leituras seguem. Com a tabela
-- pequena atual, deve levar milissegundos.
--
-- Ordem de deploy: aplicar esta migration ANTES de publicar o código novo.

DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT 1 FROM "Render"
    WHERE "clientRequestId" IS NOT NULL
    GROUP BY "userId", "clientRequestId"
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'Render: % grupo(s) duplicado(s) de (userId, clientRequestId). Resolva antes de aplicar esta migration.',
      dup_groups;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "Render_userId_clientRequestId_key" ON "Render"("userId", "clientRequestId");

-- DropIndex (redundante: buscas por clientRequestId sempre filtram por userId)
DROP INDEX IF EXISTS "Render_clientRequestId_idx";
