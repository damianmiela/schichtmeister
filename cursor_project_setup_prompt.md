# Cursor Prompt — Initial Project Setup

You are working in an existing folder that already contains:
- PROJECT_OVERVIEW.md
- MVP_SPEC.md

Your task is to initialize the **initial project structure and tooling only**.
Do NOT implement any business logic.

---

## GOAL

Set up a clean, production-ready MVP skeleton for a shift planning web application.

The result must be:
- runnable via Docker
- ready for further development
- simple, explicit, and predictable

---

## TASKS

### 1. Git
- Initialize a Git repository in this folder.
- Create a proper `.gitignore` for:
  - Next.js
  - Prisma
  - Docker
  - `.env` files

---

### 2. Next.js Project
Create a Next.js project **inside this existing folder** (do NOT create a nested subfolder).

Use:
- Next.js (App Router)
- TypeScript
- ESLint
- `src/` directory enabled
- No example/demo pages beyond the default

---

### 3. Install Dependencies

#### Frontend / UI
Install:
- @mui/material
- @mui/icons-material
- @emotion/react
- @emotion/styled

#### Backend / Database
Install:
- prisma
- @prisma/client
- pg

#### Auth (setup only, no implementation)
Install:
- next-auth

#### Utilities
Install:
- date-fns
- zod

---

### 4. Prisma Setup
- Initialize Prisma for PostgreSQL
- Create `prisma/schema.prisma` with:
  - datasource db (provider = "postgresql")
  - generator client
- Do NOT define any models yet

---

### 5. Project Structure
Create the following folder structure under `src/`:

```
src/
  app/
  app/api/
  components/
  lib/
    db/
    auth/
    rules/
  types/
  config/
```

---

### 6. Environment Variables

#### Generate secure random secrets:
- PostgreSQL database password
- NEXTAUTH_SECRET

#### Create:
- `.env.example` (with placeholders)
- `.env` (with generated secrets)

#### Required variables:
- DATABASE_URL
- POSTGRES_DB
- POSTGRES_USER
- POSTGRES_PASSWORD
- NEXTAUTH_SECRET

⚠️ IMPORTANT:
- `.env` must be gitignored
- At the end of the output, PRINT ALL GENERATED SECRETS clearly so they can be copied manually

---

### 7. Prisma Client
Create a Prisma client singleton at:

```
src/lib/db/prisma.ts
```

Requirements:
- Prevent multiple Prisma instances during development
- Follow standard Next.js + Prisma best practices

---

### 8. MUI + Next.js
Add minimal configuration to ensure MUI works correctly with Next.js App Router:
- No custom theme yet
- No layout styling yet
- Just ensure MUI components render correctly

---

### 9. Docker Setup

#### Dockerfile
- Multi-stage build
- Optimized for production
- Uses Node LTS

#### docker-compose.yml
Define services:
1. `app`
   - Next.js app
   - Uses `.env`
2. `postgres`
   - PostgreSQL
   - Uses generated credentials
   - Persistent volume

Expose only what is necessary.

---

### 10. Initial Commit
Create an initial git commit with message:

```
Initial project setup: Next.js, Prisma, MUI, Docker
```

---

## STRICT RULES

- Do NOT implement scheduling logic
- Do NOT invent business rules
- Do NOT create Prisma models
- Do NOT add API endpoints
- Keep everything minimal and explicit
- Prefer clarity over shortcuts

---

## OUTPUT REQUIREMENTS

At the end, provide:
1. Explanation of what was created
2. Full file tree
3. Generated secrets (clearly labeled, copy-ready)
4. Confirmation that the project can be started with:

```
docker-compose up
```

Proceed step by step and do not skip any setup steps.
