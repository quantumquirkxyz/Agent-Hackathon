# WorkBridge: definición de producto

Qué es WorkBridge, para quién existe, qué debe hacer y cómo se sabe que funciona. Este
documento es la referencia funcional; el vocabulario y los invariantes viven en
[`CONTEXT.md`](../CONTEXT.md), la arquitectura en [arquitectura.md](arquitectura.md) y las
decisiones técnicas en [stack.md](stack.md).

## 1. En una frase

**WorkBridge convierte la experiencia real de una persona joven —incluida la informal— en
un perfil con evidencia, una decisión explicable sobre una vacante concreta y una
postulación que ella aprueba, con un orientador humano decidiendo los casos sensibles.**

## 2. Problema

La transición al primer empleo falla por información, no solo por falta de vacantes:

| Lado | Qué no funciona | Qué hace WorkBridge |
|---|---|---|
| Persona joven | No sabe traducir su experiencia informal ni qué curso cierra su brecha | Perfil con evidencia, decisión explicable y ruta de formación acotada |
| Empresa | Recibe postulaciones que no encajan y publica requisitos vagos o discriminatorios | Normalización de la vacante, auditoría de equidad y preselección explicable |
| Centro de formación | Ofrece cursos que no llegan a quien los necesita | Catálogo con cupos y vigencia, consumido por la ruta de cada persona |
| Territorio | Una oferta puede ser inviable por traslado y costo | Restricción dura de traslado con datos reales |

## 3. Modelo operativo

**Organización ancla B2B2C** (ADR-0020). Una ONG, un centro de empleo o un programa
licencia WorkBridge y aporta los orientadores; las empresas publican gratis; las personas
jóvenes llegan por la organización, no por publicidad masiva.

- **Quién paga:** la organización ancla (licencia o convenio). No hay cobro a la persona
  joven ni a la empresa en v1.
- **Quién responde:** la organización ancla es responsable de la moderación, del
  cumplimiento de protección de datos y de la calidad de la orientación.
- **Qué mide la organización:** colocaciones, tiempo hasta la primera decisión, cierre de
  brechas y casos atendidos por orientación.

## 4. Usuarios y trabajos por hacer

| Rol | Trabajo principal | Superficie |
|---|---|---|
| Persona joven (candidata) | Entender qué sabe hacer, qué vacantes le sirven y postular con permiso | `/chat`, `/perfil`, `/vacantes`, `/ruta`, `/postulaciones`, `/entrevista` |
| Empresa | Publicar una vacante clara y decidir a quién entrevistar con evidencia | `/empresa` |
| Orientador | Resolver los casos que el sistema no debe decidir solo | `/orientador` |
| Operador | Sostener la oferta, las organizaciones y la operación diaria | `/operador` |
| Centro de formación | Publicar cursos, cupos, modalidad, costo y vigencia | `/centro` |

Regla de producto: **ningún rol puede hacer el trabajo de otro**. Un agente no envía, no
entrevista y no mensajea; una empresa no ve datos fuera de su organización; un orientador
no edita el perfil de la persona.

## 5. Capacidades de v1

Cada capacidad tiene criterio de aceptación. Un criterio sin prueba no está cumplido.

### 5.1 Persona joven

| Capacidad | Qué debe hacer | Criterio de aceptación |
|---|---|---|
| Intake conversacional | Conversar o subir CV (texto, PDF, imagen) y producir un perfil con evidencia | El perfil valida contra el JSON Schema; cada hecho tiene estado `declared`, `extracted`, `verified` o `rejected`; sin LLM el flujo avanza con el extractor heurístico |
| Experiencia informal | Reconocer negocio familiar, voluntariado, proyectos y trabajo no registrado | La evidencia informal aparece en el perfil sin presentarse como credencial verificada |
| Exploración | Ver vacantes con modalidad, zona, salario y frescura | Las preferencias explícitas se respetan; no se infieren del texto |
| Decisión de aptitud | Ver apta, apta con brechas o no apta por ahora, con motivos | El puntaje y las restricciones son deterministas; la explicación nombra brechas, traslado y restricciones |
| Ruta de formación | Recibir acciones ordenadas que cierran brechas | Cada paso trae curso, proveedor, horas, costo y qué brecha cubre; si falta oferta, se dice |
| Borrador adaptado | Revisar CV, carta y evidencia sin hechos inventados | Solo usa evidencia del perfil; la persona corrige y aprueba antes de enviar |
| Postulación | Enviar a una vacante publicada por empresa, una sola vez | Exige aprobaciones registradas; usa clave de idempotencia; queda en auditoría |
| Vacante curada | Explorar, decidir y preparar borrador | La postulación continúa por el enlace externo; no se registra un envío interno |
| Entrevista simulada | Practicar con rúbrica fija y una mejora por respuesta | Puntaje 0–100 reproducible, sin LLM, con pantalla propia |
| Notificaciones | Recibir correo en los hitos que le importan | Aprobación requerida, envío registrado, decisión de la empresa |

### 5.2 Empresa

| Capacidad | Qué debe hacer | Criterio de aceptación |
|---|---|---|
| Publicar vacante | Cargar texto, PDF o imagen y normalizarla | La vacante queda con requisitos, zona, modalidad, horario y salario estructurados |
| Auditoría de equidad | Bloquear requisitos discriminatorios | Una vacante con requisito prohibido no se rankea y se enruta a revisión humana |
| Preselección | Ver candidatos ordenados con explicación | Solo ve postulaciones de su organización; cada entrada trae puntaje y brechas |
| Decisión de entrevista | Aprobar o rechazar con motivo | El motivo es obligatorio y queda auditado; notifica a la persona |
| Lista corta | Consultar candidatos para una vacante | Vacante bloqueada devuelve lista vacía; nunca expone datos de otra organización |

### 5.3 Orientador

| Capacidad | Qué debe hacer | Criterio de aceptación |
|---|---|---|
| Cola de revisión | Ver casos priorizados con el motivo de la compuerta | La cola muestra brecha crítica, credencial sin verificar, alerta de sesgo o traslado inviable |
| Revisar evidencia | Ver lo que la persona aprobó y lo que el sistema verificó | No puede editar el perfil; puede aprobar o rechazar con motivo |
| Decisión | Aprobar o rechazar la postulación | Motivo mínimo de 10 caracteres; queda en auditoría con actor y hora |
| Estado claro | Saber qué está esperando y desde cuándo | Cada caso tiene estado y tiempo en cola |

### 5.4 Operador (nuevo en v1)

| Capacidad | Qué debe hacer | Criterio de aceptación |
|---|---|---|
| Organizaciones y empresas | Crear, suspender y asignar empresas a la organización | Una empresa suspendida no puede publicar ni ver postulaciones |
| Vacantes curadas | Cargar por CSV o API interna, con fuente y fecha | Cada vacante curada declara procedencia y frescura; sin dueño interno |
| Catálogo y cursos | Revisar frescura y retirar oferta vencida | Una vacante o curso vencido no aparece en exploración ni ruta |
| Outbox | Ver y reintentar notificaciones | Un correo fallido se puede reintentar con rastro de intentos |
| Casos e incidentes | Ver bloqueos, fallos de verificación y alertas | Cada incidente tiene `trace_id` y estado |
| Métricas mínimas | Ver embudo y colocaciones con consultas guardadas | Los números salen de la base, no de una hoja aparte |

### 5.5 Centro de formación (nuevo en v1)

| Capacidad | Qué debe hacer | Criterio de aceptación |
|---|---|---|
| Publicar curso | Nombre, proveedor, modalidad, horas, costo, cupos y vigencia | El curso valida contra el contrato y declara fuente y fecha |
| Actualizar cupos | Cambiar disponibilidad sin romper rutas existentes | La ruta muestra disponibilidad al momento de consultar |
| Retirar curso | Dejar de ofrecerlo | Las rutas nuevas no lo incluyen; las existentes muestran el cambio |

### 5.6 Sistema

| Capacidad | Criterio de aceptación |
|---|---|
| Determinismo | Aptitud, restricciones, puntaje, asignación, ruta y verificación se calculan en código |
| Humano en el circuito | Candidato, orientador y empresa deciden cada paso sensible |
| Evidencia con estado | Ninguna afirmación no verificada se presenta como verificada |
| Propiedad por organización | El dueño se resuelve en servidor, nunca desde el cuerpo de la petición |
| Equidad | El auditor contrafactual corre en la ruta real antes de afirmar equidad |
| PII | Se redacta antes de cualquier llamada al modelo; los fixtures son sintéticos |
| Trazabilidad | Cada decisión tiene `trace_id` y evento de auditoría |
| Idempotencia | Un envío repetido no duplica la postulación |
| Accesibilidad | Las superficies cumplen WCAG 2.1 AA en teclado, foco, contraste y etiquetas |

## 6. Flujos de punta a punta

### 6.1 Persona joven → postulación a empresa

1. Conversa o sube CV; el perfil queda con evidencia.
2. Explora vacantes y ve una decisión explicable.
3. Si no hay vacante viable, recibe una ruta de formación.
4. Prepara el borrador, lo corrige y lo aprueba (**H1**).
5. Si hay hallazgo crítico, el orientador decide (**H2**).
6. Envía; la empresa recibe correo y decide la entrevista (**H3**).

### 6.2 Empresa → entrevista

1. Publica la vacante (texto, PDF o imagen).
2. El sistema la normaliza y audita equidad.
3. Recibe postulaciones con evidencia aprobada por la persona.
4. Decide entrevista con motivo; la persona recibe correo.

### 6.3 Operador → oferta curada

1. Carga un CSV con fuente y fecha.
2. El sistema normaliza, detecta duplicados y audita equidad.
3. La vacante aparece en exploración como curada.
4. La persona prepara borrador y sigue el enlace externo.

### 6.4 Centro de formación → ruta

1. Publica curso con cupos y vigencia.
2. La ruta lo considera solo si cubre una brecha real.
3. Al vencer, deja de aparecer en rutas nuevas.

## 7. Métricas de éxito de v1

| Métrica | Definición | Objetivo inicial |
|---|---|---|
| Tiempo hasta la primera decisión | De inicio de intake a primera decisión de aptitud | < 10 minutos |
| Perfiles con evidencia | Perfiles con al menos una habilidad y una experiencia | > 80 % |
| Postulaciones aprobadas | Borradores aprobados por la persona sobre iniciados | > 60 % |
| Tasa de entrevista | Postulaciones enviadas que pasan a entrevista | Línea base, sin objetivo inventado |
| Cierre de brechas | Brechas cubiertas por una ruta completada | Línea base |
| Bloqueos por equidad | Vacantes bloqueadas sobre auditadas | Se reporta, no se optimiza |
| SLA de orientación | Tiempo en cola hasta decisión | < 48 h |

Las métricas se calculan desde Postgres. No se inventan cifras de impacto externo.

## 8. Fuera de alcance de v1

- Marketplace general: pagos, contratos, planillas, verificación de antecedentes.
- Entrevistas por voz o video.
- SMS y WhatsApp.
- Scraping de portales; la oferta curada entra por carga del operador.
- Multi-tenant con marca blanca e internacionalización.
- Agentes que envíen, avancen entrevistas o mensajeen.
- Analítica como producto: en v1 se responde con SQL y consultas guardadas (ADR-0017).

## 9. Dependencias y riesgos

- Los siete bloqueantes de [ADR-0014](../.agents/adr/0014-production-readiness-blockers.md)
  siguen vigentes y condicionan la puesta en producción.
- La verificación real depende de Accredible y Credly; Certo es opcional.
- La cobertura nacional depende de Google Maps y del catálogo ampliado.
- La adopción depende de que la organización ancla aporte orientadores y empresas.
- La privacidad depende de una política de retención conforme a la ley panameña.
