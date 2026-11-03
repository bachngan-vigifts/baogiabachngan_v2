# GUIDELINES FOR CODEX AGENTS & SESSIONS

## 1. Project Context & Stack
- **Architecture**: Decoupled Monorepo / Multi-branch setup.
- **Frontend**: React / Next.js (TypeScript, Tailwind CSS).
- **Backend**: Node.js / Express (TypeScript, Prisma ORM, PostgreSQL).
- **Primary Goal**: Keep modules decoupled so multiple AI sessions can work on separate Git branches safely.

---

## 2. Token & Rate Limit Optimization Rules
- **Concise Responses**: When outputting code, focus ONLY on the modified code or specific files requested. Do NOT reprint unmodified existing files.
- **Incremental Steps**: Work on ONE file or task at a time. Stop and ask for verification before moving to the next component.
- **Context Management**: Do not read large binary files, node_modules, or build directories (`dist`, `.next`, `build`).

---

## 3. Branching & Scope Boundaries
Each Codex session must strictly adhere to the scope of its current Git branch:

- **If working on `feature/api-*` (Backend)**:
  - Scope: Restricted to `/src/server`, `/prisma`, and `/src/types`.
  - Do NOT touch UI components or CSS files.
  - Always export clean TypeScript types/interfaces so Frontend sessions can consume them seamlessly.

- **If working on `feature/ui-*` (Frontend)**:
  - Scope: Restricted to `/src/components`, `/src/pages`, and `/src/styles`.
  - Do NOT modify database schemas or backend controllers.
  - Use mock data or import shared types from `/src/types` if backend APIs are not yet merged.

---

## 4. Coding Standards & Conventions
- **TypeScript**: Strict type checking. Avoid `any`. Use explicit return types for functions.
- **Error Handling**: Standardize API response format `{ success: boolean, data?: T, error?: string }`.
- **Imports**: Use path aliases (e.g., `@/components/`, `@/services/`, `@/types/`).
- **File Naming**: 
  - React Components: `PascalCase.tsx`
  - Helpers/Services/Routes: `camelCase.ts`

---

## 5. Testing & Quality Assurance (MỚI)
- **Mandatory Test Execution**: Before proposing or executing any git commit, you MUST execute `npm test` (or the relevant sub-test command for the module).
- **Zero-Failure Policy**: If unit tests fail, DO NOT proceed to commit. Analyze test errors, fix the implementation or update existing tests, and re-run `npm test` until all pass.
- **Test Coverage for New Code**: Every new feature, utility, or API endpoint must include accompanying unit/integration tests (`.test.ts` or `.spec.tsx`).

---

## 6. Git & Conflict Prevention Strategy
- Always format code with Prettier/ESLint before completing a prompt task.
- Do NOT generate inline git commands that perform `git push` or `git merge` automatically unless explicitly instructed.
- If a merge conflict occurs, ask the user to provide the conflict markers explicitly before attempting to resolve.

## 7. Unit Test Standards
- Always write unit tests for new business logic using Vitest/Jest following the structure in `TEST_TEMPLATE.ts`.
- Ensure all async functions cover: (1) Success path, (2) Not found / Edge cases, and (3) Exception handling.
