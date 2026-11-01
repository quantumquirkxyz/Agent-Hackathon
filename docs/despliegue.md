# WorkBridge: despliegue y operación

Este documento describe cómo se despliega y se opera WorkBridge. Todo lo que sigue se
contrastó con `package.json`, `Dockerfile`, `compose.yaml`, `vercel.json`, `migrations/`
y los `.env.example`. Donde algo no se validó de extremo a extremo, se dice.

Documentos hermanos: [arquitectura](arquitectura.md), [runbook de piloto](runbook-piloto.md),
[contexto del producto](../CONTEXT.md).

## 1. Componentes desplegables

| Componente | Ruta | Puerto | Notas |
|---|---|---|---|
| Web | `apps/web` | 3001 | Next.js app router; requiere `DATABASE_URL` para sesiones, chat y cola |
| Runtime de postulaciones | `apps/agent-runtime/src/application` | 3000 | Servidor HTTP de borradores, aprobaciones, envíos, lista corta y auditoría; `GET /health` |
| Worker del chat | `apps/web/scripts/chat-worker.ts` | — | Procesa `chat_jobs` con arrendamiento; sin él el chat queda en cola |
| Postgres | Neon u otro Postgres | — | Migraciones `001` a `004` |

## 2. Requisitos

- Node.js >= 22 y npm (workspaces).
- Docker, solo si se usa `compose.yaml`.
- Postgres/Neon. Sin base de datos el runtime funciona en memoria y no persiste.

## 3. Ejecución local

> Los comandos usan npm porque es el gestor actual del árbol. El objetivo es Bun
> (`bun install`, `bun run`), con Node como runtime de producción (ADR-0016).

```bash
npm ci
cp .env.example .env                                            # runtime y semillas
cp apps/agent-runtime/.env.example apps/agent-runtime/.env      # opcional: Certo, Maps
cp apps/web/.env.example apps/web/.env.local                    # Next.js no lee el .env raíz

npm start            # runtime de postulaciones (3000)
npm run dev          # web (3001, vía neon-env)
npm run start:worker # worker de turnos de chat (requiere DATABASE_URL)
```

Notas verificadas:

- `npm run dev` ejecuta `neon-env run -- next dev --port 3001` desde `apps/web`; si no se
  usa la CLI de Neon, define `DATABASE_URL` en `apps/web/.env.local`.
- `apps/web/.env.example` apunta `AGENT_RUNTIME_URL` a `http://localhost:3000` y
  `BETTER_AUTH_URL` a `http://localhost:3001`.
- `WORKBRIDGE_PERSISTENCE=memory` fuerza almacenes en memoria; es lo que usan las
  pruebas Playwright y no sirve para un piloto real.
- Certo local: `npm run certo:up` / `npm run certo:down` (`scripts/certo.mjs`). Requiere
  clonar antes el repositorio de Certo en `apps/certo`; el script imprime el comando y el
  commit fijado, y usa el overlay `deploy/certo/compose.local.yml`. Certo es AGPL-3.0 y se
  despliega aparte del monorepo.

## 4. Docker

`Dockerfile` multietapa sobre `node:22-alpine` con dos destinos:

- `runtime` (el destino por defecto): expone 3000, arranca
  `npx tsx apps/agent-runtime/src/application/main.ts` y tiene healthcheck sobre `GET /health`.
- `web`: ejecuta `next build` y arranca `next start` en 3001.

El worker reutiliza la imagen `runtime` con otro comando. `compose.yaml` levanta runtime,
worker y web (más Certo, que exige clonar `apps/certo`) con `npm run local:up` /
`npm run local:down`.

```bash
docker build -t workbridge-application .
docker run --rm --env-file .env -p 3000:3000 workbridge-application
docker build --target web -t workbridge-web .
```

Sin `DATABASE_URL` ni `NEON_DATABASE_URL`, `GET /health` informa
`databaseMode: "memory"` y la persistencia es temporal. Las credenciales se inyectan por
entorno del proveedor, nunca dentro de la imagen.

## 5. Vercel (actual, a retirar)

`vercel.json` enruta todas las solicitudes a
`apps/agent-runtime/src/application/vercel.ts` (función `@vercel/node`). Pasos: importar
el repositorio, definir las variables de entorno (mínimo `DATABASE_URL` y
`BETTER_AUTH_SECRET`), desplegar y comprobar `GET /health`. Si `DATABASE_URL` está vacío y
existe `NEON_DATABASE_URL`, el runtime usa Neon como respaldo y `/health` informa
`databaseMode: "neon-backup"`, `persistence: "sql"`. `apps/web` se despliega como proyecto
Next.js aparte, con su propia configuración de entorno.

> **Objetivo v1:** un solo PaaS de contenedores para web, runtime y worker (ADR-0019).
> Vercel no puede hospedar el worker de larga vida, así que `vercel.json` se retira cuando
> el despliegue en contenedores sea reproducible. Hasta entonces, esta sección describe lo
> que existe, no el destino.

### 5.1 Destino en contenedores

- Web, runtime y worker como contenedores del mismo proyecto en Fly.io, Railway o Render.
- Neon como Postgres gestionado, con una rama por entorno.
- Red privada: solo la web es pública; el runtime se alcanza desde la web.
- Secretos inyectados por la plataforma; nunca dentro de la imagen.
- Puerta de despliegue: `GET /health` del runtime y el healthcheck de base de la web.

> `vercel.json` cubre solo el runtime de postulaciones. En el destino, web, runtime y
> worker son tres contenedores del mismo PaaS (ADR-0019).

## 6. Base de datos

| Archivo | Contenido |
|---|---|
| `migrations/001_initial.sql` | `candidate_profiles`, `candidate_preferences`, `candidate_saved_searches`, `candidate_vacancy_visits` |
| `migrations/002_better_auth.sql` | `user`, `session`, `account`, `verification`, `employer_organizations` |
| `migrations/003_chat_sessions.sql` | `candidate_chat_sessions` |
| `migrations/004_chat_jobs.sql` | `chat_jobs`, `chat_queue_metrics` |

`npm run db:migrate` aplica las cuatro con la CLI de Neon (`neon psql production -- -f
...`); requiere la CLI autenticada y un proyecto o rama llamado `production`. Con
cualquier Postgres:

```bash
psql "$DATABASE_URL" -f migrations/001_initial.sql -f migrations/002_better_auth.sql \
  -f migrations/003_chat_sessions.sql -f migrations/004_chat_jobs.sql
```

`submission_idempotency` y `notification_outbox` se crean solas (`CREATE TABLE IF NOT
EXISTS`) desde el runtime al usarse con SQL.

## 7. Variables de entorno

La mayoría figura en `.env.example`, `apps/agent-runtime/.env.example` y
`apps/web/.env.example`; `BETTER_AUTH_SESSION_SECRET`, `CHAT_METRICS_TOKEN` y
`WORKBRIDGE_PERSISTENCE` se leen directamente del código. Solo se documentan nombres:
nunca se versionan valores reales.

| Variable | Propósito | Si falta |
|---|---|---|
| `DATABASE_URL` | Postgres primario | Modo memoria en el runtime; web, chat y auth no funcionan |
| `NEON_DATABASE_URL` | Respaldo SQL del runtime | Solo se usa si falta `DATABASE_URL` |
| `BETTER_AUTH_SECRET` | Firma de sesión y roles | Obligatoria para sesiones por rol |
| `BETTER_AUTH_URL` | Origen público para callbacks | Callbacks incorrectos |
| `BETTER_AUTH_SESSION_SECRET` | Secreto de sesión del BFF | Cae a `BETTER_AUTH_SECRET` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth de Google | Se desactiva Google |
| `AGENT_RUNTIME_URL` | URL del runtime para el BFF | Las rutas `/api/applications` no alcanzan el runtime |
| `OPENROUTER_API_KEY` | LLM del perfil y del chat | Extractor heurístico determinista |
| `OPENROUTER_MODEL`, `OPENROUTER_VISION_MODEL`, `OPENROUTER_BASE_URL` | Modelo de texto, de visión y base alternativa | Valor por defecto; sin visión se exige `altText` en imágenes |
| `GOOGLE_MAPS_API_KEY` | Matriz de distancias y geocodificación | Matriz local y catálogo geográfico de Panamá |
| `CERTO_BASE_URL`, `CERTO_API_TOKEN` | Verificación con Certo (fuera de localhost exige https) | Cadena de respaldo y mock transparente |
| `ACCREDIBLE_API_TOKEN`, `CREDLY_API_TOKEN` | Proveedores de credenciales (principales en v1) | Se omite el proveedor |
| `RESEND_API_KEY`, `EMAIL_FROM` | Correo transaccional (objetivo v1) | Sin clave no se entrega correo; el outbox conserva el pendiente |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Errores y trazas (objetivo v1) | Solo logs estructurados y auditoría |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | Ingesta de trazas | No hay llamada de red |
| `CHAT_METRICS_TOKEN` | Protege `/api/health/chat/metrics` | El endpoint responde 401 |
| `WORKBRIDGE_PERSISTENCE` | `memory` fuerza almacenes en memoria | Usa Neon |
| `PORT` | Puerto del runtime | 3000 |
| `AUTH_SEED_ENV`, `SEED_COUNSELOR_EMAIL`, `SEED_EMPLOYER_EMAIL` | Parámetros de `seed:roles` | Valores `example.test` de desarrollo |

Degradación elegante: sin OpenRouter hay extractor heurístico; sin Google Maps hay matriz
local; sin Certo hay cadena de proveedores y mock declarado; sin Langfuse no hay trazas
externas pero sí auditoría interna; sin base de datos el runtime funciona en memoria y no
persiste.

> Para un piloto real, `OPENROUTER_API_KEY`, `GOOGLE_MAPS_API_KEY` y una base de datos son
> requisitos, no opciones (ADR-0014).

## 8. Datos semilla

- `npm run seed:roles` (`scripts/seed-roles.ts`): requiere `DATABASE_URL` y la migración
  002. Crea en una transacción una organización de empresa y un usuario orientador y otro
  empresa (`@example.test`, configurables por `SEED_*`). Es idempotente.
- `npm run seed:demo` (`scripts/seed-demo.ts`, datos en `scripts/seed/demo-data.ts`):
  carga cuentas sintéticas de estudiantes, orientadores y empresas, con sesiones de chat y
  búsquedas guardadas. La contraseña compartida está en `DEMO_PASSWORD` y solo aplica a
  datos sintéticos.

## 9. Salud y observabilidad

- `GET /health` (runtime, 3000): informa `databaseMode` (`memory`, `primary` o
  `neon-backup`) y `persistence`. Es la comprobación posterior al despliegue.
- `GET /api/health/db` (web): consulta a Neon; responde `ok` o `503` con la causa.
- `GET /api/health/chat/metrics`: métricas y alertas de la cola; exige
  `Authorization: Bearer <CHAT_METRICS_TOKEN>`.
- `GET /audit?traceId=...`: eventos del registro append-only por traza (requiere sesión
  autorizada).
- Langfuse: al terminar un workflow, con ambas claves, se envía un lote a
  `LANGFUSE_BASE_URL/api/public/ingestion`. Es de mejor esfuerzo: un fallo no rompe la
  ejecución.
- Almacén DQL: los pasos fallidos o bloqueados se registran con estado e historial de
  transiciones válidas, de modo que un caso no se pierde en silencio.
- Outbox: tabla `notification_outbox` con rol del destinatario, canal, marca de tiempo y
  `trace_id`.
- Cola del chat: `chat_jobs` y `chat_queue_metrics`; el worker toma un trabajo a la vez
  con arrendamiento y confirma la sesión antes de marcarlo exitoso.

## 10. Seguridad

- **Secretos**: los `.env.example` solo contienen nombres; los valores viven en el
  entorno del proveedor. El runtime rechaza claves, tokens o cadenas de conexión dentro de
  borradores o razones de auditoría. Los guardrails filtran PII en entradas, salidas y
  resultados de herramientas.
- **Historial comprometido**: `apps/web/.env.local` estuvo versionado en el pasado. Quitar
  el archivo evita nuevas filtraciones, pero **no invalida secretos ya copiados**. Antes de
  un despliegue real hay que rotar todas las credenciales expuestas y purgar el historial
  (`scripts/purge-leaked-env.sh`, por defecto en modo ensayo). Ambas acciones las ejecuta
  un propietario del repositorio.
- **Autenticación y roles**: Better Auth con Postgres (enlace mágico, Google opcional,
  sesión anónima). Roles `candidate`, `counselor`, `employer`; orientador y empresa se
  asignan por semilla, no por registro libre. La empresa solo accede a datos de su
  organización (ADR-0008). El BFF firma la sesión que verifica el runtime.
- **Humano en el circuito**: la persona candidata aprueba su borrador; el orientador
  interviene ante hallazgos críticos; la empresa decide la entrevista. El envío exige las
  aprobaciones registradas y es idempotente.

## 11. Estado de validación

- `gate:ci` (lint, typecheck, cobertura) corre en GitHub Actions
  (`.github/workflows/ci.yml`) y es la compuerta bloqueante.
- Las pruebas e2e requieren web y runtime levantados y datos sembrados; no corren en CI.
- `node .agents/skills/platform/check-all.mjs` se interrumpe con `ENOENT` al leer
  `policy/tool-risk-budget.json`, un archivo que no existe en el repositorio. Es una
  validación del bundle de método, no del producto.
- Ninguna receta de despliegue (Docker, compose o Vercel) se reprodujo de extremo a
  extremo en un entorno limpio. El primer piloto debe incluir ese ensayo.
