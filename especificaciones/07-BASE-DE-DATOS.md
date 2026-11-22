# Base de datos

El esquema se implementa por etapa. El restaurante, la visita y el turno son identidades distintas. La mesa 4 sigue siendo la misma al día siguiente, pero sus consumos pertenecen a otra visita.

| Grupo | Entidades sugeridas | Relación o restricción importante |
|---|---|---|
| Negocio y equipo | Restaurantes, miembros, roles, permisos | Un usuario puede integrar más de un local con permisos distintos. Toda lectura comprueba la membresía de ese local. |
| Salón | Sectores, mesas, visitas, asignaciones de mesas y personas | Una visita puede abarcar varias mesas. Una mesa física admite una sola asignación abierta simultánea. |
| Catálogo | Categorías, productos, variantes, extras, precios, estaciones | El producto tiene estación y opciones del mismo negocio. Las referencias cruzadas deben conservar restaurante. |
| Comanda | Rondas, líneas, envíos por estación y eventos de preparación | Guardar nombre, precio, extras y aclaración aplicados al confirmar. Registrar cantidad lista y entregada por línea. |
| Disponibilidad | Cupos por plato y movimientos de reserva o liberación | Actualización atómica con cada pedido confirmado. Cantidad disponible igual o mayor a cero. |
| Caja | Turnos, cobros, aplicaciones a ítems o cuenta, devoluciones y movimientos efectivos | Importes en centavos y un identificador de operación único por local. Las propinas y el vuelto tienen representación explícita. |
| Pedidos externos | Pedidos, franjas, zonas y contactos de entrega | Al aceptar se asocia una única comanda. El enlace privado identifica ese pedido y puede vencer. |
| Recetas y stock | Insumos, unidades, conversiones, recetas, compras, inventarios y mermas | Registrar unidad estándar, rendimiento y fecha de costo. Una venta puede guardar la estimación vigente entonces. |
| Reservas y fidelidad | Reservas, cupos, lista de espera y adhesiones | Asignar cupo en transacción. La adhesión registra el canal, alcance, fecha y baja. |
| Operación de plataforma | Sesiones, auditoría y métricas agregadas | La base descartable de pruebas queda aislada de la instalación operativa. Los movimientos sensibles registran actor, momento y motivo. |

## Invariantes a implementar

- Usar claves foráneas y restricciones que validen la pertenencia al mismo restaurante. Dinero exacto, cantidades positivas y cantidades listas o entregadas dentro de los límites de cada línea.
- Incluir índices para pedidos activos por restaurante y estación, visitas abiertas, movimientos por turno y disponibilidad por plato. Paginar históricos. Guardar marcas de tiempo consistentes y convertir a la zona local para la presentación.
- Separar permisos de lectura y escritura. La carta pública recibe solo nombre, descripción, fotos, precio, etiquetas y disponibilidad de lo publicado. Caja y costos tienen accesos específicos. Aplicar también las restricciones al almacenamiento y a la sincronización.
- El identificador de una operación corresponde a un contenido determinado. Si se reenvía con el mismo contenido, devolver el resultado previo. Si cambia, pedir una operación nueva. Implementar las decisiones sensibles como transacciones del lado servidor.
- Confirmar ronda y descontar cupos de manera indivisible. Cobrar y registrar su aplicación de manera indivisible. Antes de cerrar una mesa, comprobar el saldo dentro de la misma operación. Las anulaciones y devoluciones generan eventos compensatorios.

## Semilla mínima y migraciones

Crear dos espacios ficticios, al menos dos usuarios de mozo para probar concurrencia, cocina, barra, caja y dueño. Incluir mesa 4, una mesa adicional, una milanesa con nota, bebidas, un plato limitado a una unidad, un producto sin foto y precios de prueba. Añadir un turno abierto y uno cerrado. Mantener separadas migraciones y datos de prueba. Verificar migración sobre base vacía y sobre datos del paso anterior.
