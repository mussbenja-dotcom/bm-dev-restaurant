# Rediseño: antes y después

Capturas de las mismas pantallas, con los mismos datos de prueba (mesa 5 con ronda en cocina y barra, mesa 7 abierta), en 360 px (celular), 768 px (tablet), 1440 px (escritorio) y 320 px (control de reflujo).

- Antes: `antes/<pantalla>-<ancho>.png`
- Después: `despues/<pantalla>-<ancho>.png`
- Regenerar: `npm run build` y luego `VISUAL_OUT=rediseno/despues npx playwright test -c playwright.alt.config.ts e2e/visual.spec.ts` (usa el puerto 4300 con su propia base).

En las dos corridas, ninguna pantalla tiene scroll horizontal a 320 px.

| Pantalla | Archivo | Qué cambió |
|---|---|---|
| Carta pública (bodegón) | `carta-*` | Se presenta como la web del restaurante: cabecera con logo, portada opcional, horarios, dirección y WhatsApp con íconos. La navegación de categorías queda fija y marca la sección visible. Estilo «Clásica»: títulos con serif editorial, precios alineados con guía punteada y el botón Agregar debajo de cada plato, de modo que el nombre tiene todo el ancho. |
| Carta pública (pizzería) | `carta-pizzeria-*` | Estilo «Moderna»: tarjetas en grilla con la foto como protagonista y el color de la marca en títulos y botones. Sin fotos se ve completa: las tarjetas no dejan huecos. |
| Salón | `salon-*` | Encabezado con un resumen («2 abiertas de 11»). Leyenda por estado (abiertas, piden cuenta, para limpiar, libres) con contadores, que además sirve de filtro. Tarjetas compactas: número grande y estado, y una mesa libre se distingue por el borde punteado. Los avisos de mesas van arriba con «Voy» y «Resuelto». |
| Comanda (mesa) | `comanda-*` | Encabezado con el mozo a cargo y la opción «Cambiar mozo» (para quien ve todas las mesas). Pestañas segmentadas en el celular. La barra de envío queda al alcance del pulgar, encima de la barra inferior. |
| Cocina y barra | `cocina-*`, `barra-*` | Fondo oscuro por defecto (no encandila y se lee a distancia); «Fondo claro» es opcional. Cantidad grande a la izquierda, nombre en negrita, opciones en color y nota en un recuadro de alto contraste. El tiempo de espera pasa a amarillo y luego a rojo («demorada»). |
| Caja | `caja-*` | Dos columnas en escritorio: detalle y división a la izquierda, cobro fijo a la derecha. Total, Pagado y Saldo van en celdas grandes (el saldo destacado) y el vuelto, en grande. En el celular el resumen queda primero y fijo arriba. |
| Panel del dueño | `dueno-*` | Va de lo urgente a lo general: «Qué necesita atención» con íconos y «Resolver», cifras del turno en una franja y los accesos agrupados por tarea («Personalizar mi restaurante» destacado, Operación, Equipo, Números). |
| Configuración | `config-*` | Pestañas con nombres de tarea: «Horarios y cobros», «Mesas y sectores», «Retiro y delivery». Los medios de cobro se marcan con casillas. La carta y la marca salen de acá y pasan a Personalizar. |
| Personalizar (nueva) | `personalizar-*`, `personalizar-carta-*` | Sin «antes» porque no existía. Marca (logo, portada, estilo, colores con control de contraste, contacto) y carta (categorías y platos: ordenar, ocultar, editar, fotos, variantes, extras y combos). En escritorio la vista previa del celular queda al costado; en celular y tablet es una pestaña. |
| Carrito (celular) | `carrito-360` | Barra del pedido con el color de la marca y el total. |

Sistema visual común del personal: paleta lino cálida, tipografía DM Sans, el color de la marca del local como acento (con contraste mínimo de 4,5:1, ajustado automáticamente) e íconos SVG propios en lugar de emojis. En escritorio hay una barra lateral («Servicio» y «Gestión»); en celular, una barra inferior con hasta 4 accesos y «Más».
