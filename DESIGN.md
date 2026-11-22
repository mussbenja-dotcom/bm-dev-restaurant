# Sistema de diseño

La fuente de verdad es `web/src/styles.css`: los tokens están en `:root` y la variante oscura en `[data-contrast='high']`. Este documento resume lo que ya está implementado.

## Personal (modo Operar) — «libreta de bodegón»
- **Tipografía:** DM Sans para todo lo operativo; Instrument Serif (`--serif`) solo en h1 y títulos de sección. Escala `--t-xs`…`--t-3xl`; cifras con `tabular-nums` (`.num`). En celular el h1 baja a 1,95rem.
- **Color:** base cálida (`--bg #f3eee4`, `--surface #fbf8f2`), tinta `#1b1a17`, filetes `--line`/`--line-2`. Acción principal en verde profundo `--brand #1d4a36`. El color del local va solo al cuadro de la marca (`--local`/`--local-ink`); la carta pública lleva la marca completa.
- **Estados:** `--ok #24683a`, `--warn #8a4b00`, `--bad #a3261c`, solo para avisos, demoras y acciones completadas, siempre con texto. Mesa abierta = tarjeta invertida en tinta; pide cuenta = ámbar 2px; para limpiar = borde punteado.
- **Composición:** filetes de 1px (`.rule-title`, `.ledger`) en lugar de tarjetas de relleno; sin bordes laterales gruesos, sin tarjetas anidadas, sin rótulos sobre títulos. Radios 4/6/8. Vacíos con `.empty` (una sola línea).
- **Navegación:** escritorio (≥1024 px) barra lateral `.side`; celular y tablet `.tabbar` inferior con «Más».
- **Controles:** `.tabs` (pestañas subrayadas para secciones de página), `.seg` (opciones excluyentes), `.chip`, `.icon-btn` de 44 px, `.primary` una por pantalla, `.save-bar` (guardar fijo abajo en formularios largos), `fieldset.group` (opciones relacionadas).
- **Íconos:** `web/src/icons.tsx`, SVG de trazo 1,75. Sin emojis.
- **Cocina y pase:** pizarra oscura por defecto (`[data-contrast='high']`, con «Fondo claro» disponible). Carriles por estación; cada comanda destaca mesa o número, minutos (`.timer` con texto «Casi demorada»/«Demorada»), cantidades y aclaraciones. El pase agrupa por mesa o pedido: «n de m listos», «Para llevar» y «Falta».
- **Caja:** cuentas (lista compacta + detalle) con Total, Pagado, Saldo y Vuelto siempre visibles; arqueo con Esperado, Contado y Diferencia juntos (`.arqueo`, `.diff`).
- **Movimiento:** `--ease-out`, `--ease-drawer`; `--mv` vale 0 con `prefers-reduced-motion`. Solo para abrir paneles, confirmar y marcar una comanda nueva (`ticket-new`); las acciones repetidas de cocina y caja son inmediatas.

## Carta pública (modo Persuadir)
- `shared/color.ts → brandVars(color, paper)` genera `--menu-bg`, `--menu-ink`, `--accent`, `--brand`, `--brand-ink` y `--menu-soft`.
- **Fondos:** marfil, blanco y oscuro.
- **Estilos** (`data-style` en `.menu`):
  - **clasica:** títulos con Instrument Serif, lista con guía punteada hasta el precio y miniatura a la derecha si hay foto.
  - **moderna:** sans 800 con tarjetas en grilla; la foto arriba, si existe.
- La navegación de categorías queda fija y la categoría activa se marca con `aria-current`.
- La barra del pedido (`.cartbar`) usa el color de la marca.
- **Reservas públicas** (`/reservar/:slug`, `.rsv-page` dentro de `.menu`): misma piel que la carta, columna de 640 px. Orden: personas y día (`.rp-days`, fecha «Sáb 28/11») → horarios como botones (`.rp-time`; completo con lista de espera = borde punteado y texto) → datos, con el resumen pegado al botón final (fijo abajo en celular). Resultado `.rp-done`: confirmada con borde de marca, lista de espera con borde punteado.

## Personalizar
- Diseño `.pz`: formulario a la izquierda y `.phone` (iframe de `/vista-previa`) fijo a la derecha en pantallas de 1180 px o más. En pantallas menores, la vista previa es una pestaña.
- `.pz-status` muestra el estado de publicación (`.dirty` cuando hay cambios sin publicar).
- Listado de la carta: `.cat-block` y `.item-row`; los platos ocultos usan `.hidden-item`.
