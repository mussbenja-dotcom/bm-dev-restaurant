# Requisitos no funcionales

Los valores de rendimiento de este documento son objetivos internos de aceptación para el piloto. Medir en condiciones indicadas y conservar los resultados.

| Área | Objetivo | Verificación |
|---|---|---|
| Costo | ARS 0 de servicios contratados para los dos pilotos, sobre equipos e internet existentes. | Verificar que la instalación local funcione sin servicios externos contratados ni credenciales de un proveedor. |
| Velocidad | Carta legible y primera acción disponible en hasta 3 segundos como meta inicial de laboratorio. | Tres cargas en frío en un perfil móvil y red 4G simulada. Registrar la mediana y la configuración. Las fotos exteriores a la vista se difieren. |
| Sincronización | Una comanda confirmada aparece en el otro dispositivo en hasta 2 segundos como objetivo en una conexión estable. | Medir desde la respuesta de confirmación hasta el primer render de cocina. Registrar condiciones y peor resultado del ensayo. |
| Integridad | Un reintento produce el mismo resultado y dos clientes compitiendo por la última unidad obtienen una confirmación. | Ejecutar los casos de carreras y caída de señal del archivo 11. |
| Accesibilidad | Texto normal con contraste de al menos 4,5 a 1, controles frecuentes de 44 × 44 px como objetivo propio, foco visible y navegación por teclado. | Medir contraste, completar una comanda con teclado y revisar carta y caja con zoom y ancho de 320 px. |
| Seguridad | Acceso por persona y local, privilegios mínimos y registros de movimientos sensibles. | Verificar permisos en servidor, base, archivos y actualizaciones en vivo con dos locales de prueba. |
| Privacidad | La carta pública tiene datos públicos. El contacto y domicilio de entrega se limitan a los roles y al tiempo necesarios. | Revisar campos públicos, acceso por visita, exportación y eliminación de datos accesorios. |
| Continuidad | Borrador conservado ante un corte. Órdenes transmitidas y pendientes distinguibles. | Perder señal antes y después de confirmar, reabrir y reconciliar. Ensayar con el equipo la vuelta temporal al papel. |
| Recuperación | Objetivo del piloto de una copia por turno operativo en un equipo existente. | Copiar base y fotos por separado, cifrar y ensayar la restauración con datos ficticios antes del primer turno real. Registrar fecha y pérdida máxima esperada. |
| Mantenimiento | Entorno local reproducible, migraciones versionadas y errores explicables por número de operación. | Ejecutar una instalación limpia, cargar semilla y seguir los pasos desde un equipo distinto. |

## Costo y privacidad por diseño

Comprimir imágenes al cargarlas. Suscribirse a cambios solo mientras la pantalla esté activa. Limpiar archivos temporales y monitorear almacenamiento, CPU y memoria antes de ampliar el uso. Mantener una salida manual para el restaurante.

## Calidad visual

La revisión tiene dos pasadas y una comparación antes/después. Aplicar el protocolo del documento 08 y asociar sus resultados con los casos del 11. La accesibilidad forma parte de la interfaz desde el principio. [W3C, contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) y [reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
