# WorkBridge

Sistema multiagente de empleabilidad juvenil para Panamá. Evalúa la preparación de una
persona para una vacante concreta, reconoce experiencia formal e informal, verifica
credenciales, identifica brechas, propone una ruta de formación acotada y prepara una
postulación que **una persona aprueba antes de enviarse**.

> Los agentes proponen, el solver calcula, las personas deciden.

## Problema

La transición de los estudios al primer empleo es difícil para los jóvenes panameños, y
el problema es de información en tres lados. Los jóvenes no saben traducir su
experiencia informal (ayudar en el negocio familiar, un voluntariado) al lenguaje de una
empresa ni qué curso cierra su brecha. Las empresas reciben postulaciones que no encajan
y publican ofertas con requisitos vagos o discriminatorios. Los centros de formación
ofrecen cursos que no siempre llegan a quien más los necesita. A esto se suma la
geografía: una oferta en Tocumen puede ser inviable para alguien de La Chorrera por
traslado y costo de transporte.

## Qué hace

1. **Intake conversacional**: la persona cuenta lo que sabe hacer (o sube un CV en PDF o
   foto) y el sistema arma un perfil con evidencia, incluida la experiencia informal.
2. **Matching explicable**: un solver determinista decide *apta*, *apta con brechas* o
   *no apta por ahora* para cada vacante, con las brechas, el traslado y las
   restricciones duras.
3. **Ruta de formación**: convierte las brechas en un plan ordenado de cursos.
4. **Postulación asistida**: genera el borrador (CV, carta y evidencia) que la persona
   revisa, corrige y aprueba.
5. **Aprobaciones humanas**: orientador y empresa deciden con la explicación a la vista.

## Alcance

La v1 cubre **todo Panamá** y una taxonomía ocupacional más amplia que el foco inicial
de soporte técnico, atención al cliente y administración. El catálogo de vacantes se
llena por dos vías (ADR-0013):

| Origen | Ciclo |
|---|---|
| **Vacante publicada por empresa** (texto, PDF o imagen) | Ciclo completo dentro de WorkBridge: borrador, aprobaciones, envío y decisión de entrevista |
| **Vacante curada** (cargada por el operador desde un portal externo) | Exploración, decisión de aptitud y borrador; la postulación continúa por el enlace original |

Fuera de alcance en v1: mercado laboral general (pagos, contratos, planillas),
entrevistas por voz, notificaciones por SMS o WhatsApp, y cualquier agente que envíe
postulaciones o mensajes. Detalle en [`CONTEXT.md`](CONTEXT.md) y
[`docs/producto.md`](docs/producto.md).

### Módulos de v1

| Módulo | Para quién | Qué resuelve |
|---|---|---|
| Candidato | Persona joven | Perfil con evidencia, exploración, decisión explicable, ruta, borrador, envío y entrevista simulada |
| Empresa | Empresa | Publicar vacante, preselección explicable y decisión de entrevista |
| Orientador | Organización ancla | Cola de casos sensibles con evidencia y motivo auditado |
| Operador | Organización ancla | Organizaciones, vacantes curadas, catálogo, outbox, incidentes y métricas mínimas |
| Centro de formación | Centro | Cursos con cupos, modalidad, costo y vigencia |

La analítica como pantalla llega en v1.1; en v1 se responde con SQL y consultas guardadas
(ADR-0017).

## Arquitectura de agentes

Cinco agentes con roles distintos, coordinados por un grafo de Mastra, más un coach de
entrevista simulada fuera del grafo. El diagrama, las herramientas y los puntos de
aprobación humana están en **[docs/arquitectura.md](docs/arquitectura.md)**.

| Agente | Rol |
|---|---|
| Exploration | Valida preferencias y explora el catálogo de vacantes |
| Profile and Evidence | Convierte CV y experiencia en un perfil con evidencia |
| Market and Matching | Normaliza la vacante y decide aptitud (HiGHS, restricciones duras) |
| Bias Auditor | Repite el matching cambiando nombre, género o corregimiento y bloquea ofertas discriminatorias |
| Training | Convierte brechas en una ruta de formación |

- **Herramientas que actúan**: escritura en base de datos, solver de asignación,
  verificación de credenciales y registro de notificaciones salientes en un outbox SQL.
- **Componente determinista**: matching, restricciones, puntaje, rutas y verificaciones
  son código; el modelo de lenguaje no decide restricciones duras.
- **Humano en el ciclo**: la persona candidata aprueba su postulación, el orientador
  revisa los casos con brechas críticas, credenciales sin verificar, alertas de sesgo o
  traslado inviable, y la empresa decide el avance a entrevista. Ningún agente envía
  postulaciones.
- **Trazabilidad**: envelopes por decisión, ingesta a Langfuse y un registro de
  auditoría append-only.

## Tecnologías

El stack objetivo está en **[docs/stack.md](docs/stack.md)**; varias piezas están
decididas y su migración pendiente, no implementadas.

TypeScript estricto sobre Node.js ≥ 22, Bun como gestor de paquetes y runner de scripts,
Next.js 16 y React 19, Hono para la API del runtime, Mastra para el grafo de agentes,
PostgreSQL con Neon y Drizzle ORM, Better Auth, JSON Schema 2020-12 con Ajv y Zod en los
bordes, HiGHS (solver MILP), Google Maps, OpenRouter, Resend, Sentry + OpenTelemetry +
Langfuse, Tesseract y unpdf (OCR y PDF), Vitest y Playwright. El despliegue son
contenedores de web, runtime y worker en un PaaS. Certo es un verificador de credenciales
opcional que se despliega por separado; Accredible y Credly son los proveedores
principales.

## Fuentes de datos

- **Vacantes**: publicación directa de empresas y catálogo curado cargado por el operador
  (CSV o API interna), con fuente y frescura (`packages/catalog`).
- **Formación**: cursos publicados por los centros de formación; el catálogo del
  repositorio es la semilla de desarrollo (`packages/training`).
- **Traslados**: Google Maps en producción; en desarrollo, datos deterministas.
- **Credenciales**: Accredible y Credly como proveedores principales; Certo como adaptador
  opcional.

## Instalación y ejecución

Requiere Node.js ≥ 22. Es un monorepo de workspaces. **El objetivo es Bun** (ADR-0016);
hasta completar esa migración, los comandos siguientes usan npm.

```bash
npm ci
cp .env.example .env                           # servicio de postulación y semillas
cp apps/web/.env.example apps/web/.env.local   # aplicación web
npm run db:migrate                             # esquema en Postgres (requiere el CLI de Neon)
npm run seed:roles                             # cuentas de orientador y empresa
npm run seed:demo                              # datos sintéticos de piloto
npm run dev                                    # web en http://localhost:3001
npm start                                      # servicio de postulación (agent-runtime)
npm run start:worker                           # worker del chat asíncrono
```

Sin `OPENROUTER_API_KEY` el sistema usa el extractor heurístico y los *fallbacks*
deterministas: sigue produciendo perfiles y decisiones válidos. Sin `DATABASE_URL` no hay
sesiones, chat ni persistencia. Variables, migraciones, contenedores y salud del
servicio: **[docs/despliegue.md](docs/despliegue.md)**.

### Cuentas sintéticas de piloto

No hay claves reales en el repositorio: copia siempre los `.env.example`. `npm run
seed:demo` crea las cuentas a partir de `scripts/seed/demo-data.ts`; son datos
sintéticos, no credenciales de ningún servicio real. La contraseña compartida está en
`DEMO_PASSWORD` y la imprime el propio seed.

Empresas con vacante publicada en el catálogo (`packages/catalog/fixtures/vacancy-catalog.json`):

| Usuario | Empresa |
|---|---|
| rosa.mendez@seed.workbridge.test | Banco Delta |
| carlos.vidal@seed.workbridge.test | Supermercado Central |
| laura.quiel@seed.workbridge.test | Consultora Istmo |
| helena.ponce@seed.workbridge.test | Farmacias Del Istmo |
| andres.cedeno@seed.workbridge.test | Grupo Mar |
| miriam.batista@seed.workbridge.test | Ferretería El Tornillo |

Estudiantes con perfil completo y una vacante del catálogo con la que coinciden:

| Usuario | Vacante |
|---|---|
| camila.ortega@seed.workbridge.test | Atención al cliente en la ciudad |
| diego.sanchez@seed.workbridge.test | Caja de fin de semana |
| valeria.perez@seed.workbridge.test | Asistencia administrativa remota |
| kevin.batista@seed.workbridge.test | Ventas en Arraiján |
| sofia.herrera@seed.workbridge.test | Pasantía de ventas |
| elena.castillo@seed.workbridge.test | Atención al cliente, con búsquedas guardadas |

## Pruebas

```bash
npm test               # Vitest: unitarias y de componentes
npm run typecheck
npm run gate:ci        # lint + typecheck + cobertura (compuerta bloqueante)
npm run test:e2e       # Playwright
```

El proyecto `runtime` usa un fixture en memoria para sus pruebas de ciclo de vida; el
proyecto `ownership` usa el runtime confiable y exige perfil y preferencias persistidos.
La regresión de propiedad entre interfaz y empresa necesita `DATABASE_URL`, los estados
sembrados y las variables `E2E_CANDIDATE_STORAGE_STATE`, `E2E_EMPLOYER_STORAGE_STATE`,
`E2E_FOREIGN_EMPLOYER_STORAGE_STATE`, `E2E_CATALOG_VACANCY_ID` y
`E2E_OTHER_ORG_SUBMISSION_ID` después de `npm run seed:demo`.

## Estado y límites conocidos

WorkBridge es un producto en despliegue, no un entregable cerrado. Los bloqueantes de v1
están registrados en [ADR-0014](.agents/adr/0014-production-readiness-blockers.md), en
este orden:

1. Persistir borradores, envíos y estado de entrevista (hoy viven en memoria del proceso).
2. Traslado nacional con datos reales; el respaldo local ya no alcanza para todo Panamá.
3. Verificación de credenciales real en producción; el mock queda para desarrollo.
4. Llevar el auditor de sesgo a la ruta que realmente usa la web.
5. Notificaciones por correo desde el outbox.
6. Modelos de pago con presupuesto; nada de modelos `:free` en producción.
7. Política de privacidad, retención y borrado de datos.

Otros límites vigentes:

- La web no pasa por el grafo de cinco agentes (`WorkflowRuntime`): llama a los agentes
  de perfil y exploración, al servicio de matching y a la ruta de formación por separado.
  Hasta cerrar el bloqueante 4, la equidad solo está garantizada donde el auditor corre.
- Las notificaciones son filas `in_app` en el outbox; el correo es trabajo de v1.
- Certo es un servicio aparte (AGPL-3.0, no incluido en este árbol); sin él la
  verificación cae en Accredible, Credly o el mock.
- Los guardrails se basan en patrones; no sustituyen a un clasificador entrenado.

## Documentación

| Documento | Contenido |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | Propósito, alcance, vocabulario, invariantes y stack |
| [`docs/producto.md`](docs/producto.md) | Usuarios, capacidades, flujos, criterios de aceptación y métricas |
| [`docs/stack.md`](docs/stack.md) | Stack objetivo, integraciones, plan de migración y opciones descartadas |
| [`docs/arquitectura.md`](docs/arquitectura.md) | Diagrama de agentes, herramientas, flujos y compuertas humanas |
| [`docs/despliegue.md`](docs/despliegue.md) | Entornos, migraciones, variables, observabilidad y seguridad |
| [`docs/runbook-piloto.md`](docs/runbook-piloto.md) | Operación del piloto: preparación, cuentas, riesgos |
| [`.agents/adr/`](.agents/adr/README.md) | Decisiones durables |

## Licencia

MIT. Ver [LICENSE](LICENSE).
