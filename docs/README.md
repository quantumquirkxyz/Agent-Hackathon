# Documentación — WorkBridge

WorkBridge es un producto en despliegue: un sistema multiagente de empleabilidad juvenil
para Panamá. Esta carpeta documenta el sistema vivo, no una entrega cerrada.

## Documentos

| Documento | Responde |
|---|---|
| [`../README.md`](../README.md) | Qué es WorkBridge, qué hace, cómo ejecutarlo y cuál es su estado |
| [`../CONTEXT.md`](../CONTEXT.md) | Propósito, usuarios, alcance de v1, vocabulario, invariantes y stack |
| [`arquitectura.md`](arquitectura.md) | Agentes, herramientas, flujos y puntos de intervención humana |
| [`despliegue.md`](despliegue.md) | Entornos, migraciones, variables, salud, observabilidad y seguridad |
| [`producto.md`](producto.md) | Qué es, para quién, capacidades y criterios de aceptación |
| [`stack.md`](stack.md) | Stack objetivo, integraciones y plan de migración |
| [`runbook-piloto.md`](runbook-piloto.md) | Preparar y operar una sesión de piloto, con riesgos conocidos |
| [`reference/agents/`](reference/agents/) | Reglas para agentes: tracker, etiquetas de triaje y dominio |
| [`reference/assumed-contracts.md`](reference/assumed-contracts.md) | Contratos asumidos entre dominio y consumidores; lo verifica `assumed-contracts.test.ts` |
| [`../.agents/adr/`](../.agents/adr/README.md) | Decisiones durables, incluida la de que esto es un producto (ADR-0011) |

## Lectura recomendada (10 minutos)

1. [`../CONTEXT.md`](../CONTEXT.md): qué es el producto y qué no es.
2. [`../README.md`](../README.md): cómo se ejecuta y qué falta para desplegarlo.
3. [`arquitectura.md`](arquitectura.md): dónde decide el código, dónde el modelo y dónde
   una persona.

## Historia

La entrega original de hackathon (metodología, evals, bitácora de IA, guion de demo y el
árbol `old/`) se eliminó del árbol actual. Sigue disponible en el historial de git y en el
tag anotado `final-24h`. No se cita como documentación vigente.
