---
target: carta pública y pantallas del equipo
total_score: 23
max_score: 36
na_heuristics: 10
p0_count: 1
p1_count: 4
target_identity: "file:C:\\Users\\benja\\Desktop\\BM-Restaurant\\web\\src\\pages\\PublicMenu.tsx"
target_fingerprint: "sha256:40793719338d29186d2bd130d9a65a41f27e37bf02f193eab2ec240652803c54"
target_path: "C:\\Users\\benja\\Desktop\\BM-Restaurant\\web\\src\\pages\\PublicMenu.tsx"
timestamp: 2026-11-22T14-29-20Z
slug: web-src-pages-publicmenu-tsx
---
# Crítica inicial · carta pública y pantallas del equipo (22/11/2026)

Evaluación A (revisión de diseño) y B (detector + navegador) en subagentes aislados.

## Especificidad
Personal: propio (lino/verde, estados con texto, cocina oscura). Carta: todavía "de sistema": cabecera de 5 líneas de datos sueltos, todos los platos con el mismo peso y «Agregar» en su propia fila; la Moderna parece catálogo genérico.

## Heurísticas (0–4)
1 Estado 3 · 2 Mundo real 3 · 3 Control 2 · 4 Consistencia 2 · 5 Prevención 3 · 6 Reconocer 3 · 7 Flexibilidad 3 · 8 Estética 2 · 9 Errores 2 · 10 Ayuda n/a → 23/36.

## Prioridades
- [P0] Botón de `.cartbar` a 1,79:1: `.menu button:not(.primary):not(.add):not(.m-cat)` (0,4,1) pisa `.cartbar button` (0,1,1). Confirmado por A (lectura) y B (medición).
- [P1] Carrito no editable (sin cantidades ni «Cambiar»); total repetido; retiro/delivery sin estado visible; botón deshabilitado sin decir qué falta.
- [P1] «Agregar» igual para platos simples y con opciones → «Elegir opciones».
- [P1] Lista larga: acción en fila propia (15 platos ≈ 2.700 px a 360). Nombre, precio y acción juntos.
- [P1] Cabecera sin marca y con datos sueltos; en mesa falta el sector («Mesa 4 · Salón»).
- [P2] Ninguna categoría activa al cargar; chips de la Moderna a 38 px; táctiles chicos (WhatsApp 20 px, Reservar 18 px, buscador 41 px).
- [P2] Grilla de escritorio con huecos en categorías de 1–2 platos.
- [P2] Caja en celular: vuelto aparece tarde, medios de pago desparejos, botón de cobro en dos líneas.
- [P2] `--faint` (#8a8478) a 3,7:1 en placeholder y texto secundario de salón/cocina.
- [P3] Glifos ✕ y ★ en lugar de íconos; fecha ISO en el panel; «Quedan 1».

## Detector
CLI: 0 hallazgos (no escanea CSS). Overlay: cream-palette (elección de marca, falso positivo), contraste de `--faint`, un straggler. Barra del carrito no tapa el último plato (162 px libres); el salto a categoría no tapa el título (0 px).
