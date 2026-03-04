# RenderIA API

Backend da plataforma **RenderIA**, um sistema que utiliza **Inteligência Artificial para gerar renderizações arquitetônicas a partir de imagens enviadas pelo usuário**.

A API é responsável por:

- autenticação de usuários
- gerenciamento de créditos
- processamento de renderizações
- integração com serviços de IA
- histórico de imagens geradas

---

# Sobre o projeto

O **RenderIA** é uma plataforma SaaS onde arquitetos e designers podem:

1. Fazer upload de uma imagem base (ex: croqui, planta ou render simples)
2. Aplicar um prompt descritivo
3. Gerar uma **renderização realista utilizando IA**

Cada render consome **créditos da conta do usuário**.

---

# Arquitetura

A API foi construída utilizando **NestJS** com foco em:

- organização modular
- separação de responsabilidades
- escalabilidade
- boas práticas de backend

Estrutura baseada em:

- Controllers
- Services
- Modules
- DTOs
- Prisma ORM

---

# Tecnologias utilizadas

- **NestJS**
- **TypeScript**
- **Prisma ORM**
- **PostgreSQL**
- **Docker**
- **JWT Authentication**
- **pnpm**

---

# Estrutura do projeto

```
src
 ┣ modules
 ┃ ┗ auth
 ┃   ┣ auth.controller.ts
 ┃   ┣ auth.service.ts
 ┃   ┗ auth.module.ts
 ┣ database
 ┃ ┗ prisma
 ┃   ┗ prisma.service.ts
 ┣ config
 ┃ ┗ env.ts
 ┣ app.module.ts
 ┣ main.ts
```

---

# Modelagem do banco

Principais entidades do sistema:

### User

Usuário da plataforma.

```
User
- id
- name
- email
- password
- credits
- createdAt
- updatedAt
```

---

### Render

Registro de renderizações feitas pelo usuário.

```
Render
- id
- userId
- originalImageUrl
- generatedImageUrl
- prompt
- status
- creditsUsed
- createdAt
```

Status possíveis:

```
PENDING
PROCESSING
DONE
ERROR
```

---

### CreditTransaction

Controle de movimentação de créditos.

```
CreditTransaction
- id
- userId
- type
- amount
- createdAt
```

Tipos:

```
PURCHASE
USAGE
BONUS
REFUND
```

---

# Autenticação

O sistema utiliza **JWT (JSON Web Token)** para autenticação.

Fluxo:

```
POST /auth/register
POST /auth/login
GET /auth/me
```

Após login, o usuário recebe um **token JWT** que deve ser enviado no header:

```
Authorization: Bearer TOKEN
```

---

# Instalação

Clone o repositório

```bash
git clone https://github.com/seu-usuario/renderia-api.git
```

Entre na pasta

```bash
cd renderia-api
```

Instale as dependências

```bash
pnpm install
```

---

# Configuração do ambiente

Crie um arquivo `.env`

```
DATABASE_URL=postgresql://user:password@localhost:5432/renderia
JWT_SECRET=your_secret
```

---

# Rodando migrations do Prisma

```bash
pnpm prisma migrate dev
```

---

# Rodando o projeto

Modo desenvolvimento:

```bash
pnpm start:dev
```

Build:

```bash
pnpm build
```

Produção:

```bash
pnpm start:prod
```

---

# Testes

Rodar testes unitários:

```bash
pnpm test
```

Rodar testes e2e:

```bash
pnpm test:e2e
```

---

# Docker

Subir banco e serviços com docker:

```bash
docker-compose up -d
```

---

# Roadmap

Próximas funcionalidades planejadas:

- upload de imagens para S3
- integração com Google Gemini para geração de render
- sistema de compra de créditos
- histórico de renderizações
- sistema de fila para processamento de imagens
- rate limit por usuário

---

# Autor

**Rômulo Zirbes**

Desenvolvedor Full Stack focado em:

- React
- Next.js
- Node.js
- NestJS
- Prisma
- PostgreSQL

GitHub:  
https://github.com/romulozirbes

---

# Objetivo do projeto

Este projeto faz parte do portfólio de desenvolvimento e tem como objetivo demonstrar:

- construção de APIs escaláveis
- arquitetura backend com NestJS
- integração com IA
- modelagem de banco de dados
- boas práticas de desenvolvimento
