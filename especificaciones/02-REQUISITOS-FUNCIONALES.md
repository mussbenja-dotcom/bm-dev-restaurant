# Requisitos funcionales

El primer recorrido se construye sobre el sistema operativo. Comienza con el alta de un restaurante y lleva hasta el cierre de un turno con registros persistentes. Las mejoras se habilitan por local.

| Código | Persona | Debe poder | Primera entrega |
|---|---|---|---|
| F01 | Administrador de BM Dev | Crear restaurantes operativos aislados y dar de alta al administrador de cada local. | Núcleo operativo |
| F02 | Dueño | Cargar carta, categorías, variantes con precio, sectores, fotos opcionales, horarios y medios de pago. | Núcleo operativo con carta editable desde el alta |
| F03 | Comensal | Leer la carta general o la de su mesa, ver precios y agotados, pedir atención y pedir la cuenta. | Núcleo operativo |
| F04 | Mozo | Abrir visita, asignar personas, cargar rondas con notas y ver preparación y entrega. | Núcleo operativo |
| F05 | Cocina y barra | Recibir sus ítems, ver cantidades, reconocer cambios y marcar preparación, listo o disponibilidad. | Núcleo operativo |
| F06 | Cajero | Ver cuenta, repartir consumos, cobrar con medios combinados, ver saldo y cerrar la mesa. | Núcleo operativo |
| F07 | Dueño | Ver ventas, cobros y mesas abiertas y abrir el detalle que explica el total. | Núcleo operativo |
| F08 | Encargado | Crear usuarios y permisos, autorizar descuentos, cortesías, anulaciones, reaperturas y reversiones con motivo. | Primer turno |
| F09 | Mozo | Mover, unir o separar mesas, compartir un ítem y atender avisos por sector. | Primer turno |
| F10 | Caja | Abrir con fondo, registrar gastos y retiros, gestionar pagos parciales, arqueo y exportación. | Primer turno |
| F11 | Cliente externo | Hacer un pedido de retiro o delivery, ver tarifa, elegir franja y seguir el estado de su pedido. | Primer turno del local que use el canal |
| F12 | Encargado | Aceptar o rechazar externos, cargar pedidos de mostrador o teléfono, pausar un canal y priorizar cola. | Primer turno del local que use el canal |
| F13 | Cliente en mesa | Pedir desde la carta durante una visita activa si el restaurante habilita el modo de autopedido. | Piloto según modalidad |
| F14 | Encargado de reservas | Dar cupos por franja, recibir solicitudes, sentar, marcar ausencias y gestionar lista de espera. | Segunda versión |
| F15 | Cocina y compras | Cargar ingredientes, rendimientos, compras, subrecetas e inventarios y explicar mermas. | Segunda versión |
| F16 | Dueño | Consultar costo, margen estimado y popularidad de un plato, y simular un cambio antes de publicar. | Segunda versión |
| F17 | Encargado | Habilitar precios por canal u horario, mitades, docenas, happy hour o menú del día según el rubro. | Segunda versión o antes si el piloto lo necesita |
| F18 | Cliente y dueño | Repetir un pedido, reservar, dejar una reseña genuina o adherir a beneficios de manera voluntaria. | Reseña en piloto y fidelidad después |
| F19 | Dueño | Exportar operaciones y corregir o recuperar acceso por un procedimiento del local. | Primer turno |
| F20 | BM Dev | Dar de alta locales, respaldar y restaurar, revisar errores con acceso registrado. | Antes del primer turno |
| F21 | Cajero | Imprimir precuenta y ticket interno X, guardar PDF y reimprimir desde el historial, con referencia e importes originales. | Núcleo operativo |
| F22 | Repartidor | Precargar entregas en el Wi-Fi del local, registrar resultados sin datos y sincronizarlos al regreso. | Delivery propio |

## Datos y decisiones que deben quedar visibles

En salón aparecen el pedido, el estado y la mesa. En cocina, la cantidad y la aclaración de cada plato. En caja, total, ya cobrado, saldo y vuelto. En el panel del dueño, fecha operativa y diferencia entre vendido y cobrado. En el celular del comensal, el modo habilitado y los últimos precios vigentes. Toda operación que pueda demorarse muestra su estado y una vía de recuperación.
