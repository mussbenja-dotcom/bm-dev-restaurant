# Módulos y funcionalidades

## Superficies del producto

| Pantalla | Qué aparece primero | Acción principal |
|---|---|---|
| Carta de salón | Nombre del local, mesa, categorías, platos disponibles y precio. | Ver un plato, elegir variante o pedir atención. |
| Carta de retiro y delivery | Horario, estado del local, canal, tarifa por zona y primera franja disponible. | Armar y confirmar carrito con el total a la vista. |
| Plano o lista de mesas | Sector, número, personas, estado, mozo y avisos pendientes. | Abrir o retomar la mesa. |
| Toma de comanda | Favoritos, búsqueda, última ronda, variantes y cuenta en curso. | Enviar la ronda y recibir confirmación. |
| Cocina y barra | Pedidos por antigüedad, mesa, cantidades, notas y cambios destacados. | Empezar o completar ítems de su estación. |
| Pase | Panorama de las estaciones que intervienen en la misma mesa o retiro. | Avisar a salón que puede retirar lo que está listo. |
| Caja y arqueo | Saldo por mesa, cobros del turno, ingresos y egresos. | Aplicar pago o cerrar turno con importe contado. |
| Panel del dueño | Alertas accionables, ventas y cobros por turno, mesas abiertas. | Abrir el detalle o tomar una decisión. |
| Configuración | Carta, horarios, equipo, permisos, sectores y canales. | Publicar y verificar la vista pública. |
| Panel de BM Dev | Locales, usuarios administradores y registro de asistencia. | Dar de alta un restaurante y asistir al equipo autorizado. |

## Flujos que vinculan los módulos

**Mesa atendida por un mozo.** Escanear el QR identifica la mesa. El mozo abre la visita, carga la primera ronda y envía. Cocina y barra reciben partes de la orden. El mozo retira, entrega y lleva la cuenta. El cobro alimenta el arqueo y libera la mesa cuando el saldo llega a cero.

**Mesa que hace su propio pedido.** El local habilita esa modalidad. La visita vigente o el personal validan el pedido. El mozo ve que llegó desde la mesa y puede atender excepciones. Un comensal que solo desea consultar la carta puede hacerlo sin dejar datos.

**Retiro o delivery.** El pedido web entra a una cola de aceptación. El encargado confirma plazo y el pedido ingresa en cocina. El cliente consulta el estado de ese pedido mediante un enlace privado. Al entregar, el equipo registra quién cobró y por qué medio. El contacto por WhatsApp conserva el número original.

**Cambio de turno.** El responsable identifica mesas abiertas, pagos parciales, faltantes y movimientos pendientes. Puede transferir la atención a otro miembro autorizado. El cierre declara qué quedó abierto y conserva la relación entre visita, ventas y cobros.

**Alta de un restaurante.** Cargar nombre y marca, elegir plantilla, importar o cargar carta, asociar productos a estaciones, definir medios de cobro, crear al primer empleado y generar el QR de una mesa de prueba. La vista previa permite comprobar variantes y precios antes de publicar.

## Próximos módulos activables por local

Reservas y lista de espera, recetas e insumos, inventario y mermas, producción por turno, pedidos a proveedores, promociones por horario, sellos por visita y reportes por sucursal. Guardar su configuración por restaurante. La acción “Activar” debe explicar qué dato se necesita para que el módulo sea útil.
