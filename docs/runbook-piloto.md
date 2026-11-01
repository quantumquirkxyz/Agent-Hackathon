# Runbook de piloto — WorkBridge

Cómo se prepara y se opera una sesión de piloto con personas reales o sintéticas.
Complementa [despliegue](despliegue.md), [arquitectura](arquitectura.md) y el
[contexto del producto](../CONTEXT.md). No es un guion de demostración: es el
procedimiento operativo para acompañar a candidatos, orientadores y empresas.

> **Estado.** Este runbook se escribió contrastando rutas, etiquetas y campos con el
> código y las pruebas; no se ejecutó de punta a punta en un entorno limpio. La sección 6
> separa lo verificado leyendo código de lo que exige ensayo.

## 1. Objetivo de la sesión

Que una persona joven pase de "ayudo en la tienda de mi familia" a una postulación
aprobada por ella, con el orientador y la empresa decidiendo con la explicación a la
vista, y que cada decisión quede trazada.

Regla operativa: **los agentes proponen, el solver calcula, las personas deciden.** Si
algo no se puede mostrar con honestidad, se dice; no se simula una capacidad que no corre.

## 2. Preparación

### 2.1 Entorno

- [ ] Node.js 22 o superior; `npm ci` en la raíz.
- [ ] Rama y commit identificados; árbol limpio. Nunca commitear `.env`, `.env.local` ni
  `node_modules`.
- [ ] Dos archivos de entorno desde las plantillas (solo nombres; los valores los tiene el
  equipo, nunca en git ni en pantalla):

| Archivo | Plantilla | Variables relevantes |
|---|---|---|
| `.env` (raíz; lo leen `npm start` y `npm run seed:demo`) | `.env.example` | `PORT`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `OPENROUTER_API_KEY`, `GOOGLE_MAPS_API_KEY`, `LANGFUSE_*` |
| `apps/web/.env.local` (Next no lee el `.env` raíz) | `apps/web/.env.example` | `AGENT_RUNTIME_URL`, el mismo `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `OPENROUTER_*`, `GOOGLE_MAPS_API_KEY` |

- [ ] `PORT` del runtime y `AGENT_RUNTIME_URL` apuntan al mismo puerto (3000 por defecto);
  el web corre en 3001.
- [ ] Un solo `BETTER_AUTH_SECRET` en ambos archivos; si difiere, el runtime rechaza la
  sesión firmada.

### 2.2 Base de datos

El chat es asíncrono: el web encola y un worker procesa. En modo
`WORKBRIDGE_PERSISTENCE=memory` la cola vive en el proceso del web y el worker no la ve,
así que un piloto real necesita Postgres/Neon.

```bash
npm run db:migrate
npm run seed:demo
npm run seed:roles     # solo si se usa la lista corta
```

- `seed:demo` imprime la contraseña compartida y la lista `rol / correo / flujo`. No se
  copia a documentos ni se muestra en pantalla compartida.
- `seed:roles` crea orientador y empresa por entorno; esas cuentas no tienen contraseña
  (entran por enlace o hay que asignarles una). Para el piloto se usan las de `seed:demo`.
- **Los borradores y decisiones de postulación no están en Postgres**: viven en memoria
  del runtime. Reiniciar el runtime los borra (bloqueante 1 de ADR-0014).

### 2.3 Servicios

```bash
npm start             # terminal 1: runtime
npm run start:worker  # terminal 2: worker del chat (obligatorio)
npm run dev           # terminal 3: web
```

Comprobaciones: `GET http://localhost:3000/health` responde OK; `http://localhost:3001/`
muestra el inicio.

### 2.4 Cuentas de piloto

Todas salen de `npm run seed:demo`. Patrón `nombre.apellido@seed.workbridge.test`.
Inicio: `/ingresar`, correo, "Prefiero usar mi contraseña", contraseña compartida.

| Papel | Cuenta | Por qué |
|---|---|---|
| Intake en vivo | `luis.chen@...` (`j1_sin_cv`) | El chat ya tiene nombre y la respuesta "No tengo / prefiero contarte" |
| Cierre de preferencias | `maria.gonzalez@...` (`j1_perfil_sin_preferencias`) | Perfil de caja listo; faltan cinco respuestas con chips |
| Matching y postulación | `camila.ortega@...` (`j2_atencion_ciudad`) | Presencial, ciudad, USD 600: debe ver vacantes |
| Sin vacante y ruta | `ricardo.mendoza@...` (`j3_salario_alto`) | Mínimo USD 2500: exploración vacía y ruta de formación |
| Orientación | `irene.solis@...` | Entra a `/orientador` |
| Empresa | `rosa.mendez@...` (Banco Delta) | Entra a `/empresa` |

- [ ] Tres perfiles de navegador con sesión iniciada (candidato, orientador, empresa).
- [ ] Un invitado puede usar `/chat`, pero no preparar una postulación.
- [ ] Un PDF de CV de prueba (menos de 10 MB) si se va a mostrar la carga de CV.

### 2.5 Sin LLM (modo determinista)

Es un modo soportado: el chat usa su agenda de respaldo y el intake el extractor
heurístico. Cambia la forma de avanzar (chips en vez de texto libre) y la lectura de CV,
pero matching, ruta, borrador y compuertas **no dependen del LLM**.

Sin `GOOGLE_MAPS_API_KEY` la geocodificación usa el catálogo y la matriz local; para
cobertura nacional eso es un límite de v1, no un modo de producción (ADR-0014).

## 3. Recorrido esperado

1. **Intake** (`/chat`): la persona conversa; el agente de perfil convierte lo contado en
   habilidades con evidencia. En `/perfil` se ve "Lo que sabes hacer".
2. **Exploración** (`/vacantes`): tarjetas con modalidad, ubicación, salario, barra de
   preparación y "Te falta:". La hoja lateral muestra preparación, lo que ya tiene y lo
   que falta. "Casi listas para ti" explica qué bloquea.
3. **Ruta** (`/ruta`): si no hay vacante viable, se explica la causa y se arma la ruta con
   curso, proveedor, horas, costo y qué cubre.
4. **Borrador** (`/postulaciones/nueva`): CV, carta y evidencia, cada ítem con su etiqueta
   de verificación. La persona corrige y aprueba.
5. **Compuerta del orientador** (`/orientador`): aparece solo si el solver reporta brecha
   crítica, credencial sin verificar, alerta de sesgo o traslado inviable. El motivo es
   obligatorio (mínimo 10 caracteres) y queda auditado.
6. **Envío** (candidato): solo un borrador abierto con las aprobaciones exigidas; usa
   clave de idempotencia para no duplicar.
7. **Empresa** (`/empresa`): ve documentos y evidencia aprobada por la persona, y decide la
   entrevista con un motivo registrado.

## 4. Cierre y verificación

- [ ] `npm run gate:ci` en verde sobre el commit del piloto.
- [ ] Cada caso que se mostró tiene `trace_id` y evento en el registro de auditoría.
- [ ] Las notificaciones quedaron como filas `in_app` en el outbox.
- [ ] Los datos personales usados son sintéticos o cuentan con consentimiento; no se
  copian a documentos ni a capturas públicas.

## 5. Fallos y respuestas

| Falla | Señal | Qué hacer |
|---|---|---|
| El modelo tarda o falla | "Estoy pensando…" más de 5 s o "No pude continuar ahora…" | Reintentar una vez; si persiste, vaciar `OPENROUTER_API_KEY`, reiniciar worker y web, continuar con chips |
| La base o la red caen | "No pudimos cargar tus vacantes", `/chat` sin respuesta | Cambiar a una sesión con datos ya cargados y explicar el incidente; registrar la hora |
| El chat no avanza | "Tu respuesta está en cola…" indefinido | Verificar `npm run start:worker`; si no se resuelve, pausar el caso |
| No aparece la compuerta del orientador | Tras aprobar, el estado es "Lista para enviar" | Es correcto si no hay hallazgos críticos; no inventar una compuerta |
| La empresa no ve la postulación | "No hay postulaciones pendientes" | Verificar que la vacante sea conocida y tenga dueño; una vacante conocida sin dueño responde `503 ownership_unavailable`; una no catalogada es invisible |
| La lista corta devuelve 403 | Respuesta del endpoint de empresa | La organización de `seed:roles` no coincide con la de `seed:demo`; omitir la lista corta |

## 6. Estado de verificación

### 6.1 Verificado leyendo código y pruebas

Comandos `npm`, variables y plantillas, cuentas semilla, inicio y redirecciones por rol,
agenda del chat y chips, chat asíncrono con worker, modo sin LLM, etiquetas de
`/vacantes` y `/ruta`, borrador y aprobaciones, motivos del gate, colas de orientación y
empresa, lista corta y propiedad por organización, y Langfuse opcional.

### 6.2 Requiere ensayo

1. Recorrido completo con cronómetro y tiempo real por etapa.
2. Latencia por turno de chat, con y sin LLM.
3. Lectura de un CV en PDF y habilidades resultantes.
4. Qué vacante activa la compuerta del orientador y qué motivo muestra.
5. Que la lista corta responda 200 con la cuenta de empresa elegida.
6. Que haya al menos una traza visible en Langfuse.

### 6.3 Riesgos conocidos

- **Langfuse**: la ruta del flujo de agentes no está montada en el servidor de
  postulaciones ni en el web; las acciones de la interfaz probablemente no producen
  trazas. Lo que sí existe es el registro de auditoría por `traceId`.
- **Auditor de sesgo**: no corre en el flujo de la interfaz. Una alerta de sesgo en la
  compuerta solo aparece si el documento de la vacante trae alertas de equidad. No
  presentar el auditor como visible hasta cerrar el bloqueante 4 de ADR-0014.
- **Lista corta y organización**: la propiedad de vacante usa una sola organización de
  entorno; no se demuestra aislamiento entre varios propietarios.
- **Persistencia**: borradores y envíos se pierden al reiniciar el runtime.
- **Entrevista simulada**: existe como API, sin pantalla en el web.
