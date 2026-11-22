# Reglas de negocio

## Mesas, comandas y stock

| Situación | Regla |
|---|---|
| Se vuelve a ocupar la mesa 4 | Abrir una visita nueva. El QR impreso sigue vigente y el acceso temporal de los comensales anteriores vence. |
| Se mueve o une una mesa | Trasladar consumos y pagos asociados en una operación consistente. Mantener registro de mesa anterior, destino, responsable y momento. |
| Se repite una ronda | Crear una ronda nueva después de validar precio y disponibilidad. El reintento técnico de la misma ronda devuelve la confirmación original. |
| Hay una sola porción | Reservarla al confirmar el pedido, en una transacción compartida por salón, mostrador y pedidos externos aceptados. Si falta stock de una línea, devolver qué cambió para que la persona revise su pedido. |
| Se anula un plato | Si no empezó a prepararse, liberar la porción. Si ya se preparó, pedir el destino de esa unidad y registrar merma si corresponde. El sector reconoce el cambio. |
| Se modifica el precio | Los ítems confirmados conservan su precio. Los pedidos nuevos usan el vigente. Una propuesta de carrito desactualizada requiere reconfirmación del cliente. |
| Hay pizza por mitades | El local elige mayor precio o promedio de mitades y configura extras. La carta muestra el total antes de enviar. La comanda especifica el gusto y los extras de cada mitad. |
| Se vende una docena surtida | Validar que los gustos sumen doce y mostrar si se aplica un adicional. Cocina ve las cantidades por gusto. |
| Se agota un plato | Deshabilitar la venta y publicar el cambio de carta. Un carrito anterior vuelve a comprobar el stock al enviar. Cocina conserva visibilidad de las unidades ya comprometidas. |
| Un llamado queda pendiente | Los toques repetidos de esa visita se agrupan por motivo. El mozo acusa atención y el comensal recibe una respuesta visible. |

## Pagos que deben cuadrar

- Guardar dinero en centavos y cantidades con precisión apropiada. Cuotas de una cuenta de $10.000 entre tres personas pueden ser $3.333,34, $3.333,33 y $3.333,33. Mostrar quién recibe el centavo remanente.
- Distinguir importe de venta, pago aplicado, efectivo recibido, vuelto y propina. Si el total es $18.000 y el cliente paga $10.000 por transferencia y entrega $10.000 en efectivo por los $8.000 restantes, el vuelto es $2.000 y el cajón aumenta $8.000.
- El efectivo esperado se calcula desde el fondo inicial y los movimientos efectivos del cajón. Incluir ingresos y salidas manuales y propinas efectivamente ingresadas o retiradas, cada importe una vez. Las ventas a tarjeta y transferencia se concilian por su propio medio.
- Registrar un pago confirmado una sola vez y asociarlo a la visita, turno y responsable. Un comprobante enviado por chat deja la transferencia pendiente hasta su verificación por caja.
- Requerir autorización y motivo para descuentos excepcionales, cortesías, anulaciones, reaperturas y devoluciones. Una reversión deja visible el evento original. Un turno cerrado conserva su historial.
- La fecha operativa la define el turno del local. Un pago posterior al cambio de turno queda en el turno que lo cobró. Para reportes, exponer por separado fecha de venta, cobro y cierre.
- Las reseñas se piden a todos con texto neutral y elección libre. Las recompensas de fidelidad dependen de compras o visitas, independientemente de cualquier reseña. [Google, política de aportes](https://support.google.com/business/answer/7400114?hl=es-ES)

## Estados y dominio de cada persona

El mozo gobierna apertura, ronda y entrega. La estación gobierna pendiente, en preparación y listo. El encargado confirma o rechaza pedidos externos. Caja gobierna el pago. Guardar fecha, actor, cantidades y motivo de cada excepción. Un pedido listo puede seguir impago y una cuenta parcialmente pagada puede seguir recibiendo rondas autorizadas.
