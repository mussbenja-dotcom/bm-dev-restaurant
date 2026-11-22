-- Pedidos por QR autorizados por el mozo, combos con elección y registro de ingresos. Solo agrega (sin borrar datos).

-- El mozo habilita los pedidos por QR de cada visita; el código (access_code) se renueva al habilitar y al deshabilitar.
ALTER TABLE visits ADD COLUMN qr_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE visits ADD COLUMN qr_enabled_at timestamptz;

-- Opción de combo que es un plato de la carta («elegí una hamburguesa»): al pedirla, va a la estación de ese plato.
ALTER TABLE product_options ADD COLUMN item_id int;
ALTER TABLE product_options ADD CONSTRAINT product_options_item_fk FOREIGN KEY (restaurant_id, item_id) REFERENCES products(restaurant_id, id);

-- Intentos de ingreso (sin la contraseña). Se conservan 30 días y se borran solos.
CREATE TABLE login_attempts (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  user_id int REFERENCES users(id),
  ip text NOT NULL,
  ok boolean NOT NULL,
  reason text
);
CREATE INDEX login_attempts_at_idx ON login_attempts (at);
CREATE INDEX login_attempts_user_idx ON login_attempts (user_id, at);

-- Aviso al mozo cuando la mesa envía un pedido por QR (se agrupa como los demás avisos de la mesa).
ALTER TABLE calls DROP CONSTRAINT calls_reason_check;
ALTER TABLE calls ADD CONSTRAINT calls_reason_check CHECK (reason IN ('mozo','cuenta','alergia','pedido'));
