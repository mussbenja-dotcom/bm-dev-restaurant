# Pruebas ejecutadas (21/11/2026)

Todas se ejecutaron en esta computadora, sobre PostgreSQL en memoria (`npm test`) o sobre la base descartable `data/test-e2e` en el puerto 4300 (Playwright). Ninguna tocó `data/prod` ni `data/local` (la base del 4100).

## Verificación estática y dependencias

| Comando | Resultado |
|---|---|
| `npx tsc -p tsconfig.json` (modo estricto, servidor + interfaz + tests) | Sin errores |
| `npm run build` (Vite) | Compila; JS principal 286 KB (92 KB gzip), cada pantalla se carga aparte |
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| `npm run lint` (oxlint 1.94, `--deny-warnings`; reglas en `.oxlintrc.json` y motivos en DECISIONES) | Sin errores ni advertencias |
| `impeccable detect` sobre las pantallas rediseñadas | Sin hallazgos (`[]`) |

## Integración (`npm test`): 88 de 88 en verde

- **D01–D04 · QR dinámicos y eventos en vivo (`qr-dinamicos.test.ts`):** validación de enlaces (solo `https`; reseñas solo de hosts de Google; rechaza `javascript:`, `ftp:`, rutas relativas y claves como `constructor`); detección de direcciones de red local. QR de la mesa 2: por defecto 302 `no-store` a `/mesa/<código>`; «reservar» conserva la mesa (`/reservar/esquina?mesa=<código>`); enlace externo; un enlace pegado con salto de línea o con acentos se guarda normalizado y redirige bien. Otro local: 404; mozo: 403; sin sesión: 401. Con el código del mozo, el pedido entra en la cuenta de la mesa 2 y el aviso va a mozo1. Reseñas: el mismo código lleva al enlace guardado en cada momento; sin enlace, a la carta; un enlace que no es de Google se rechaza también desde Horarios y cobros. Revocar sesiones corta el stream en vivo en menos de 1 s (sin esperar el ping). Separar una mesa avisa solo a la estación de lo movido.

Nuevos en la etapa de pedidos por QR (`tests/qr-pedidos.test.ts`, `tests/money.test.ts`):
- **Q01 · Pedido por QR autorizado por el mozo (mesa 1):** sin habilitar se ve la carta pero no se envía, ni siquiera con un código anterior; cocina no puede habilitar. Con el código: comida a cocina, bebidas a barra, cuenta de la mesa marcada como QR (`source = diner`), aviso al mozo asignado. Doble envío: una sola comanda. Segundo celular y segunda ronda. Reasignar la mesa: el aviso va al mozo nuevo, y el anterior ya no puede cortar el QR. Precio cambiado o plato agotado: 409 con qué cambió, sin comanda. Código de otra mesa: rechazado. Deshabilitar revoca los celulares; el QR sigue mostrando la carta; el código viejo no sirve. Cerrar la cuenta revoca todo y la visita siguiente requiere habilitar de nuevo. Local en modo «solo carta»: no se puede habilitar.
- **Q02 · Combos con elección:** solo platos simples del mismo local; un plato normal no puede tener opciones-plato. Ahorro con la opción más barata. El mozo y el cliente eligen; cada parte va a su estación y el total es el del combo (+ adicional). Elegido agotado: 409. Los combos fijos siguen igual.
- **Q03 · Totales:** descuento dentro del límite y por encima del saldo (409). Anular después de un descuento: Salón, Caja, precuenta y resumen del turno dan lo mismo y el ticket muestra el renglón «Ajuste». Cobro dividido en 3 con vuelto, intento de cobrar de más (409), cierre, ticket = total. Reimprimir no crea cobros. Cambiar el precio no altera lo pedido.
- **Q04 · Registro de ingresos:** nunca se guarda la contraseña ni el PIN; el dueño ve los de su equipo y no los de otro local ni emails ajenos; el mozo recibe 403; purga a los 30 días; 5 fallos bloquean y queda registrado.
- **Q05 · Eventos en vivo:** por rol, estación y local (`eventFor`); por HTTP real el mozo recibe su aviso, cocina y otro local no, también al reconectar; no se reenvían datos internos (`toUser`).
- **Q06 · Regresiones de la revisión:** el código vigente solo lo ven el mozo a cargo, quien ve todas las mesas y el dueño (caja y pase no). Dos envíos simultáneos del mismo pedido con la última porción: una comanda y ningún «se agotó» falso. Una mesa trabada por códigos errados se destraba al renovar el código. Modo «llamados»: se llama pero no se pide. Tope de 30 ingresos por IP en 10 min.
- **División por persona/ítem (`splitShares`):** un ítem sin asignar no se le cobra a nadie; con todo asignado las partes suman el total del servidor.

Etapa anterior:

Nuevos en esta etapa (`tests/personalizar.test.ts`, `tests/color.test.ts`):
- **Marca:** el borrador no se ve hasta publicar. Después se ve en el enlace y en el QR (mismo slug y mismo token).
- **Fotos:** se valida que sea una imagen real (un SVG o GIF declarado como PNG se rechaza), se comprime a WebP y se quita el EXIF. Al reemplazarla o quitarla se borra el archivo.
- **Precios:** un cambio de precio rige desde la publicación; las líneas ya pedidas conservan su precio y queda auditado.
- **Platos nuevos:** quedan ocultos hasta publicar y no se pueden pedir, tampoco como mitad de pizza. Descartar los elimina.
- **Carta:** ordenar y ocultar. Una categoría oculta y publicada no acepta pedidos.
- **Aislamiento:** con dos locales, un dueño solo edita el suyo (404 si toca el otro). El mozo recibe 403 y el anónimo 401.
- **Combos:** se muestra el ahorro, cada plato va a su estación y la suma da el precio. Si falta un componente, se informa como el combo. Un componente no puede convertirse en combo.
- **Publicar la marca** no pisa lo que se cambió después en Configuración.
- **PIN fallido:** se audita sin guardar el PIN.
- **Traspaso de mesa:** solo entre mozos activos del local, con permiso y en visitas abiertas.
- **Contraste:** el color de la marca se ajusta a 4,5:1 o más sobre cada fondo.

Las pruebas corren contra PostgreSQL real (PGlite) en memoria, con los datos ficticios de los dos locales.

| Caso | Qué se comprueba |
|---|---|
| A01 | Mesa 4: comanda con nota a cocina y bebidas a barra. La vista de estación muestra solo el sector propio; el pase muestra todo. Cada sector marca listo, el mozo entrega y otro dispositivo ve el estado. |
| A02 / A03 / A04 | Última porción: solo un mozo la obtiene. Doble toque: una sola ronda. Reintento tras un corte: se recupera sin duplicar. |
| A05 | QR + código temporal. Los llamados se agrupan. El acceso vence al cerrar la mesa y no sirve para la visita siguiente. |
| A06 | Un cambio de precio no altera lo ya enviado. |
| A07 / A09 | Pago parcial, mover y unir mesas. |
| A08 / A10 / A19 | Cobro mixto, ticket X con la leyenda y caja que cruza la medianoche. |
| A11 | Aislamiento entre locales y por rol. |
| A13 / A14 | Franjas de retiro llenas que ofrecen la siguiente. Pizza por mitades con extras. Docena por gustos. |
| A15 | Receta y margen con costo histórico. |
| A20 | Repartidor sin datos: sincronizar dos veces aplica una sola vez. Un pedido reasignado avisa. |
| Reservas | El último cupo lo obtiene una sola persona. |
| Alta real | Código de instalación de un solo uso. |
| Regresiones de la revisión | Un dueño no puede tomar la cuenta de plataforma. El código de mesa y el PIN de supervisor se bloquean a los 5 intentos. Anular una línea con cortesía quita la cortesía. No se entrega una línea anulada. No se cancela un pedido cobrado. Cancelar devuelve stock con su movimiento. Aceptar un pedido web conserva el precio confirmado. Un cambio inválido del repartidor no traba su cola. |
| Dinero (`money.test.ts`) | Partes iguales al centavo, reparto por ítem y reparto proporcional de envío y descuentos, vuelto y efectivo esperado, mitades, margen. `parseArs` acepta «8.000» y «8.000,50». |

## Navegador (Playwright, Chromium): 13 de 13 en verde (+ 12 de capturas, a pedido)

`npm run build && npx playwright test`. Usa el puerto 4300 con su propia base (`data/test-e2e`): el 4100 y `data/local` quedan intactos (verificado: un plato con foto creado en el 4100 sigue igual después de reiniciar el servidor y de correr todas las pruebas).

| Prueba | Resultado |
|---|---|
| `resenas-y-carteles`: **carteles QR descargados desde el panel** | Configuración → Mesas → «Descargar PNG» de la mesa 2 baja `carta-qr-mesa-2.png` (1240×1748, A6 a 300 ppp). Se lee el QR del archivo (se ubica el código, se mide el módulo con el patrón de esquina, se muestrea cada módulo y se exige el margen blanco de 4 módulos) y coincide módulo por módulo con `<base>/q/<código de la mesa 2>`; esa dirección redirige a la carta de la mesa 2. Códigos QR: aviso «Prueba en red local», vista previa y `resenas-qr-esquina.png`, que codifica `<base>/q/resenas/<código>` y lleva al enlace de Google cargado. Un enlace que no es de Google se rechaza en el panel; al guardar uno nuevo, **el mismo PNG** lleva al enlace nuevo. Con el QR de la mesa 2, un celular entra a la carta de la «Mesa 2», pide con el código del mozo, el mozo ve «Pidió por QR» y la gaseosa queda en la cuenta. Sin errores de consola ni de red. Carteles y captura del panel en `docs/visual/carteles/`. |
| `smoke`: 32 pantallas internas (dueño, mozo, cocina, repartidor, BM Dev) y 4 públicas | Sin errores de JavaScript ni respuestas 4xx/5xx inesperadas |
| `turno`: **turno completo con 4 sesiones en contextos separados** | Mesa 3 → Flan a cocina y Gaseosa a barra; cada sector ve solo lo suyo → listo → precuenta con «DOCUMENTO NO VALIDO COMO FACTURA» → cobro en 2 partes iguales (efectivo con vuelto + transferencia verificada) → ticket interno X → arqueo con diferencia $ 0 y cierre → la mesa queda para limpiar |
| `ultima-porcion`: dos mozos en dos navegadores | Uno obtiene el último vacío; el otro ve la explicación, conserva el resto de la ronda y la reenvía; el plato figura agotado |
| `personalizar`: **flujo completo del dueño** | Desde un celular (Pixel 7): Panel → Personalizar, sube el logo, elige color y fondo blanco, guarda. En Carta: sube la foto de la milanesa y cambia el precio a $ 15.000. Un anónimo todavía ve $ 14.500. En la vista previa del celular aparecen el precio nuevo y el logo. Publica. **Otro navegador abre el QR impreso de la mesa 4** y ve el fondo blanco, el color, el logo (cargado), la foto y $ 15.000. El mozo pide la milanesa a $ 15.000, cocina la ve y la marca lista, y caja cobra $ 15.000 en efectivo, con saldo cero. Sin errores de consola ni de red en las 5 sesiones. |
| `qr`: **pedido por QR de punta a punta** (mozo en escritorio, dos celulares Pixel 7) | Mesa 1 abierta por mozo1. El celular arma el carrito y no puede enviar («Tu mozo todavía no habilitó»). El mozo toca «Habilitar pedidos por QR» y ve el código; el celular se entera en vivo. Código de otra mesa: «Código incorrecto». Con el código correcto: «Pedido enviado · Comanda N». El salón del mozo muestra «Pidió por QR · Comanda N» con «Ver pedido», que abre la mesa. Cocina ve la milanesa, barra solo la gaseosa. Segundo celular: dos rondas más; al mozo le aparece el aviso en vivo arriba de la pantalla. Plato agotado entre armar y enviar: se informa antes de confirmar. Deshabilitar: el celular vuelve a pedir código y sigue viendo la carta. Capturas en `docs/visual/qr/`. |
| `qr`: **carta pública en 320, 360, 768 y 1440** | Sin desplazamiento horizontal; ningún plato fuera de pantalla; el nombre no se comprime; «Agregar» cerca del nombre; en escritorio la carta clásica va en dos columnas (tarjetas de menos de 600 px). Cubre nombres largos, plato agotado, con y sin foto. |
| `reparto`: **repartidor sin datos** | Delivery asignado y despachado. El repartidor abre su panel con Wi-Fi, pasa a modo avión, cierra el panel y lo vuelve a abrir (lo sirve el service worker con la copia guardada), registra «Entregado», vuelve la señal y sincroniza solo. Repetir la sincronización devuelve «duplicado» y la auditoría tiene una sola entrega. |
| `turno` (agregado) | Reimprimir el ticket X como copia no genera un cobro nuevo. |
| `personalizar` (agregado) | Quitar la foto del plato y publicar: la carta lo muestra completo, sin imagen. |
| `visual` (solo con `VISUAL_OUT=antes` o `despues`): capturas en 360/768/1440 + 320 px | 0 px de desplazamiento horizontal en 320 px en todas las pantallas (ver `docs/visual/COMPARACION.md` y `docs/visual/rediseno/COMPARACION.md`) |

## Operación (ejecutado a mano, con su salida real)

| Caso | Pasos | Resultado |
|---|---|---|
| A12 · persistencia | Crear la categoría «Persistencia A12» → detener el servidor → arrancarlo de nuevo → `GET /api/menu` | La categoría sigue ahí |
| A16 · copia y restauración | `npm run backup` → `test:reset` (la categoría desaparece: 0) → `npm run restore` | La categoría vuelve (1); 2 locales |
| Copia dañada | `restore` desde un `pgdata.tar.gz` inválido | «No se pudo restaurar; los datos anteriores quedaron como estaban». Los datos siguen intactos |
| Protección del reset | `APP_ENV=production npx tsx scripts/test-reset.ts` | «Rechazado…», exit 1, no toca nada |
| Recuperación de clave | `npm run reset-password -- mozo2@esquina.test …` | «Clave actualizada… Sesiones anteriores revocadas» |
| HTTPS en la red | `npm run cert` y arranque con `HTTPS_KEY`/`HTTPS_CERT` | `https://localhost:4100/api/health` responde `{"ok":true}`; el certificado cubre la IP del local |

## Errores encontrados por las pruebas y corregidos

1. La cocina con rol de pase veía las bebidas de barra en su pantalla (E2E). Ahora la vista de estación muestra solo su sector. Agregué un test de regresión en A01.
2. «Partes iguales» dividía el saldo en vez del total: la segunda persona pagaba de menos (E2E). Ahora se divide el total y se descuenta lo ya pagado.
3. El servidor no servía archivos nuevos después de recompilar (devolvía HTML en lugar de JS). Ahora los sirve, y un recurso inexistente devuelve 404.
4. `restore` fallaba al crear la carpeta y dejaba el sistema vacío. Ahora crea la carpeta y, si algo falla, vuelve a poner los datos anteriores.
5. La hora se mostraba en formato 12 h («04:47 p. m.»). Ahora es 24 h.
6. Más los hallazgos de la revisión independiente (ver abajo).

## Revisión independiente (agentes bmdev-code-reviewer y bmdev-security-auditor)

Cada agente revisó el código y después re-verificó las correcciones leyendo el código actual. El auditor además corrió PoC contra una base en memoria.

| Hallazgo | Severidad | Estado verificado |
|---|---|---|
| Un dueño podía vincular la cuenta de plataforma y restablecerle la clave (toma total) | CRÍTICO | Corregido + test |
| Fuerza bruta del código de 4 dígitos de la mesa | ALTO | Corregido: 5 fallos por IP y visita, tope global por visita; un ex-comensal ya no bloquea la mesa |
| Fuerza bruta del PIN de supervisor | ALTO | Corregido: 5 fallos bloquean 15 min (probado también con 60 pedidos en paralelo) + test |
| Ronda pendiente duplicable al agregar platos antes de reintentar | BLOQUEANTE | Corregido: el borrador queda fijo hasta confirmar |
| «Entregar» reactivaba una línea anulada | BLOQUEANTE | Corregido + test |
| Cola del repartidor pisada; cambio inválido perdido | IMPORTANTE | Corregido: queda en el teléfono con el error para corregirlo + test |
| Descuentos huérfanos al anular o separar; doble cortesía | IMPORTANTE | Corregido + test |
| División por persona/ítem ignoraba descuentos y envío | IMPORTANTE | Corregido (reparto proporcional al centavo) + test |
| Pedido web recalculado al aceptar | IMPORTANTE | Corregido: conserva el precio confirmado + test |
| Cancelar o rechazar un pedido cobrado; cancelar sin devolver insumos | IMPORTANTE | Corregido + test |
| Propina ilegible descartada en silencio | IMPORTANTE | Corregido |
| CSV con fórmulas «-1+…» | MEDIO | Corregido |
| Sin límites en endpoints públicos | MEDIO | Parcial: límite por IP en POST públicos; ver pendientes |
| Menores (refund idempotente, 5xx, parseArs «8.000», >40 ítems, revocar sesiones del dueño, reset de plataforma sin motivo, etc.) | MENOR/BAJO | Corregidos |

### Segunda revisión (Personalizar, combos, rediseño): sin bloqueantes

| Hallazgo | Severidad | Estado |
|---|---|---|
| Se podían pedir platos en borrador: desde el salón, como «otra mitad» en el pedido web o dentro de un combo creado por la API vieja | MEDIO (seguridad) | Corregido en `priceSelection` + test |
| Imágenes: sin tope de píxeles y con el formato declarado por el navegador | MEDIO (seguridad) | Corregido: tope de 40 MP y el formato se detecta por contenido + test |
| Código de mesa de 4 dígitos adivinable rotando IPs | MEDIO (seguridad) | Corregido: 6 dígitos, además de los topes que ya existían |
| Publicar la marca pisaba cambios hechos después en Configuración | MEDIO | Corregido: el borrador guarda solo las diferencias + test |
| Un combo con un componente agotado no salía de la ronda | MEDIO | Corregido: se informa con el id del combo + test |
| `useLoad` mostraba respuestas viejas al cambiar de cuenta o estación; Caja podía cobrar con el saldo anterior | MEDIO | Corregido: el resultado queda atado a sus parámetros y se descartan respuestas viejas; `key` por cuenta |
| `TRUST_PROXY=1` no confiaba en un proxy local por IPv6 | MEDIO | Corregido: `loopback` |
| Carrera entre guardar la marca o la foto y subir una imagen | MEDIO | Corregido: transacción con `FOR UPDATE`; los archivos se borran después del commit |
| Categoría oculta que seguía aceptando pedidos | MEDIO | Corregido + test |
| Ruta vieja de foto sin validación; combos anidados por la ruta vieja; `paper` con claves del prototipo; mozo inactivo en el traspaso; HSTS detrás de un proxy; formulario de marca que no se recargaba al descartar; cantidad NaN; doble clic al traspasar; falla de auditoría del PIN descartada en silencio | BAJO/MENOR | Corregidos |
| Re-revisión de las 3 correcciones anteriores (código de mesa por IP, `TRUST_PROXY`, cambio del repartidor) | — | Correctas; `TRUST_PROXY` se ajustó (ver arriba) |

### Tercera revisión (pedidos por QR, combos con elección, totales, ingresos, eventos en vivo)

| Hallazgo | Severidad | Estado |
|---|---|---|
| La división «Por ítem» le cobraba a los asignados los ítems que nadie tomó | BLOQUEANTE | Corregido: `splitShares` calcula lo general sobre todas las líneas; si falta asignar, la suma no llega al total y se avisa + test |
| El chequeo de cambios del pedido por QR corría fuera de la transacción: un reintento simultáneo podía ver un «se agotó» falso | IMPORTANTE | Corregido: idempotencia, cambios y habilitación se revisan dentro de la transacción con la visita bloqueada + test concurrente |
| Un pedido en vuelo entraba aunque el mozo acabara de deshabilitar el QR | IMPORTANTE | Corregido: se revalida `qr_enabled` y la sesión del celular con la visita bloqueada |
| En modo «llamados» la mesa no podía llamar sin «habilitar pedidos» | IMPORTANTE | Corregido: el mismo control dice «Habilitar llamados por QR» + test |
| Caja, pase o un mozo ajeno podían leer el código vigente | IMPORTANTE (seguridad) | Corregido: solo el mozo a cargo, quien ve todas las mesas y el dueño/encargado + test |
| Se podía trabar una mesa ajena con códigos errados desde muchas IP | IMPORTANTE (seguridad) | Corregido: el tope por visita depende de la habilitación vigente; renovar el código la destraba + test |
| Sin tope de ingresos por IP (probar muchas cuentas), tabla y memoria crecían | IMPORTANTE (seguridad) | Corregido: 30 intentos por IP cada 10 min (no se registran los rechazados por ese tope) y tope duro del mapa en memoria + test |
| Intento «bloqueado» sin persona; ex-empleados en la auditoría | MENOR | Corregido + test |
| Comensal de un local suspendido o mesa inactiva; sesión sin vencimiento en la base | MENOR | Corregido: se exige local activo, mesa activa y sesión de menos de 12 h |
| Eventos de cocina sin estación (marchar, nota, anular, asiento) llegaban a barra | MENOR | Corregido: llevan su estación |
| Opciones del combo separadas por nombre; mensaje de agotado duplicado; resumen del turno sin tope; `key` del aviso | MENOR | Corregidos |

### Cuarta revisión (QR dinámicos, carteles, corte de eventos, separación de datos)

| Hallazgo | Severidad | Estado |
|---|---|---|
| Un error de base durante el control inmediato de sesión podía dejar una promesa rechazada sin capturar (y tirar el proceso) | IMPORTANTE | Corregido: el control captura el error y corta el stream; el navegador reconecta |
| Un destino externo se guardaba sin normalizar: un salto de línea pegado o un dominio con acentos dejaba el QR en error 500 | MEDIO | Corregido: se guarda la forma canónica; prueba de regresión |
| `constructor`/`toString` pasaban como destino interno | MEDIO | Corregido (`Object.hasOwn`); prueba de regresión |
| Hosts «google.<cualquier cosa>» aceptados; `http:` en destinos externos | BAJO | Corregido: lista cerrada de Google y solo `https` |
| Token de reseñas de locales nuevos con `random()` de PostgreSQL | BAJO | Corregido: lo genera la aplicación con `randomBytes` |
| Cambiar el tipo de una estación no recalculaba al instante; suspender un local despertaba todas las conexiones | BAJO | Corregido: aviso interno acotado al local |
| QR inexistente mostraba JSON; formulario general podía pisar el enlace de reseñas recién guardado; ruta `/q/:qr` del cliente sin uso | MENOR | Corregidos |

### Pendientes cerrados en esta fase

- Separar una mesa avisa solo a las estaciones de lo que se movió.
- Revocar sesiones o cambiar roles, membresía, local de la sesión o estado del local corta los eventos en vivo al instante.
- Una revalidación fallida al publicar dice qué plato falló.
- El servidor avisa al arrancar si `PUBLIC_URL` es https y falta `TRUST_PROXY`, y si los carteles usan una dirección de red local.
- Un plato oculto dentro de un combo queda permitido a propósito (DECISIONES).
- Las pruebas ya no pueden borrar la base del 4100 (`data/local`).

### Quedó pendiente

- El enlace «reservar» lleva la mesa (`?mesa=`), pero la página de reservas todavía no la muestra ni la usa.
- La lectura del QR en las pruebas compara la grilla del PNG con la dirección esperada; no es un decodificador independiente (no hay uno instalado y no se agregaron dependencias).
- **Requieren equipo físico** (solo se probó en emulación de Chromium): escanear los carteles impresos (mesa y reseñas) con la cámara de iPhone y Android, en papel y a distintas distancias; imprimir los carteles A6 en la impresora del local y comprobar el tamaño y el contraste; pantalla de cocina a distancia; modo avión real del repartidor con datos móviles; impresión en impresora térmica de 58/80 mm; Personalizar desde el teléfono del dueño con fotos de su galería.
- **Requieren decisión del dueño:** hosting y dominio; luego `PUBLIC_URL`, `TRUST_PROXY` y descargar los carteles definitivos (INSTALACION → «Carteles definitivos»).
