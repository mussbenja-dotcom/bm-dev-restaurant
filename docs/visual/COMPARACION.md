# Segunda pasada de diseño: antes y después

Las capturas se generaron con `VISUAL_OUT=antes|despues npx playwright test e2e/visual.spec.ts` sobre la base de prueba, con dos mesas abiertas y comandas en cocina. Cada pantalla tiene capturas en 360, 768 y 1440 px, más un reflow en 320 px.

| Pantalla | Problema encontrado (antes) | Corrección (después) | Capturas |
|---|---|---|---|
| Carta 360 px | Las categorías se aplastaban y se superponían («EntradasPrincipalesPostresBebida»). Cada chip se encogía dentro de la barra. | Los chips no se encogen y la barra se desplaza horizontalmente. El buscador es más angosto. | `carta-360.png` |
| Carta | Cada plato tenía un botón verde sólido. Doce botones iguales competían con el nombre y el precio. | «Agregar» pasa a botón con borde del color de la marca y se rellena al pasar el cursor. Precio y nombre recuperan protagonismo. Contraste: 8,6:1 en el bodegón y 6,7:1 en la pizzería. | `carta-*.png`, `carta-pizzeria-*.png` |
| Salón | Las mesas libres y las abiertas tenían el mismo peso visual: había que leer cada etiqueta. El contenido de la tarjeta quedaba corrido al centro. | Las mesas libres tienen borde punteado y número atenuado. Las abiertas tienen fondo de color. El contenido queda alineado a la izquierda. | `salon-*.png` |
| Caja | Los importes no se alineaban a la derecha. Mostraba «Vuelto: $ 0,00» antes de cargar el efectivo recibido. | Los importes de todos los totales se alinean a la derecha. El vuelto aparece solo cuando se ingresa el efectivo. | `caja-*.png` |
| Todas (táctil) | Los chips de filtros medían 36 px. | En pantallas táctiles miden 44 px; en escritorio siguen compactos. | — |

Reflow en 320 px: **0 px de desplazamiento horizontal** en carta, carta de pizzería, salón, comanda, cocina, caja y panel del dueño, antes y después.

Contraste de los colores nuevos: texto atenuado sobre fondo 6,4:1, azul de mesa abierta 6,9:1 y texto sobre fondo de mesa abierta 14,7:1. Todos superan 4,5:1.

Cocina: la nota del plato (ej. «UNA SIN SAL») pasó de una barra gruesa lateral a un borde fino completo; conserva el fondo amarillo, las mayúsculas y el contraste. El resto ya cumplía lectura a distancia y botones de 44 px.

Las capturas «antes» se tomaron de una compilación con el diseño original (mismo CSS, hash `index-CVE1Vd13.css`) y las «después» de la versión final, ambas en un servidor aparte con datos ficticios.
