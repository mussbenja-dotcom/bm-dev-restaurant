# Criterios de aceptación

Probar con datos ficticios. Guardar versión, fecha, entradas, resultado y evidencia. Una prueba pendiente queda marcada como tal. Ejecutar cada caso al implementar su etapa, junto con los casos previos que pueda afectar.

| Caso | Acción | Resultado esperado |
|---|---|---|
| A01 · Turno completo | Abrir mesa 4, cargar una milanesa sin cebolla y dos bebidas desde el celular. | Cocina recibe un plato con la nota, barra dos bebidas y el mozo ve ambos estados desde otro dispositivo. |
| A02 · Última unidad | Dos mozos confirman al mismo tiempo la última porción desde distintas mesas. | Solo una confirmación, stock cero y aviso accionable al otro. La carta vigente indica agotado. |
| A03 · Doble toque | Repetir dos veces el envío de la misma ronda. | Una ronda, un descuento de stock y una sola preparación por sector. |
| A04 · Red inestable | Cortar red antes del envío y luego en otro ensayo justo después de confirmar. Reconectar. | En el primer caso queda borrador o pendiente. En el segundo se recupera el resultado original sin duplicados. |
| A05 · QR y visita | Pedir la cuenta repetidamente, atender, cerrar y abrir otra visita en la misma mesa. | Un aviso activo por motivo. El acceso anterior vence y el QR permite consultar la carta vigente. |
| A06 · Cambio de precio | Confirmar una ronda, subir el precio y abrir la carta en otro dispositivo. | La ronda anterior conserva precio y la próxima muestra el nuevo. |
| A07 · Compartir y redondear | Dividir $10.000 entre tres personas. | $3.333,34 + $3.333,33 + $3.333,33 = $10.000. La asignación del centavo se ve en caja. |
| A08 · Pago mixto | Cuenta $18.000. Confirmar transferencia $10.000 y recibir en efectivo $10.000 por los $8.000 restantes. | Vuelto $2.000, aumento del cajón $8.000, transferencia $10.000 y saldo cero. Un reintento preserva esos resultados. |
| A09 · Mesa con pago parcial | Aplicar una parte, mover o unir la mesa y cobrar el resto. | Se conservan consumos, importes ya pagados y saldo. El historial identifica origen y destino. |
| A10 · Caja a medianoche | Abrir con $20.000, cobrar $8.000 netos en efectivo, retirar $3.000 y cerrar a la madrugada con $24.500 contados. | Efectivo esperado $25.000 y diferencia de −$500. El reporte conserva el turno y muestra el retiro. |
| A11 · Aislamiento | Iniciar con personal A y B, cliente, caja y cocina y recorrer las pantallas y datos autorizados. | Datos, archivos y eventos pertenecen al local y al rol correspondiente. El cliente accede solo a su pedido y a la carta pública. |
| A12 · Instalación y persistencia | Instalar con la base vacía, crear dos locales y completar turnos. Reiniciar el servidor y luego reiniciar solo la base de pruebas. | Los dos locales operativos conservan pedidos, usuarios, caja y fotos. La base descartable se reinicia por separado. |
| A13 · Retiro o delivery | Llenar una franja, aceptar el pedido y abrir WhatsApp desde su ficha. | Una venta y una comanda. El siguiente cliente ve la próxima franja. El chat contiene el número existente. |
| A14 · Pizza y docena | Probar mitades con extras y una docena con cantidades por gusto. | Total acorde a la regla del restaurante, ambas mitades detalladas en cocina y doce unidades en la docena. |
| A15 · Receta y margen | Ingresar venta neta ficticia $12.000, ingredientes $4.000 y envase $500. | Margen estimado $7.500 según los costos cargados. Si falta un costo, figura como estimación incompleta. |
| A16 · Copias | Restaurar una copia en un entorno aislado y comparar una carta y un turno. | Productos, fotografías, importes, roles y movimientos coinciden y se puede volver a operar. |
| A17 · Presupuesto | Instalar y operar localmente con la configuración de ejemplo y sin cuentas de terceros. | El sistema funciona con ARS 0 de dependencias contratadas. El listado de mejoras pagas queda en un documento aparte. |
| A18 · Reseñas | Probar la opción de reseña desde diferentes mesas y después de enviar un comentario privado. | Todas reciben la misma invitación neutral e independiente. |
| A19 · Ticket interno X | Abrir la precuenta de una mesa, cobrar con dos medios, imprimir o guardar el ticket de cierre y volver a sacarlo desde el historial. | Ambos muestran X y la leyenda fiscal arriba. En 58 y 80 mm los importes se leen completos. El ticket de cierre conserva total, medios y vuelto. La copia mantiene el identificador y el detalle originales, y caja registra un solo cobro. |
| A20 · Delivery sin datos | Precargar una entrega con Wi-Fi, activar modo avión, cerrar y reabrir el panel, registrar entrega e importe, volver al Wi-Fi y sincronizar dos veces. | Se puede completar la recorrida sin datos. El cliente ve el último estado confirmado hasta la sincronización. El servidor aplica cada resultado una vez y caja puede cotejar lo declarado. |

## Aprobación visual obligatoria

| Prueba | Con qué se comprueba |
|---|---|
| Carta, salón, cocina y caja a 360, 768 y 1440 px de ancho | Capturas del mismo estado antes y después de la mejora. Comprobar acción principal visible, proporciones, jerarquía, recorte y lectura. |
| Carta con nombres largos, fotos ausentes y precios de varias cifras | Precios y botones legibles, contenido refluye hasta 320 px y la etiqueta “Agotado” incluye texto. |
| Cocina a capacidad y caja con teclado abierto | Cantidad y aclaración pertenecen visualmente al plato correcto. En caja se conserva acceso al saldo y al cobro. |
| Tacto, teclado y contraste | Comanda completa con teclado, foco visible, controles frecuentes de 44 × 44 px como objetivo y texto normal con contraste mínimo de 4,5 a 1. |
| Resultado de la segunda pasada | Tres cambios visuales reales con su evidencia antes/después y una frase que explique qué resolvió cada uno. |

La entrega de cada etapa identifica qué se puede abrir, probar y reproducir, qué resultados se verificaron y qué está pendiente. Verificar el arranque local y dejar documentados los requisitos de un futuro alojamiento.
