# Arquitectura recomendada

## Aplicación local y portable

| Componente | Elección inicial | Función |
|---|---|---|
| Interfaz | React, TypeScript y Vite | Carta pública, salón, cocina, barra, caja y administración adaptados a celular, tableta y PC. |
| Servidor | Node.js con TypeScript o equivalente gratuito | API, sesiones, permisos por local y entrega del frontal compilado en el mismo origen. |
| Base | PostgreSQL | Persistencia, migraciones, restricciones y transacciones del negocio. |
| Sincronización | Eventos del servidor o consulta periódica | Cocina y barra reciben cambios de su estación y vuelven a cargar al reconectar. |
| Archivos | Directorio persistente configurable | Guardar fotos comprimidas y respaldarlas junto con la base. |
| Conectividad | Borrador local por usuario y visita | Conservar rondas pendientes con estado visible y recuperar confirmaciones por identificador. |
| QR y WhatsApp | Generación QR local y enlace de conversación | Usar la dirección configurada y abrir un texto preparado para que la persona lo envíe. |

## Instalación y operación

Entregar arranque local, variables en un archivo de ejemplo, migraciones, alta del primer administrador y opción de contenedores si está disponible. El sistema debe poder levantarse con la base vacía y permanecer accesible desde equipos autorizados de la misma red. Rubén elige proveedor, dominio y publicación más adelante. Documentar requisitos generales de servidor, base, disco persistente, proxy HTTPS y copias, sin vincular la aplicación a un proveedor.

El servidor valida restaurante y rol en cada operación. Comandas, stock, pagos y cierre se confirman en transacciones. La interfaz envía un identificador estable y, al reconectar, consulta el resultado antes de reintentar. El estado confirmado reside en la base. El entorno de pruebas puede cargar registros ficticios y reiniciarse con un comando que solo funcione con configuración de pruebas.

Entregar copia y restauración de base, fotos y configuración. Probar un cierre antes y después de restaurar. La dirección pública se configura para generar QR definitivos cuando Rubén elija dónde alojar el sistema. Conservar rutas estables y documentar cómo redirigirlas o volver a generar los QR si cambia el dominio.

El alcance actual usa los medios de cobro del comercio con registro manual y los equipos existentes. Las integraciones con costo quedan documentadas en el archivo de futuras mejoras.
