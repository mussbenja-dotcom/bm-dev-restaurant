# Instalar, arrancar y trasladar BM Dev Restaurant

Todo es gratuito y corre en una sola computadora del local. No hay cuentas externas ni claves de servicios pagos.

## Requisitos

- Node.js 22 o superior (probado con Node 24) y npm.
- Windows, macOS o Linux. Al menos 2 GB de RAM libres y 1 GB de disco.
- No hace falta instalar PostgreSQL. El sistema trae PostgreSQL embebido (PGlite) y guarda los datos en `data/`.

## Primer arranque (local real)

```bash
npm install
npm run build          # compila la interfaz en dist/web
npm start              # http://localhost:4000 y la dirección en la red del local
```

La consola muestra un **código de instalación de un solo uso**. Abrí `http://localhost:4000/alta`, ingresalo y creá el primer administrador. Desde **Superadmin** (`/superadmin`) se dan de alta el restaurante y su dueño. El dueño carga la carta, las mesas y el equipo desde **Configuración**, guiado por la lista de alta.

### Cuenta de Superadmin (plataforma BM Dev)

No hay credenciales escritas en el código. Hay dos formas de crearla:

- **Comando de instalación**, con el servidor detenido: `npm run superadmin -- tu@email.com "Tu nombre"`. Imprime un enlace de activación de un solo uso que vence en 24 h; ahí definís tu contraseña. Si preferís fijarla desde la consola, agregá la variable `SUPERADMIN_PASSWORD` (solo en la terminal, nunca en un archivo). Si el email ya tiene cuenta, se la promueve a Superadmin sin cambiar su contraseña.
- **Variables de entorno privadas** al arrancar: `SUPERADMIN_EMAIL` (y opcionalmente `SUPERADMIN_NAME` y `SUPERADMIN_PASSWORD`). El servidor solo **crea** la cuenta si no existe y muestra el enlace en la consola. No promueve ni reactiva cuentas existentes: para eso está el comando. Si los registros del servidor los ve otra persona (por ejemplo, en un hosting), usá `SUPERADMIN_PASSWORD` o el comando, y quitá la variable después del primer arranque.

El comando se niega a correr si detecta el servidor encendido en ese puerto. Una cuenta de Superadmin no puede ser dueña de un local, y los enlaces de local que tuviera pendientes dejan de servir al promoverla.

El panel está en `/superadmin`. Desde **Restaurantes** se buscan, filtran, crean, suspenden, envían a la papelera, restauran y eliminan definitivamente los locales; **Historial** registra quién hizo cada acción y cuándo. Al crear un local se genera un enlace de activación para el dueño (un solo uso, 7 días). Si el dueño ya tenía cuenta, recibe una invitación y conserva su contraseña.

Los celulares y tablets del local entran con la dirección «En la red» que muestra la consola (por ejemplo `http://192.168.1.18:4000`). Tienen que estar en el mismo Wi-Fi.

## Base de prueba (datos ficticios, separada)

```bash
npm run start:local    # http://localhost:4100 con data/local: datos de prueba que se conservan
npm run test:reset     # borra y recarga SOLO data/test (se niega a correr fuera de APP_ENV=test)
npm run start:test     # http://localhost:4100 con data/test (base que se puede reiniciar)
```

`data/local` es la base de prueba de uso diario: ningún comando de pruebas la borra (el reinicio exige que la carpeta se llame «test»). Las pruebas automáticas usan su propia base en memoria (`npm test`) o `data/test-e2e` en el puerto 4300 (Playwright).

Usuarios: `dueno@`, `mozo1@`, `mozo2@`, `cocina@`, `barra@`, `caja@`, `reparto@` con `esquina.test`. Además, `dueno@`, `mozo@` y `caja@` con `fuego.test`, y `admin@bmdev.test`. Todos usan la clave `prueba1234`. El PIN de encargado es `1234`.

Cartas públicas: `/m/esquina`, `/m/fuego`. QR de la mesa 4: `/q/mesa4-esquina-demo`.

**Pedidos por QR:** el QR de cada mesa muestra siempre la carta y deja armar el carrito. Para enviar, el mozo a cargo abre la mesa y toca **Habilitar pedidos por QR**: aparece un código de 6 números que les dicta a los comensales. Cada celular lo ingresa una vez por visita y puede mandar varias rondas; el mozo recibe un aviso por cada comanda. «Deshabilitar» o cerrar la cuenta revoca el código y los celulares. El modo se elige en Configuración: «Solo carta», «Llamados» (el código sirve para llamar al mozo) o «Pedidos» (valor inicial de los locales nuevos, salvo rotisería).

## Pruebas

```bash
npm run typecheck
npm test                         # integración contra PostgreSQL en memoria
npm run build && npx playwright test   # E2E en el navegador: puerto 4300 y base propia (data/test-e2e); no toca el 4100
```

## HTTPS en la red del local (opcional)

Algunas funciones del navegador (instalar como app y modo sin conexión) piden HTTPS.

```bash
npm run cert           # certificado autofirmado gratis para la IP del local, en certs/
```

Después agregá a `.env` (copiá `.env.example`):

```
HTTPS_KEY=./certs/key.pem
HTTPS_CERT=./certs/cert.pem
```

Cada dispositivo muestra una advertencia la primera vez. Con un dominio real conviene usar Let's Encrypt, que también es gratis.

## Personalizar mi restaurante

Ingresá como dueño o encargado y entrá por **Panel → Personalizar mi restaurante** (en el celular: «Más» → Personalizar) o directamente a `/app/personalizar`. Ahí podés cambiar:

- **Marca:** nombre, logo, portada, estilo de carta (Clásica o Moderna), color, fondo y contacto.
- **Carta:** categorías y platos (ordenar, ocultar, editar, precios, variantes, extras, fotos y combos).

Los cambios quedan en borrador. Revisalos en «Vista previa» y tocá **Publicar cambios**: se actualizan el mismo enlace y los QR ya impresos.

Horarios de pedidos, medios de cobro, mesas, sectores, retiro y zonas de delivery están en **Configuración**.

### Fotos
- Se guardan en `data/<entorno>/uploads/<id del local>/`, en formato WebP comprimido y sin datos de ubicación.
- `npm run backup` las incluye en la carpeta `uploads`, y `npm run restore` las devuelve.
- Para mudarlas a mano, copiá la carpeta `data/<entorno>/uploads` completa con el servidor detenido.

## Copias de seguridad

```bash
npm run backup                              # crea backups/production-<fecha>/ (base, fotos y .env)
npm run restore -- backups/<carpeta>        # con el servidor detenido
```

La restauración aparta los datos actuales en `data/prod.antes-<fecha>`. Si la copia está dañada, deja todo como estaba. Recomendación: hacer una copia al cerrar la caja y guardarla fuera de la computadora (pendrive o nube personal). La copia incluye `.env`.

Si se olvida una clave: el dueño la restablece desde **Configuración → Equipo**. Si el olvido es del dueño: `npm run reset-password -- <email> <clave-nueva>` en la computadora del local (cierra sus sesiones).

## Trasladar a otra computadora o a un servidor

1. Hacé `npm run backup` en la máquina vieja. También alcanza con copiar la carpeta `data/` con el servidor detenido.
2. En la nueva, copiá el proyecto y ejecutá `npm install` y `npm run build`.
3. Ejecutá `npm run restore -- <carpeta de copia>` (o pegá `data/`) y copiá `.env`.
4. Ejecutá `npm start`.

En un VPS Linux, el mismo procedimiento funciona tal cual. Para que arranque solo, usá `systemd` o `pm2` (gratis) y ubicá un proxy con HTTPS delante (Caddy o nginx + Let's Encrypt). Con proxy, agregá `TRUST_PROXY=1` (proxy en el mismo servidor; o la IP del proxy) y `HOST=127.0.0.1` en `.env`: así los límites de intentos usan la IP real de cada cliente y la cookie de sesión sale como segura.

## Carteles QR (carta de cada mesa y «Puntuanos en Google»)

Los carteles se descargan en PNG listos para imprimir (A6, 300 ppp):

- **Mirá nuestra carta · Mesa N · Sector:** en **Configuración → Mesas y sectores** («Descargar PNG» de cada mesa) o en **Configuración → Códigos QR**. Archivo `carta-qr-mesa-N.png`.
- **Puntuanos en Google:** en **Configuración → Códigos QR**. Uno solo por local, sirve para todas las mesas. Archivo `resenas-qr-<local>.png`.

Cada cartel apunta a una dirección fija del sistema (`/q/<código>` o `/q/resenas/<código>`). El destino se cambia en **Configuración → Códigos QR** y el mismo cartel impreso lleva al destino nuevo en el próximo escaneo:

- **Mesa:** carta de la mesa (por defecto; con el código del mozo se puede pedir), reservas del local (conserva la mesa en el enlace) u otro enlace externo (solo consulta: no identifica la mesa ni permite pedir).
- **Reseñas:** el enlace directo de Google que pegue el dueño o encargado (Perfil de Empresa → «Pedir reseñas»). Sin enlace, el panel muestra «Falta cargar el enlace de reseñas» y el QR abre la carta del local.

Solo el dueño o el encargado del propio local pueden ver y cambiar estos destinos; cada cambio queda en Auditoría.

## Carteles definitivos y cambio de dirección o dominio

Mientras `PUBLIC_URL` sea `localhost` o una IP de la red (192.168…, 10…, 172.16–31…), el panel marca los carteles como **«Prueba en red local»**: solo funcionan con el celular conectado al Wi-Fi del local. Para generar los definitivos:

1. Elegí hosting y dominio, y publicá la app con HTTPS (ver «Trasladar a otra computadora o a un servidor»).
2. Definí la dirección pública en `.env`: `PUBLIC_URL=https://tu-dominio` (y `TRUST_PROXY=1` si hay un proxy o túnel delante; el servidor avisa al arrancar si falta).
3. Reiniciá el servidor y comprobá en **Configuración → Códigos QR** que ya no aparece «Prueba en red local».
4. Descargá de nuevo los carteles de las mesas y el de reseñas, y probalos con «Probar» antes de imprimir.

Los códigos de cada mesa y el de reseñas no cambian: solo cambia el dominio impreso. Después de imprimir los definitivos, los destinos se cambian desde el panel sin reimprimir. Si más adelante cambia el dominio, hay que reimprimir (el dominio está en el cartel).

## Base PostgreSQL externa (DATABASE_URL)

Sin `DATABASE_URL`, el sistema usa la base embebida en `DATA_DIR` (como siempre, para uso local). Con `DATABASE_URL` definida, usa ese PostgreSQL (por ejemplo, Neon) y **no** toca la base embebida. Si la conexión falla, el servidor muestra el error sin la URL, el usuario, la clave ni el host, y **no arranca**: nunca cae en silencio a una base local vacía.

- La app usa una sola conexión y pone las consultas en fila mientras corre una transacción, igual que la base embebida. Alcanza para un piloto; si hiciera falta más caudal, primero hay que revisar la concurrencia de cada transacción.
- La URL de una base remota tiene que llevar `sslmode=verify-full` o `sslmode=require` (las de Neon lo traen); si no, el servidor no arranca. Tampoco arranca si `DATABASE_URL` está definida pero vacía, si está en Render (variable `RENDER`) sin `DATABASE_URL`, o si `APP_ENV=test` tiene `DATABASE_URL` (las pruebas nunca tocan la base externa).
- Elegí la **misma región** en Render y en Neon (por ejemplo, Oregon con `us-west-2` u Ohio con `us-east-2`): con una sola conexión, cada consulta suma el viaje de ida y vuelta.
- La base tiene que estar en UTC (Neon lo está por defecto); si no, el servidor avisa al arrancar.
- `npm run backup`, `npm run restore` y `npm run test:reset` son solo para la base embebida y se niegan a correr con `DATABASE_URL` definida. Con Neon, usá su historial y sus ramas.
- `npm run test:pg` corre toda la suite por el driver de PostgreSQL (contra una base local servida por red), sin Neon.

### Aplicar las migraciones en una base Neon vacía

El servidor aplica las migraciones pendientes al arrancar. Para preparar la base antes (o comprobar la conexión), desde tu computadora:

```
npx cross-env DATABASE_URL="<connection string de Neon>" npm run migrate
```

Responde `Base externa (DATABASE_URL) al día. Migraciones registradas: 001_init.sql, …, 005_superadmin.sql.` Se puede correr varias veces: solo aplica lo que falta. Copiá la URL desde el panel de Neon y no la guardes en archivos del repositorio. Pasarla así deja la URL en el historial de la terminal: si preferís evitarlo, ponela en un `.env` local (ignorado por git) solo para ese paso y borrala después. Dos migraciones a la vez (este comando y un arranque en Render) no chocan: la segunda espera y no repite nada. `pg` avisa que `sslmode=require` hoy equivale a `verify-full`; para no ver el aviso, cambiá `sslmode=require` por `sslmode=verify-full` en la URL.

## Render Free con Neon

1. **Neon:** creá un proyecto gratis y copiá la *connection string* (Dashboard → Connect). Sirve la directa o la *pooled*.
2. Aplicá las migraciones con el comando de arriba (opcional: el primer arranque también lo hace).
3. **Render:** New → Blueprint con este repositorio (usa `render.yaml`), o New → Web Service con:
   - Build: `npm ci --include=dev && npm run build`
   - Start: `npm start`
   - Health check: `/api/health`
4. Variables en Render (Environment):

| Variable | Valor | Para qué |
|---|---|---|
| `DATABASE_URL` | connection string de Neon (secreta) | Base de datos |
| `APP_ENV` | `production` | Modo real |
| `TRUST_PROXY` | `saltos:1` | IP real de cada cliente (límites de intentos) y cookie segura detrás del balanceador de Render |
| `NODE_VERSION` | `24` | Misma versión que en desarrollo |
| `SUPERADMIN_EMAIL` | tu email | Crea tu cuenta en el primer arranque (solo si no existe) |
| `SUPERADMIN_PASSWORD` | opcional, secreta | Si no la ponés, el enlace para definirla sale en los registros de Render (vence en 24 h) |
| `SUPERADMIN_NAME` | opcional | Tu nombre |
| `PUBLIC_URL` | solo con dominio propio | Si no está, se usa `RENDER_EXTERNAL_URL` (`https://<servicio>.onrender.com`), que Render define solo |

`PORT` lo define Render (el servidor escucha en `0.0.0.0` y en ese puerto); no lo cargues. Después del primer arranque podés borrar `SUPERADMIN_PASSWORD`.

También podés crear la cuenta desde tu computadora, sin tocar Render: `npx cross-env DATABASE_URL="<url de Neon>" PUBLIC_URL="https://<servicio>.onrender.com" npm run superadmin -- tu@email.com "Tu nombre"`.

**Fotos:** se guardan en el disco del servicio (`DATA_DIR/uploads`). En Render Free ese disco **no es persistente**: se borra en cada deploy, reinicio o al dormirse por inactividad (15 min). Los datos (carta, pedidos, cuentas) quedan en Neon, pero las fotos subidas se pierden y la carta las muestra vacías hasta volver a subirlas. Hoy el sistema no tiene otra opción de almacenamiento para fotos. Alternativas, todas pendientes:
- **Disco persistente de Render:** existe solo en planes pagos (instancia Starter más un disco). Con eso alcanza con apuntar `DATA_DIR` al disco, sin cambiar código.
- **Guardar las fotos en Neon** (columna `bytea`; el plan gratis trae 0,5 GB): requiere cambiar el código de subida y de entrega de fotos.
- **Almacenamiento de objetos con capa gratis** (por ejemplo, Cloudflare R2): también requiere cambios de código y una cuenta más.

**Dormido:** en el plan Free el servicio se duerme tras 15 minutos sin visitas y tarda en despertar (cerca de un minuto). Neon Free también suspende la base, que despierta en la primera consulta.
