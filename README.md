# BM Dev Restaurant

> **Sistema implementado.** Arranque rápido: `npm install && npm run build && npm start`. Con datos ficticios: `npm run test:reset && npm run start:test`, en http://localhost:4100 con la clave `prueba1234`.
> Instalación, copias y traslado: [docs/INSTALACION.md](docs/INSTALACION.md) · Pruebas ejecutadas: [docs/PRUEBAS.md](docs/PRUEBAS.md) · Decisiones: [docs/DECISIONES.md](docs/DECISIONES.md) · Diseño antes y después: [docs/visual/COMPARACION.md](docs/visual/COMPARACION.md) · Retomar: [docs/RETOMAR.md](docs/RETOMAR.md)

Paquete de trabajo para crear desde cero un sistema gastronómico para restaurantes, listo para ejecutar localmente. Incluye el encargo para Claude, el alcance del producto, la dirección visual y las pruebas que debe superar la aplicación.

## Cómo usarlo con Claude

1. Descomprimí el ZIP en una carpeta nueva del proyecto. En Claude Code, abrí esa carpeta. En una conversación con carga de archivos, adjuntá los Markdown que descomprimiste.
2. Pegá el contenido de [PROMPT-MAESTRO-CLAUDE.md](PROMPT-MAESTRO-CLAUDE.md). Si tu herramienta solamente admite un archivo, el prompt incluye el alcance y las instrucciones para reconstruir la estructura.
3. Pedile que implemente el circuito de la mesa 4, lo pruebe en dos navegadores y haga la revisión visual. El prompt le indica que continúe de forma autónoma hasta completar las funciones del alcance.

## Índice

| Especificación | Para qué abrirla |
|---|---|
| [01 · Concepto del producto](especificaciones/01-CONCEPTO-DEL-PRODUCTO.md) | Entender quién lo usa, qué problema resuelve y cómo medirlo. |
| [02 · Requisitos funcionales](especificaciones/02-REQUISITOS-FUNCIONALES.md) | Ver qué hace cada persona y en qué entrega. |
| [03 · Requisitos no funcionales](especificaciones/03-REQUISITOS-NO-FUNCIONALES.md) | Acordar presupuesto, velocidad, accesibilidad y continuidad. |
| [04 · Módulos y funcionalidades](especificaciones/04-MODULOS-Y-FUNCIONALIDADES.md) | Seguir el recorrido desde el QR hasta el arqueo. |
| [05 · Reglas de negocio](especificaciones/05-REGLAS-DE-NEGOCIO.md) | Resolver los casos de salón, porciones y dinero. |
| [06 · Arquitectura recomendada](especificaciones/06-ARQUITECTURA-RECOMENDADA.md) | Elegir herramientas que permitan el piloto de ARS 0. |
| [07 · Base de datos](especificaciones/07-BASE-DE-DATOS.md) | Diseñar relaciones y operaciones consistentes. |
| [08 · Diseño UI/UX](especificaciones/08-DISENO-UI-UX.md) | Dirigir el diseño de cada rol y aprobar las capturas. |
| [09 · Mejoras e innovaciones](especificaciones/09-MEJORAS-E-INNOVACIONES.md) | Elegir ideas según su valor para cada rubro. |
| [10 · Plan de desarrollo](especificaciones/10-PLAN-DE-DESARROLLO.md) | Ordenar las entregas, demostrar y validar con los dos locales. |
| [11 · Criterios de aceptación](especificaciones/11-CRITERIOS-DE-ACEPTACION.md) | Comprobar resultados con casos y números concretos. |

## Qué debe poder hacer el primer restaurante

El dueño da de alta su restaurante, carga su carta y crea los usuarios del equipo. Durante un turno, el mozo toma una ronda desde la mesa 4. El pedido aparece en cocina y barra. Caja registra dos medios de cobro y el dueño consulta el cierre. Después, dos mozos intentan vender la última porción. El sistema confirma una sola y explica al otro qué pasó. Esta prueba también sirve para capacitar a un empleado nuevo.

Caja puede imprimir la precuenta y el ticket interno X o guardarlos como PDF. El comercio emite sus facturas por su circuito habitual.

El sistema se ejecuta localmente con herramientas gratuitas y los equipos disponibles. Rubén elegirá el hosting y el dominio más adelante. Las integraciones con costo están en [FUTURAS-MEJORAS-PAGAS.md](FUTURAS-MEJORAS-PAGAS.md).
