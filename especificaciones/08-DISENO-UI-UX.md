# Diseño UI/UX y dirección visual

La mejora visual es obligatoria en cada superficie principal. El criterio es lo que una persona consigue ver y hacer durante un turno. La carta puede dar ganas de comer. El mozo necesita trabajar con una mano. Cocina debe leer “sin cebolla” junto a la cantidad. Caja debe poder encontrar el saldo apenas mira.

## Dirección por superficie

| Superficie | Composición y estilo | Qué tiene que distinguirse primero |
|---|---|---|
| Carta del bodegón | Fondo marfil, texto oscuro, acento verde botella, encabezados editoriales y fotos de plato con recorte consistente. Categorías accesibles aun al desplazarse. | Categoría, plato, precio y disponibilidad. La foto opcional nunca desplaza el precio fuera de contexto. |
| Carta de la pizzería | Acento rojo horno, nombres expresivos, selector de sabores y resumen de las dos mitades. | Tamaño, gustos y precio total antes de sumar al carrito. |
| Salón y mozo | Lista o plano por sector. Acción de cargar ronda cerca del pulgar, buscador accesible y favoritos. | Mesa, estado, consumos pendientes y confirmación del último envío. |
| Cocina, barra y pase | Fondo neutro, número de mesa prominente, cantidad grande y modificadores inmediatamente debajo del plato. Probar versión de alto contraste. | Qué preparar, cuántos, qué cambió y cuánto lleva esperando. |
| Caja | Totales alineados, números de ancho estable, saldo y acción de cobrar visibles. En móvil, el teclado conserva una forma de consultar el importe. | Total, ya pagado, saldo, medio y vuelto. |
| Dueño | Hasta tres asuntos que requieren acción. Totales con período y acceso al detalle, gráfico solo al responder una pregunta. | Qué pasó durante el turno y qué merece atención ahora. |

## Sistema visual implementable

- Elegir una fuente legible para operación, como DM Sans o Inter, y una editorial para la carta, como Instrument Serif. Servir fuentes locales con su licencia o usar fuentes de sistema. El precio y la aclaración se leen aun sin descargar tipografías.
- Definir variables de color, tipografía, espaciado, radios, superficies y estados. Proponer una escala de 4, 8, 12, 16, 24 y 32 px. Dar aire a la carta y mayor densidad controlada a las pantallas operativas.
- En imágenes de carta, prever distintos encuadres, texto alternativo y carga diferida. Un plato sin foto conserva un diseño completo. Usar fotos propias o autorizadas y formatos livianos.
- Acompañar cada color de estado con texto o icono comprensible. Tocar, usar teclado y ampliar el texto deben permitir completar la misma tarea. Poner los errores junto al campo o la acción que se pueda corregir.
- Reservar el scrollytelling para la página comercial. Un ejemplo muestra el pedido en el celular, su aparición en cocina y el cierre. Respetar el desplazamiento nativo y la preferencia de movimiento reducido.

## Revisión en dos pasadas

1. Capturar la primera versión de carta, salón, cocina y caja con datos semilla en 360, 768 y 1440 px de ancho. Mantener las mismas condiciones para la segunda captura. Revisar también dueño, carrito y reflujo a 320 px.
2. Buscar defectos observables con nombres largos, una mesa que comparte cuenta, 20 comandas abiertas, una aclaración extensa, producto agotado, pérdida de señal y un plato sin foto. Completar el recorrido con teclado y con control táctil.
3. Implementar al menos tres mejoras visuales concretas en jerarquía, composición, legibilidad o manejo. Por ejemplo, mantener el saldo visible al abrir el teclado, reagrupar una aclaración con su plato o evitar que una foto desplace el botón principal. Elegir mejoras a partir de lo observado.
4. Capturar los mismos estados y tamaños después de la corrección. Guardar la comparación en el repositorio e indicar qué problema resolvió cada cambio. Aceptar únicamente cuando se pueda identificar y ejecutar la acción principal y no haya texto, importes o controles tapados.

El objetivo del producto para los controles frecuentes es 44 × 44 px. Para texto normal usar contraste de al menos 4,5 a 1. Revisar con especial cuidado fondos de marca, zonas de alerta y texto secundario. [W3C, contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [Reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [Tamaño de controles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
