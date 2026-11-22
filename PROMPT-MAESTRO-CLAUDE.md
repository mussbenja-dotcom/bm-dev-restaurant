# Prompt maestro para Claude · BM Dev Restaurant

Claude, programá BM Dev Restaurant desde cero como un sistema de gestión para que un restaurante real registre sus pedidos, atienda a sus mesas y cierre su caja. Entregá una aplicación completa, con base persistente, alta de restaurantes y empleados, roles y datos separados por local. El sistema funcionará en español rioplatense y moneda ARS.

El proyecto tiene un presupuesto de ARS 0 para servicios, licencias, APIs y hardware nuevo. Instalalo, ejecutalo y verificalo en local con herramientas gratuitas. Dejá todo listo para llevar a un servidor más adelante. Rubén elige y configura el hosting después. Usá datos ficticios únicamente para probar el mismo sistema. La instalación para el restaurante empieza con la base limpia y el asistente de alta.

## Instrucciones obligatorias para Claude

1. **Usá todas las skills que tengas disponibles.** Antes de programar, inventariá las skills instaladas, leé sus instrucciones y asigná cada una al trabajo en que pueda aportar. Cubrí producto, diseño de interfaces, frontend, backend, base de datos, accesibilidad, pruebas en navegador, rendimiento y revisión visual con los recursos de tu entorno. Registrá brevemente qué aplicaste y qué resultado produjo. Si una capacidad requerida falta, hacé la tarea con una alternativa gratuita disponible e identificá la comprobación que quede pendiente. La ejecución del producto debe costar ARS 0 y funcionar independientemente de Claude.
2. **Mejorá sí o sí la perspectiva y la calidad visual.** Tomá decisiones de dirección de arte, composición, jerarquía, contraste, legibilidad, espaciado y navegación para cada rol. El listón es que el comensal encuentre el precio, el mozo cargue una ronda, cocina lea una aclaración a distancia y caja vea el saldo aun con el teclado abierto. La primera pantalla técnicamente funcional es tu punto de partida para una segunda pasada obligatoria de diseño.
3. **Leé el README y los once archivos de especificaciones antes de cambiar el código.** Si recibís solo este prompt, generá esa misma estructura usando los requisitos que siguen y luego programá. Si encontrás documentación ya escrita, contrastala con este encargo y preservá lo compatible. El tope de gasto, el aislamiento entre locales y la revisión visual se mantienen en cada etapa.
4. **Construí y avanzá con autonomía.** Empezá a programar en esta sesión. Resolvé e implementá por tu cuenta las decisiones de arquitectura, componentes, interfaz, estructura, dependencias gratuitas, migraciones locales y datos de prueba. Ejecutá el arranque, navegá el sistema, corré las pruebas, revisá los errores y corregilos. Pasá de una etapa a la siguiente automáticamente y seguí hasta completar el alcance vigente, sin pedirme permisos, confirmaciones intermedias ni que te diga «seguí». Ante una ambigüedad, elegí una opción reversible que respete el alcance y anotala. Ante una herramienta indisponible, probá otra vía gratuita y continuá los módulos independientes. Si hay un límite de sesión, dejá un punto de reanudación con lo verificado y el próximo paso. Usá los permisos disponibles del entorno. Si una acción externa está bloqueada, dejá el trabajo local completo y explicá el bloqueo concreto en el resumen final.
5. **Respetá las decisiones reservadas a Rubén.** El hosting, el dominio, la publicación y las integraciones pagas quedan para después. El trabajo actual consiste en implementar, probar, documentar y empaquetar el sistema local. Dejá las opciones pagas únicamente en `FUTURAS-MEJORAS-PAGAS.md`, sin cuentas, claves, dependencias, cobros, botones ni pantallas que las simulen dentro del producto.

## Estructura de documentación del proyecto

Los archivos `README.md` y `FUTURAS-MEJORAS-PAGAS.md` van en la raíz. Los siguientes once archivos van dentro de `especificaciones/`. Conservá estos nombres exactos.

| Archivo | Decisión que documenta |
|---|---|
| `01-CONCEPTO-DEL-PRODUCTO.md` | Usuarios, propuesta, problemas del turno, piloto y métricas. |
| `02-REQUISITOS-FUNCIONALES.md` | Qué puede hacer cada rol y en qué etapa se entrega. |
| `03-REQUISITOS-NO-FUNCIONALES.md` | Costo, integridad, accesibilidad, rendimiento, conectividad y recuperación. |
| `04-MODULOS-Y-FUNCIONALIDADES.md` | Pantallas, módulos y recorridos de los distintos canales. |
| `05-REGLAS-DE-NEGOCIO.md` | Estados, precios, redondeos, porciones, cierres y casos difíciles. |
| `06-ARQUITECTURA-RECOMENDADA.md` | Componentes, herramientas gratuitas, sincronización y despliegue. |
| `07-BASE-DE-DATOS.md` | Entidades, relaciones, permisos, restricciones, transacciones e índices. |
| `08-DISENO-UI-UX.md` | Dirección visual por rol y protocolo de revisión con capturas. |
| `09-MEJORAS-E-INNOVACIONES.md` | Ideas priorizadas, ejemplos argentinos y cómo validar su utilidad. |
| `10-PLAN-DE-DESARROLLO.md` | Etapas de implementación autónoma, alta real, pruebas y entrega local. |
| `11-CRITERIOS-DE-ACEPTACION.md` | Pruebas funcionales, visuales y operativas con resultados observables. |

## 1. Qué tiene que quedar funcionando primero

Armá un recorrido completo con una carta pública, una pantalla de mozo, una para cocina, otra para barra y una de caja. El mozo abre la mesa 4, carga dos bebidas y una milanesa sin cebolla. Cocina recibe el plato con la aclaración. Barra recibe las bebidas. Cada sector marca lo suyo como listo. El mozo confirma la entrega. Caja divide la cuenta, registra una parte en efectivo y otra por transferencia confirmada y cierra la mesa. El dueño ve el resultado del turno. El movimiento debe poder seguirse desde dos dispositivos.

Agregá una segunda prueba que muestre el valor en menos de un minuto. Queda una porción, dos mozos la piden casi al mismo tiempo y únicamente uno consigue confirmarla. La otra mesa recibe un aviso que permite elegir otra cosa. El agotado se refleja en los dispositivos conectados y en la carta.

## 2. Personas, acceso y pantallas

| Persona | Pantallas y acciones |
|---|---|
| Comensal | Carta por enlace o QR, precios, disponibilidad, pedido de atención o de cuenta. El local decide si acepta pedidos desde la mesa. Puede consultar la carta sin registrarse. |
| Mozo | Sus mesas y, si tiene permiso, las del turno. Abre una mesa, agrega comensales, carga rondas, ve platos listos, recibe llamados, atiende y marca entregas. |
| Cocina y barra | Bandeja de su sector, cantidades, notas, tiempos y cambios. Pueden indicar un agotado. Ven la información necesaria para preparar el pedido. |
| Responsable del pase | Vista de la mesa completa que reúne la producción de distintos sectores. Sabe qué puede retirar el mozo y qué sigue pendiente. El local puede asignar esta función a una persona que ya cumple otro rol. |
| Caja | Mostrador, cuentas, cobros parciales, rendición del turno y movimientos de caja según permisos. |
| Dueño o encargado | Carta, precios, horarios, sectores, equipo, autorizaciones, stock, caja, informes, exportación y configuración del negocio. |
| Administración de BM Dev | Alta y suspensión de locales, plantillas, administración de usuarios y asistencia autorizada y registrada. |

Permití combinar roles en locales chicos. Cada empleado tiene su usuario. En un dispositivo compartido el cambio de persona debe ser rápido y las operaciones sensibles deben exigir la autorización correspondiente. Cada rol abre directamente en la pantalla que usa durante el turno.

## 3. Carta y QR que sirvan durante el servicio

- Carta pública con identidad del local, categorías, búsqueda, fotos opcionales y comprimidas, nombre, descripción, precio final visible, variantes, extras y disponibilidad. Debe funcionar bien en un teléfono económico. Priorizá precio, descripción y botones aunque la foto tarde en cargar.
- Un enlace estable por local y un QR permanente por mesa que se pueda generar y descargar desde el navegador. Un cambio de precio, foto o plato se publica sin reimprimir. Incluí un enlace corto para quien prefiera tipearlo.
- La carta del salón reconoce la mesa. El link de redes abre la carta general y ofrece retiro o delivery según lo que esté habilitado. Dejá visibles horarios, zona y última hora de pedidos.
- Botones para llamar al mozo y pedir la cuenta. El equipo recibe mesa, hora y motivo, acusa atención y puede cerrar el aviso. Agrupá toques repetidos mientras haya un llamado pendiente.
- Ofrecé modos configurables por local. Se puede mostrar solo la carta, habilitar llamados o aceptar comandas del cliente. Las acciones de mesa requieren una visita activa y un código temporal o confirmación del personal. El QR impreso identifica la mesa, por sí solo no autoriza consumos. Al cerrar la mesa, finaliza el acceso de esa visita.
- Ingredientes y etiquetas alimentarias cargados por el local. Permití avisar al mozo sobre una alergia y destacar la nota en cocina. El local valida la información publicada y el equipo confirma con el comensal cualquier duda.
- Al cerrar la experiencia, habilitá el enlace oficial de reseñas de su Perfil de Negocio en Google. Mostrá la misma invitación a todos, por ejemplo “¿Cómo comiste hoy? Dejanos tu opinión en Google”. El comentario privado al dueño puede convivir con el enlace. Mantené ambos accesibles cualquiera sea la opinión.

## 4. Salón, comanda, cocina y barra

- Plano sencillo por salón, patio, vereda o barra, más una lista alternativa para el celular. Mostrar mesa, estado, mozo, cantidad de personas, tiempo y saldo según permisos. Estados claros para libre, abierta, pidió la cuenta y lista para limpiar. Una mesa reservada tiene horario.
- Abrir, mover, unir y separar mesas manteniendo consumos, pagos y trazabilidad. Asignar consumos por persona cuando haga falta. Las correcciones y anulaciones conservan el motivo y el responsable.
- Comanda rápida con favoritos, búsqueda, cantidades, notas por plato, punto de cocción, guarnición, extras con precio y “repetir ronda”. Revalidar disponibilidad y precio antes de agregar una nueva ronda.
- Enrutar cada producto a su sector. Dar número a cada envío y conservar mesa, ronda, hora y persona que lo cargó. Cocina distingue lo recién agregado de lo que ya estaba haciendo. Si se corrige algo en preparación, aparece un aviso que requiere reconocimiento del sector.
- Cocina y barra muestran “pendiente”, “en preparación” y “listo”. Salón agrega “entregado”. Permitir completar una cantidad parcial y mostrar el saldo pendiente. El pase muestra, por ejemplo, “2 de 3 platos listos” sin obligar a esperar para entregar una bebida.
- Modo hora pico con botones grandes, pedidos por antigüedad y demora configurable por sector. Color acompañado de texto y sonido opcional activado por el usuario. Un botón permite ver qué mesa lleva más tiempo esperando.
- En la segunda etapa, incorporar entradas, principales y postres. El mozo puede marcar “marchá los principales”. La hora sugerida de inicio puede calcularse con los tiempos de preparación definidos por el local y corregirse a mano.
- Operación con mala señal. Conservar un borrador local, mostrar “pendiente de enviar” y cambiar a “recibido” con confirmación del servidor. Reintentar sin duplicar, volver a validar stock y recuperar los últimos cambios al reconectar. Si una confirmación se perdió, consultar el resultado del envío original. La cocina central y el cobro definitivo requieren conexión al servidor.

## 5. Caja y cierre de turno

- Abrir con fondo inicial. Registrar efectivo, transferencia, tarjeta y otros medios configurables. Registrar pagos combinados, parciales, propina separada, importe recibido y vuelto. Para una transferencia, el cajero verifica la acreditación por el medio habitual y confirma el registro.
- Dividir por importe, por persona, por ítem o en partes iguales. Permitir compartir un ítem, por ejemplo una pizza entre tres. Trabajar en centavos y asignar el remanente de redondeo de manera visible y consistente. Un monto ya pagado queda identificado.
- Permitir descuentos por ítem o cuenta, cortesías, gastos, retiros, ingresos y devoluciones. Exigir permiso y motivo cuando corresponda. Una devolución debe referenciar el cobro y medio originales. Corregir con un movimiento de reversión.
- El precio de una línea enviada conserva su valor histórico. La próxima ronda usa el precio vigente. Evitar cerrar dos veces la misma caja y cobrar dos veces un reintento. Una mesa solo queda saldada cuando el total coincide con los pagos aplicados.
- Al cierre mostrar efectivo esperado, efectivo contado, diferencia, ventas, cobros por medio, propinas, descuentos, anulaciones, devoluciones, gastos y mesas con saldo. Un turno puede cruzar la medianoche. Separar ventas del turno, cobros y dinero en el cajón.
- **Ticket interno imprimible incluido en la primera versión local.** En caja agregá “Imprimir precuenta” antes del cobro y “Imprimir ticket interno” al cerrar la venta. En ambas vistas poné **X** y **DOCUMENTO NO VALIDO COMO FACTURA** centrados y destacados arriba. Mostrá nombre del local, fecha y hora, número interno, mesa o pedido, productos, cantidades, extras, descuentos y total. En el ticket de cierre, mostrá medios e importes registrados y vuelto cuando corresponda. Prepará impresión desde el navegador en formatos térmicos de 58 y 80 mm y opción de guardar como PDF. Permití reimprimir desde el historial como copia del mismo ticket, con el mismo número y los importes originales. Generar o reimprimir el ticket no crea un cobro nuevo. La emisión es local y funciona sin una conexión con ARCA. La factura fiscal sigue por el circuito del comercio. Dejá cualquier integración fiscal futura en el listado de mejoras.

## 6. Retiro, mostrador y delivery propio

- Carta por link desde redes o WhatsApp. El cliente elige retiro o delivery, arma carrito, agrega aclaraciones, ve total y horarios, y envía el pedido al tablero del local. Mostrar el número y distinguir “recibido”, “aceptado”, “en preparación”, “listo”, “en reparto” y “entregado”, según canal.
- En mostrador, permitir tomar un pedido por teléfono o en persona usando el mismo flujo. Agregar nombre breve o número de retiro. El equipo confirma o rechaza un pedido indicando el motivo. Al aceptar, se genera una sola orden de cocina.
- Para entrega pedir solo los datos necesarios, usar barrios o zonas con tarifa fija, mínimo y franjas configurables. Para retiro, omitir el domicilio. El total se ve antes de confirmar. El local puede pausar delivery durante 30 minutos o limitar pedidos por franja.
- **Delivery propio a costo $0.** El encargado asigna el pedido, indica una ventana estimada y marca “En camino” al despacharlo. El cliente consulta por enlace privado el último estado confirmado, la hora de actualización y el estimado. El enlace de WhatsApp prepara el texto para envío manual. Configurá el enlace externo cuando Rubén publique el sistema. Antes de eso, probalo en local.
- **Repartidor sin datos móviles.** Antes de salir, abre su panel web con el Wi-Fi del local y guarda las entregas asignadas. En modo avión puede reabrir la pantalla y ver dirección, indicaciones e importe. Puede registrar “Entregado”, “No pude entregar” y el efectivo declarado. Guardá los cambios localmente con su hora y marcá “Pendiente de sincronizar”. Al regresar al Wi-Fi y reabrir el panel, enviá cada cambio una sola vez, validando asignación y estado en el servidor. Si un pedido fue cancelado o reasignado, avisá al encargado para resolverlo. Caja coteja el efectivo declarado. Descargá solo los datos necesarios y eliminá la copia del pedido al sincronizar y cerrar la entrega. Si el dispositivo no admite el modo offline, ofrecé hoja de reparto imprimible y carga al regreso.
- Implementá la vista offline con almacenamiento local persistente y la pantalla cacheada. Verificá en navegador móvil con un origen seguro (HTTPS para un celular en la red local). Documentá una prueba local gratuita y la alternativa impresa. El mapa GPS en vivo y una app instalable de repartidor quedan como decisiones futuras de Rubén.
- Si el local configura un carrito enviado exclusivamente por WhatsApp, etiquetalo como solicitud. El local debe cargar o aceptar el pedido antes de que el sistema lo dé por recibido. Elegir un único camino por pedido para que una venta no entre dos veces.

## 7. Funciones para que el dueño quiera abrir el sistema mañana

1. **Últimas porciones.** Un plato puede tener disponibilidad manual o un cupo que se comparte entre salón, mostrador y pedidos confirmados. Mostrar “quedan 3” al personal. Reservar la porción al confirmar y liberarla al anular según el estado de preparación. Un plato ya preparado que vuelve se registra como merma cuando corresponde.
2. **Qué necesita atención ahora.** En la portada del dueño aparecen hasta tres situaciones concretas con acceso a resolverlas. Ejemplos posibles son un pedido de cuenta sin atender, una comanda demorada o una diferencia de caja. Los umbrales los define el local.
3. **Recetas y rendimiento.** Ingredientes en gramos, mililitros o unidades, costo de compra, rendimiento utilizable, subrecetas y envases. Calcular costo por porción y fecha del costo. Identificar platos con costos incompletos. Conservar el costo histórico aplicado al vender.
4. **Stock y compras.** Entradas por compra, consumos por receta, ajustes, inventario contado y merma con motivo. Proveedor, unidad, presentación, precio, última compra y variación de costo. Estados para pedido de compra y recepción. Evitar descontar dos veces el mismo insumo al confirmar y luego servir.
5. **Qué platos empujar.** Comparar unidades vendidas y margen de contribución estimado entre platos de una misma categoría y período. Mostrar los datos que explican la sugerencia. La estimación descuenta del ingreso neto los costos variables cargados y deja visibles los que falten. Permitir probar otra receta o un precio antes de publicarlo.
6. **Preparación del próximo turno.** Mostrar cuántas porciones salieron en turnos comparables, cuántos días se usaron y qué reservas ya hay. El cocinero define la cantidad final para preparar. Si falta historial, permitir una planificación manual.
7. **Plantillas por rubro.** En pizzerías, pizza mitad y mitad con regla por local, docenas de empanadas con gustos y extras por mitad. En parrillas, punto, guarnición y salida por tanda. En bares, rondas y happy hour por día y franja. En rotiserías, menú del día, porción y cupos de retiro. En cafeterías, tamaños, tipo de leche y extras. Activar únicamente lo que corresponda a cada negocio.
8. **Reservas y espera.** Cupos por horario, cantidad de personas, mesa o sector, lista de espera, confirmación y cancelación por enlace. El encargado puede cargar una reserva telefónica y sentar a alguien que llegó antes. Tratar dos solicitudes simultáneas sobre el último cupo de forma consistente.
9. **Venta y regreso.** Plato del día programable, sugerencia de bebida o acompañamiento elegida por el local, combos con ahorro visible cuando sea real y enlaces para compartir una selección. Permitir repetir un pedido propio revalidando precios y stock. Fidelidad optativa por visitas o sellos, con aceptación explícita para comunicaciones y opción de baja. Mantener las reseñas de Google independientes de cualquier beneficio.
10. **Capacitación y crecimiento de BM Dev.** Alta guiada, plantillas por rubro, importación CSV con vista previa, validación de duplicados, copia de categorías y carga inicial rápida. Probar la capacitación con una instalación de prueba separada. Registrar activación y uso con métricas propias agregadas.

## 8. Diseño y facilidad de uso

La carta puede tener fotos y personalidad del restaurante. El salón necesita texto legible, contraste, botones amplios y las acciones frecuentes al alcance del pulgar. Cocina necesita cantidades y aclaraciones visibles desde cierta distancia. Caja necesita teclado, búsqueda rápida, totales siempre visibles y una confirmación inequívoca. Reservá la animación narrativa para la futura página comercial. En pantallas de servicio cada toque tiene que ayudar a completar una tarea.

Adaptá a celular, tableta y computadora. Incluí navegación por teclado, foco visible, etiquetas junto a los colores, estados de carga y error, deshacer donde tenga sentido y aviso de conexión. Usá moneda ARS, formato local y fecha operativa del restaurante en Argentina. Permití definir la hora de corte para informes si un turno termina después de medianoche. Verificá en particular una carta cargada sin fotos, un carrito vacío, un plato agotado en medio de un pedido y una orden parcialmente cobrada.

**Dirección de arte.** Para la carta del bodegón, proponé fondo marfil, verde botella, fotografía de plato y titulares editoriales. Para la pizzería ensayá otra identidad, con rojo horno y nombres con carácter. Compartí la lógica y los componentes. En cocina, fondo neutro y números de mesa y cantidades protagonistas. En caja, alineá importes, reservá espacio para el saldo y verificá el formato ARS. Fotos del local o de prueba con licencia y copia local. El usuario configura su marca y puede publicar su carta aun sin fotos. Si hacés una página comercial, usá scrollytelling breve para mostrar pedido, cocina y cierre con el desplazamiento natural y una alternativa de movimiento reducido.

**Revisión visual obligatoria.** Tomá capturas de una primera implementación con los mismos datos que usarás al final. Probá carta, salón, cocina y caja a 360, 768 y 1440 px de ancho; verificá también el reflujo de las tareas principales a 320 px. Revisá manualmente la vista del dueño y el carrito con teclado móvil. Armá una lista de problemas observados y aplicá una segunda pasada para mejorar al menos tres aspectos concretos de la composición o el uso. Compará las tomas antes/después, explicá qué cambió y por qué. Comprobá contraste del texto normal de al menos 4,5 a 1, controles de uso frecuente de 44 × 44 px como objetivo propio y navegación por teclado. Probá nombres largos, ítems sin foto, error, agotados y hora pico. Guardá capturas reproducibles en el repositorio, preferentemente en `docs/visual/`, y documentá dispositivo, ancho y estado. Si una verificación visual no pudo correrse, informala como pendiente.

## 9. Arquitectura local y portable

- Implementá una web adaptable en React, TypeScript y Vite, un backend con Node.js y TypeScript y una base PostgreSQL. Podés elegir equivalentes gratuitos si simplifican el proyecto y mantenés la misma portabilidad. Serví la compilación y la API en el mismo origen en la instalación operativa.
- Entregá un arranque local documentado, configuración por variables de entorno, `.env.example` sin secretos, migraciones versionadas, inicialización segura del primer administrador, instrucciones de actualización y un contenedor o un Compose como alternativa cuando el entorno lo permita. El backend y la base quedan bajo control del instalador. Un equipo en la misma red puede abrir la aplicación usando la dirección local configurada. La carta pública fuera de esa red quedará disponible cuando Rubén publique el sistema.
- Guardá imágenes de forma persistente, con rutas configurables y compresión. Documentá cómo trasladar datos, archivos y configuración a otro entorno, y cómo conservar los QR si cambia la dirección pública. Podés mostrar un QR local para verificar el flujo y generar los definitivos cuando exista una dirección pública.
- Aplicá control de acceso en el backend para local, rol, datos y acciones. Mantené cuentas individuales, recuperación administrativa local y auditoría. Las sesiones deben admitir revocación. La carta pública solo recibe sus campos publicados.
- Para cocina y barra, usá sincronización del propio backend por eventos o consultas periódicas eficientes con recuperación al reconectar. Definí transacciones e identificadores de operación para stock, comandas, cobros y cierre. Las cantidades y los importes quedan confirmados por el servidor.
- Prepará exportación CSV y copia y restauración de PostgreSQL, fotos de carta y configuración. Probá la restauración con datos descartables. Documentá el arranque, el uso desde la red local y los requisitos genéricos de un futuro servidor. Rubén decidirá proveedor, dominio y fecha de publicación.

## 10. Alta y operación real

El primer administrador crea un restaurante vacío, carga nombre y marca, define mesas, sectores, carta y medios de cobro, y da de alta usuarios individuales. Puede incorporar un segundo local separado con su propio menú, empleados, stock y caja. Incluí importación CSV con vista previa y errores por fila. El equipo puede trabajar con la carta, la toma de pedidos, cocina, barra, retiro, delivery y caja configurados para su negocio.

Para el desarrollo y la aceptación, usá registros ficticios en una base separada y reiniciable, mediante un comando reservado al entorno de pruebas. Usá las mismas pantallas, rutas y reglas del producto. Probá el circuito de punta a punta desde dos sesiones y, si están disponibles, dos dispositivos. Los datos de producción deben sobrevivir al reinicio del servidor y se crean desde el alta real.

Medí en los ensayos el tiempo de toma a recepción de la comanda, la cantidad de duplicados y los minutos del arqueo. Registrá qué se pudo verificar y sus condiciones. El seguimiento con los restaurantes se hará al poner el sistema en funcionamiento.

## 11. Entregas y criterios de aceptación

| Entrega | Construcción | Qué demuestra que sirve |
|---|---|---|
| Núcleo operativo | Alta real, usuarios, carta/QR, salón, cocina, barra, agotados, cobro mixto y resumen. | Un dueño configura un local y completa el turno. Otro dispositivo ve los mismos pedidos y los datos sobreviven un reinicio. |
| Primer turno real | Roles individuales, apertura y arqueo, auditoría, mesas y pagos parciales, reintentos con mala señal, copia y recuperación, mostrador/retiro y delivery básico si el piloto lo usa. | El equipo puede tomar, preparar, entregar, cobrar y rendir un turno. El responsable ensayó qué hacer ante una caída de internet. |
| Segunda versión | Plantilla pertinente a cada piloto, comandas por tiempos, cupos de pedidos, reservas si hay demanda, recetas, costos y merma. | El dueño usa al menos una función para modificar una decisión concreta de compra, preparación o servicio. |
| Funciones avanzadas gratuitas | Fidelidad por adhesión, informes por sucursal y gestión de proveedores. | Cada función del alcance actual tiene su flujo operativo y pruebas. Las opciones con costo se documentan en FUTURAS-MEJORAS-PAGAS.md. |

Hacé pasar estas pruebas antes de considerar lista la etapa correspondiente.

- Una comanda con bebida y comida aparece una vez en cada sector correcto. Una aclaración y una corrección posterior se ven en la estación correspondiente.
- Dos mozos intentan vender la última porción al mismo tiempo. Se confirma una sola y el segundo recibe una alternativa. Repetir el envío confirmado no descuenta otra porción.
- Un mozo pierde señal después de enviar. Al volver recupera el resultado original. Una ronda aún local tiene un texto visible que lo advierte. Un cobro sin confirmación no se reintenta como un nuevo cobro.
- Tres comensales comparten un ítem de $10.000. Las partes suman exactamente $10.000. Un cobro mixto no confunde efectivo, transferencia, vuelto y propina. Un pago parcial deja el saldo correcto al mover o unir una mesa.
- Un cambio de precio modifica el menú manteniendo los precios de lo ya pedido. El cierre de un turno que cruzó medianoche se reconcilia con los cobros y el efectivo esperado.
- Un comensal puede ver la carta y el estado de su pedido. El rol de cocina no accede a caja. Las credenciales y links del local A no muestran movimientos, clientes ni costos del B.
- El cierre de la mesa vence su sesión de comensal. Un QR guardado no habilita pedidos en una visita posterior. La base de pruebas puede reiniciarse de forma independiente y un reinicio normal del servidor conserva los datos del negocio.
- Un pedido de retiro o delivery recibido y compartido por WhatsApp sigue teniendo un solo número y una sola comanda. El local confirma el plazo y el cliente puede verlo.
- Un dueño exporta el cierre y puede explicar cada diferencia. BM Dev puede restaurar la copia de prueba con sus imágenes. El proyecto corre en local con la base persistente y sin cuentas de terceros.
- La segunda pasada visual deja capturas comparables en celular, tableta y escritorio. En ellas se leen precios, modificadores y saldos, se distingue cada estado con texto y se puede completar cada acción principal con teclado y con el pulgar.

Entregá la aplicación operativa, código, migraciones, permisos, datos de prueba separados, instrucciones de arranque y traslado y pruebas repetibles. Empezá por el alta real y el turno de la mesa 4. Continuá con las etapas gratuitas hasta completar el alcance. Informá la dirección local verificada, las pruebas ejecutadas y cualquier bloqueo concreto.

## Referencias para las decisiones del proyecto

- Flujo de QR, mesa y cocina en Argentina. [Fudo](https://fu.do/es-ar/pedidos-qr/)
- Trabajo por estaciones y coordinación de tiempos. [Toast, configuración de cocina](https://support.toasttab.com/en/article/Basic-Kitchen-Configuration?lang=en_US) y [tiempos de preparación](https://support.toasttab.com/en/article/Item-Fire-by-Prep-Time)
- Reglas comerciales para pizza por mitades y empanadas. [Núcleo IT Gastronómico](https://nucleoit.com.ar/Software/Pizzeria-Empanadas)
- Popularidad y rendimiento de la carta. [Material alojado por la asociación empresaria gastronómica de Santa Fe](https://www.aehgsantafe.org.ar/info/immoog.pdf)
- Reservas por franja y lista de espera. [CoverManager](https://www.covermanager.com/campaign/barManager)
- Enlaces para enviar un texto desde el teléfono. [Ayuda de WhatsApp](https://faq.whatsapp.com/5913398998672934)
- Solicitar reseñas auténticas. [Google, enlace y QR](https://support.google.com/business/answer/16816815?hl=es-001) y [políticas de contenido](https://support.google.com/business/answer/7400114?hl=es-ES)
- Emisión de comprobantes en Argentina. [ARCA](https://www.arca.gob.ar/fe/emision-autorizacion/solicitud-autorizacion.asp)
- Referencias de accesibilidad para la revisión visual. [W3C, contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) y [tamaño de controles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
