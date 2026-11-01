# WorkBridge: stack tecnológico objetivo

Stack de v1 y plan de migración desde el código actual. Cada elección declara su estado:
**mantener** (ya está y se queda), **adoptar** (decisión nueva, migración pendiente) o
**retirar**. Las decisiones durables están en ADR-0016 a ADR-0019.

> Regla de lectura: este documento describe el **objetivo**. El código actual todavía usa
> npm, `node:http` y `pg` crudo; no se afirma que la migración esté hecha.

## 1. Principios

1. **TypeScript estricto de punta a punta**, sin `any` implícito y con contratos
   compartidos entre web, runtime y paquetes.
2. **El runtime de producción es Node.js 22.** Bun acelera el desarrollo, no reemplaza a
   Node donde Next.js y Mastra no están garantizados.
3. **Determinismo primero:** el LLM conversa, extrae y redacta; nunca decide restricciones.
4. **Una sola fuente por capa:** un esquema de base, un contrato de dominio, un cliente de
   API tipado.
5. **Degradación explícita:** toda integración externa tiene respaldo y deja rastro de por
   qué se usó.
6. **Operable por un equipo pequeño:** tres servicios, un PaaS, una base gestionada.

## 2. Stack por capa

| Capa | Elección | Estado | Por qué |
|---|---|---|---|
| Lenguaje | TypeScript 5.7+, `strict` | Mantener | Contratos y refactors seguros |
| Runtime de producción | Node.js 22 LTS, ESM | Mantener | Soporte real de Next.js, Mastra y APIs de Node |
| Gestor de paquetes y scripts | **Bun 1.2+** (workspaces, `bun install`, `bun run`) | Adoptar | Instalación y arranque más rápidos; lockfile único |
| Monorepo | Bun workspaces (`packages/*`, `apps/*`) | Adoptar | Sin herramienta extra; `package.json` sigue siendo la fuente |
| Web | Next.js 16 App Router + React 19 | Mantener | RSC, Server Actions, ecosistema y despliegue simple |
| API del runtime | **Hono** sobre Web Standard | Adoptar | Router tipado, middleware, RPC cliente, corre en Node y en contenedor |
| Flujo de agentes | Mastra | Mantener | Grafo, envelopes y trazabilidad ya implementados |
| Base de datos | Neon Postgres | Mantener | Rama por entorno, respaldo y conexión gestionada |
| Acceso a datos | **Drizzle ORM + drizzle-kit** | Adoptar | Esquema en TS, SQL visible, buen soporte de Neon |
| Migraciones | Línea base Drizzle desde `migrations/001..004` | Adoptar | Una sola fuente de esquema; el SQL actual es el punto de partida |
| Autenticación | Better Auth (roles + organización) | Mantener | Sesión firmada y binding por organización ya probado |
| Contratos de dominio | JSON Schema 2020-12 + Ajv | Mantener | Contratos publicables y validación en cada frontera |
| Validación de bordes | **Zod** (HTTP, formularios, entorno) | Adoptar | Tipos inferidos y mensajes útiles |
| UI | Tailwind CSS v4 + shadcn/ui | Mantener | ADR-0007 |
| Datos en la web | RSC + Server Actions, TanStack Query selectivo | Adoptar | Menos estado manual; Query solo para datos vivos |
| Pruebas | Vitest (node + jsdom) + Playwright | Mantener | Cobertura v8, proyectos y e2e ya funcionan |
| Observabilidad | Sentry + OpenTelemetry + Langfuse | Adoptar | Errores, trazas entre servicios y spans de agentes |
| Correo | Resend tras adaptador propio, SMTP de respaldo | Adoptar | Entrega buena sin encierro; el outbox sigue siendo la verdad |
| Mapas | Google Maps (Distance Matrix + Geocoding) | Mantener (obligatorio en prod) | Cobertura nacional; matriz local solo en desarrollo |
| Credenciales | Accredible y Credly; Certo como adaptador | Adoptar | Verificación real sin desplegar un servicio propio |
| LLM | OpenRouter con modelos de pago y presupuesto | Mantener (cambiar a pago) | Cadena con fallback y costo acotado |
| Despliegue | Un PaaS de contenedores (Fly.io, Railway o Render) + Neon | Adoptar | Worker de larga vida, red privada y un solo modelo de despliegue |
| CI | GitHub Actions con Bun y caché | Adoptar | `gate:ci` sigue siendo la compuerta |

## 3. Decisiones y sus límites

### 3.1 Bun como gestor, no como runtime

Bun reemplaza a npm para instalar, resolver workspaces y ejecutar scripts. **No** ejecuta
la web, el runtime ni el worker en producción, y **no** reemplaza a Vitest.

Motivo: Next.js, Mastra y varias APIs de Node no tienen soporte garantizado sobre el
runtime de Bun. Un fallo ahí no se arregla con configuración; se arregla volviendo a Node,
y para entonces el equipo ya migró todo. La ganancia real (instalación y DX) se obtiene sin
ese riesgo.

Consecuencias: `bun.lock` reemplaza a `package-lock.json`; el `Dockerfile` instala con Bun
y ejecuta con Node; CI usa `oven-sh/setup-bun`; los scripts dejan de depender de
`npm run --workspace`.

### 3.2 Hono para la API

El runtime de postulaciones hoy es un servidor `node:http` con router propio. Hono aporta
router tipado, middleware, manejo uniforme de errores y un cliente RPC que la web puede
consumir sin generar SDK.

Límite: Hono no cambia el dominio. Los servicios (`application/service.ts`, solver,
gates) siguen siendo funciones puras; Hono solo es la borde HTTP.

### 3.3 Drizzle con una sola fuente de esquema

El esquema actual vive en SQL escrito a mano y las consultas en `pg` crudo. Drizzle pasa a
ser la fuente del esquema, con una línea base generada desde `migrations/001..004`.

Límite: no se mantienen dos esquemas en paralelo. La migración es por módulo; una consulta
vieja puede quedarse en `pg` mientras su módulo no se migre, pero ninguna tabla nueva se
declara en dos lugares.

### 3.4 Ajv y Zod, cada uno en su capa

- **Ajv + JSON Schema 2020-12**: contratos de dominio publicables (`packages/domain`),
  validación en fronteras entre agentes y consumidores externos.
- **Zod**: cuerpos HTTP, formularios, variables de entorno y respuestas de integraciones.

Límite: no se genera JSON Schema desde Zod ni se duplican contratos. Si un contrato de
dominio cambia, cambia el JSON Schema y su prueba.

### 3.5 RSC y Server Actions, Query solo donde hace falta

La web lee en el servidor y muta con Server Actions validadas con Zod. TanStack Query
queda para datos vivos: cola del chat, estado de postulación y notificaciones.

Límite: nada de estado global de servidor duplicado en el cliente. Si un dato se puede
leer en el servidor, se lee ahí.

## 4. Integraciones

| Integración | Proveedor | Uso | Si falla | v1 |
|---|---|---|---|---|
| Correo | Resend (adaptador) | Avisos a candidato, empresa y orientador | Reintento desde el outbox; SMTP de respaldo | Sí |
| Credenciales | Accredible, Credly | Verificación real de certificados | Siguiente proveedor; mock solo en desarrollo | Sí |
| Credenciales (opcional) | Certo autohospedado | Verificación bajo control de la organización | Se omite si no está desplegado | Adaptador |
| Mapas | Google Maps | Distancia y geocodificación nacional | Error visible; no se inventa una distancia | Sí |
| LLM | OpenRouter (pago) | Conversación, extracción, redacción | Extractor heurístico y respuestas deterministas | Sí |
| Errores | Sentry | Excepciones y rendimiento | Logs estructurados | Sí |
| Trazas | OpenTelemetry + Langfuse | Web → runtime → worker y spans de agentes | Auditoría interna por `trace_id` | Sí |
| Oferta curada | Carga del operador (CSV/API) | Vacantes externas | Última carga válida, con frescura visible | Sí |
| Cursos | Portal de centros | Catálogo con cupos y vigencia | Se muestra la última versión y su fecha | Sí |
| OAuth | Google (Better Auth) | Inicio de sesión opcional | Enlace mágico | Sí |
| Almacenamiento de CV | **Pendiente de decidir** (recomendado: Cloudflare R2 o S3 con URLs firmadas) | Guardar PDF e imágenes con retención | Sin archivo persistido, el perfil queda con lo extraído | Decidir |

## 5. Entornos

| Entorno | Base | Servicios | Datos |
|---|---|---|---|
| Local | Neon (rama de desarrollo) o Postgres local | `bun run dev`, `bun run start`, worker | Sintéticos, `seed:demo` |
| CI | Postgres efímero o Neon de CI | Vitest y Playwright | Fixtures sintéticos |
| Piloto | Neon (rama de piloto) | PaaS: web, runtime, worker | Sintéticos o con consentimiento |
| Producción | Neon (rama de producción) | PaaS: web, runtime, worker | Reales, con retención declarada |

Reglas: `WORKBRIDGE_PERSISTENCE=memory` solo en local y pruebas. Un entorno con datos
reales exige HTTPS, rotación de secretos y la política de retención aprobada.

## 6. Plan de migración

Cada fase termina en verde y se puede revertir.

| Fase | Cambio | Criterio de salida |
|---|---|---|
| 0. Bun | `bun install`, `bun run`, `bun.lock`, Dockerfile y CI | `bun run gate:ci` en verde; imagen construye y arranca con Node |
| 1. Hono | Envolver el servicio actual y portar rutas del runtime | Pruebas de contrato del servidor equivalen a las actuales; `/health` responde |
| 2. Drizzle | Línea base desde `001..004`, migrar módulos de a uno | Esquema generado coincide con la base; pruebas de repositorio en verde |
| 3. Web | RSC + Server Actions donde hoy hay fetch manual | Flujos e2e de candidato, empresa y orientador en verde; sin regresión de accesibilidad |
| 4. PaaS | Contenedores de web, runtime y worker; retirar `vercel.json` | Despliegue de punta a punta reproducible; worker procesa la cola |
| 5. Integraciones | Resend, Sentry/OTel, Accredible/Credly | Un envío genera correo y traza; un error llega a Sentry; una credencial se verifica |

La migración no bloquea los siete bloqueantes de ADR-0014: la fase 0 y la 1 pueden correr
en paralelo con la persistencia de postulaciones.

## 7. Lo que no se adopta

| Opción | Por qué no |
|---|---|
| Bun como runtime de producción | Next.js y Mastra no garantizados; sin salida clara |
| `bun test` en lugar de Vitest | Se pierde cobertura v8, proyectos jsdom y la integración actual |
| NestJS | Sobra para tres servicios y choca con el estilo funcional |
| Prisma | Su motor y migraciones chocan con el SQL existente y el control fino |
| GraphQL | El contrato RPC de Hono cubre la web sin capa extra |
| Kubernetes | Complejidad operativa sin escala que la justifique |
| Estado global en cliente (Redux/Zustand) | RSC y Server Actions cubren el caso |
| Scraping de portales en v1 | Términos de uso, fragilidad y datos sucios |
| Multi-tenant con marca blanca | v1 tiene una organización ancla (ADR-0020) |
