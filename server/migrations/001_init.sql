-- BM Dev Restaurant · esquema inicial. Dinero en centavos (bigint). Toda tabla de negocio lleva restaurant_id.

CREATE TABLE restaurants (
  id serial PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name text NOT NULL,
  theme text NOT NULL DEFAULT 'bodegon' CHECK (theme IN ('bodegon','pizzeria')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id int NOT NULL REFERENCES users(id),
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  roles text[] NOT NULL,
  pin_hash text,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, restaurant_id)
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id),
  restaurant_id int REFERENCES restaurants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE audit_log (
  id serial PRIMARY KEY,
  restaurant_id int REFERENCES restaurants(id),
  user_id int REFERENCES users(id),
  authorized_by int REFERENCES users(id),
  action text NOT NULL,
  entity text,
  entity_id text,
  reason text,
  data jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_rest_idx ON audit_log (restaurant_id, at DESC);

CREATE TABLE stations (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('kitchen','bar')),
  delay_minutes int NOT NULL DEFAULT 15,
  UNIQUE (restaurant_id, id)
);

CREATE TABLE tables (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  number text NOT NULL,
  area text NOT NULL DEFAULT 'Salón',
  seats int NOT NULL DEFAULT 4 CHECK (seats > 0),
  qr_token text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  needs_cleaning boolean NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, number),
  UNIQUE (restaurant_id, id)
);

CREATE TABLE categories (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, name),
  UNIQUE (restaurant_id, id)
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  category_id int NOT NULL,
  station_id int NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  photo text,
  tags text[] NOT NULL DEFAULT '{}',
  allergens text NOT NULL DEFAULT '',
  available boolean NOT NULL DEFAULT true,
  stock_qty int CHECK (stock_qty >= 0),
  published boolean NOT NULL DEFAULT true,
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','pizza','dozen')),
  course text NOT NULL DEFAULT 'principal' CHECK (course IN ('bebida','entrada','principal','postre')),
  prep_minutes int NOT NULL DEFAULT 10,
  favorite boolean NOT NULL DEFAULT false,
  suggestion_id int,
  position int NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, id),
  FOREIGN KEY (restaurant_id, category_id) REFERENCES categories(restaurant_id, id),
  FOREIGN KEY (restaurant_id, station_id) REFERENCES stations(restaurant_id, id)
);
CREATE INDEX products_rest_idx ON products (restaurant_id, category_id);

CREATE TABLE product_options (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  product_id int NOT NULL,
  grp text NOT NULL,
  name text NOT NULL,
  price_delta_cents bigint NOT NULL DEFAULT 0,
  multi boolean NOT NULL DEFAULT false,
  FOREIGN KEY (restaurant_id, product_id) REFERENCES products(restaurant_id, id) ON DELETE CASCADE
);

CREATE TABLE visits (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  waiter_id int REFERENCES users(id),
  guests int NOT NULL DEFAULT 2 CHECK (guests > 0),
  access_code text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (restaurant_id, id)
);
CREATE INDEX visits_open_idx ON visits (restaurant_id) WHERE status = 'open';

CREATE TABLE visit_tables (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  visit_id int NOT NULL,
  table_id int NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id),
  FOREIGN KEY (restaurant_id, table_id) REFERENCES tables(restaurant_id, id)
);
-- Una mesa física admite una sola asignación abierta.
CREATE UNIQUE INDEX visit_tables_one_open ON visit_tables (table_id) WHERE released_at IS NULL;

CREATE TABLE diner_sessions (
  token_hash text PRIMARY KEY,
  restaurant_id int NOT NULL,
  visit_id int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id)
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  number int NOT NULL,
  channel text NOT NULL CHECK (channel IN ('retiro','delivery','mostrador')),
  status text NOT NULL DEFAULT 'recibido' CHECK (status IN ('solicitud','recibido','aceptado','en_preparacion','listo','en_reparto','entregado','no_entregado','rechazado','cancelado')),
  customer_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  address_notes text NOT NULL DEFAULT '',
  zone_id int,
  slot text,
  fee_cents bigint NOT NULL DEFAULT 0,
  items jsonb NOT NULL,
  subtotal_cents bigint NOT NULL,
  total_cents bigint NOT NULL,
  notes text NOT NULL DEFAULT '',
  token text NOT NULL UNIQUE,
  reject_reason text,
  eta text,
  rider_id int REFERENCES users(id),
  cash_declared_cents bigint,
  delivered_at timestamptz,
  op_id text NOT NULL,
  op_hash text NOT NULL,
  loyalty_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, number),
  UNIQUE (restaurant_id, op_id),
  UNIQUE (restaurant_id, id)
);
CREATE INDEX orders_active_idx ON orders (restaurant_id, status);

CREATE TABLE rounds (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  visit_id int,
  order_id int,
  number int NOT NULL,
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','diner','web','counter')),
  op_id text NOT NULL,
  op_hash text NOT NULL,
  created_by int REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, op_id),
  CHECK ((visit_id IS NULL) <> (order_id IS NULL)),
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id),
  FOREIGN KEY (restaurant_id, order_id) REFERENCES orders(restaurant_id, id)
);
-- Un pedido externo genera una única comanda.
CREATE UNIQUE INDEX rounds_one_per_order ON rounds (order_id) WHERE order_id IS NOT NULL;

CREATE TABLE order_lines (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  round_id int NOT NULL REFERENCES rounds(id),
  visit_id int,
  order_id int,
  product_id int NOT NULL,
  station_id int NOT NULL,
  name text NOT NULL,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  unit_cost_cents bigint,
  cost_complete boolean NOT NULL DEFAULT false,
  qty int NOT NULL CHECK (qty > 0),
  options jsonb NOT NULL DEFAULT '[]',
  note text NOT NULL DEFAULT '',
  seat text NOT NULL DEFAULT '',
  course text NOT NULL DEFAULT 'principal',
  held boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','delivered','void')),
  qty_ready int NOT NULL DEFAULT 0,
  qty_delivered int NOT NULL DEFAULT 0,
  change_note text,
  change_ack boolean NOT NULL DEFAULT true,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_ready BETWEEN 0 AND qty),
  CHECK (qty_delivered BETWEEN 0 AND qty),
  FOREIGN KEY (restaurant_id, product_id) REFERENCES products(restaurant_id, id),
  FOREIGN KEY (restaurant_id, station_id) REFERENCES stations(restaurant_id, id),
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id),
  FOREIGN KEY (restaurant_id, order_id) REFERENCES orders(restaurant_id, id)
);
CREATE INDEX lines_station_active_idx ON order_lines (restaurant_id, station_id) WHERE status IN ('pending','preparing','ready');
CREATE INDEX lines_visit_idx ON order_lines (visit_id);

CREATE TABLE stock_moves (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  product_id int NOT NULL,
  delta int NOT NULL,
  reason text NOT NULL,
  line_id int,
  user_id int,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (restaurant_id, product_id) REFERENCES products(restaurant_id, id)
);

CREATE TABLE cash_shifts (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by int REFERENCES users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cents bigint NOT NULL CHECK (opening_cents >= 0),
  closed_by int REFERENCES users(id),
  closed_at timestamptz,
  counted_cents bigint,
  expected_cents bigint,
  summary jsonb,
  UNIQUE (restaurant_id, id)
);
CREATE UNIQUE INDEX one_open_shift ON cash_shifts (restaurant_id) WHERE status = 'open';

CREATE TABLE payments (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  shift_id int NOT NULL,
  visit_id int,
  order_id int,
  method text NOT NULL,
  amount_cents bigint NOT NULL,
  tendered_cents bigint,
  change_cents bigint NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
  tip_cents bigint NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  payer text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','reversed')),
  reverses_id int REFERENCES payments(id),
  reason text,
  op_id text NOT NULL,
  op_hash text NOT NULL,
  created_by int REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, op_id),
  FOREIGN KEY (restaurant_id, shift_id) REFERENCES cash_shifts(restaurant_id, id),
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id),
  FOREIGN KEY (restaurant_id, order_id) REFERENCES orders(restaurant_id, id)
);
CREATE INDEX payments_shift_idx ON payments (shift_id);
CREATE INDEX payments_visit_idx ON payments (visit_id);

CREATE TABLE cash_moves (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  shift_id int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gasto','retiro','ingreso')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  created_by int REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (restaurant_id, shift_id) REFERENCES cash_shifts(restaurant_id, id)
);

CREATE TABLE discounts (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  visit_id int NOT NULL,
  line_id int REFERENCES order_lines(id),
  kind text NOT NULL CHECK (kind IN ('descuento','cortesia')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  created_by int REFERENCES users(id),
  authorized_by int REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id)
);

CREATE TABLE tickets (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  kind text NOT NULL CHECK (kind IN ('precuenta','x')),
  number int NOT NULL,
  visit_id int,
  order_id int,
  snapshot jsonb NOT NULL,
  created_by int REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, kind, number)
);

CREATE TABLE calls (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  visit_id int NOT NULL,
  reason text NOT NULL CHECK (reason IN ('mozo','cuenta','alergia')),
  detail text NOT NULL DEFAULT '',
  taps int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ack','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ack_by int REFERENCES users(id),
  ack_at timestamptz,
  FOREIGN KEY (restaurant_id, visit_id) REFERENCES visits(restaurant_id, id)
);
-- Toques repetidos se agrupan: un aviso activo por visita y motivo.
CREATE UNIQUE INDEX calls_one_active ON calls (visit_id, reason) WHERE status <> 'closed';

CREATE TABLE feedback (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  visit_id int,
  text text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE delivery_zones (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  fee_cents bigint NOT NULL CHECK (fee_cents >= 0),
  min_cents bigint NOT NULL DEFAULT 0
);

CREATE TABLE reservations (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  party int NOT NULL CHECK (party > 0),
  slot timestamptz,
  area text,
  table_id int,
  status text NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada','espera','sentada','cancelada','ausente')),
  notes text NOT NULL DEFAULT '',
  token text NOT NULL UNIQUE,
  visit_id int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_slot_idx ON reservations (restaurant_id, slot);

CREATE TABLE suppliers (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  UNIQUE (restaurant_id, id)
);

CREATE TABLE ingredients (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('g','ml','u')),
  kind text NOT NULL DEFAULT 'insumo' CHECK (kind IN ('insumo','envase','subreceta')),
  pack_qty numeric NOT NULL DEFAULT 1 CHECK (pack_qty > 0),
  pack_cost_cents bigint,
  yield_pct numeric NOT NULL DEFAULT 100 CHECK (yield_pct > 0 AND yield_pct <= 100),
  batch_qty numeric NOT NULL DEFAULT 1 CHECK (batch_qty > 0),
  stock_qty numeric NOT NULL DEFAULT 0,
  supplier_id int,
  cost_updated_at timestamptz,
  prev_pack_cost_cents bigint,
  UNIQUE (restaurant_id, id),
  UNIQUE (restaurant_id, name)
);

-- Ítems de receta de un producto o de una subreceta (ingrediente kind='subreceta').
CREATE TABLE recipe_items (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  product_id int,
  parent_ingredient_id int,
  ingredient_id int NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0),
  CHECK ((product_id IS NULL) <> (parent_ingredient_id IS NULL)),
  FOREIGN KEY (restaurant_id, product_id) REFERENCES products(restaurant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (restaurant_id, parent_ingredient_id) REFERENCES ingredients(restaurant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (restaurant_id, ingredient_id) REFERENCES ingredients(restaurant_id, id)
);

CREATE TABLE inv_moves (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  ingredient_id int NOT NULL,
  delta numeric NOT NULL,
  kind text NOT NULL CHECK (kind IN ('compra','consumo','ajuste','inventario','merma')),
  reason text NOT NULL DEFAULT '',
  line_id int,
  cost_cents bigint,
  user_id int,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (restaurant_id, ingredient_id) REFERENCES ingredients(restaurant_id, id)
);
-- Un mismo insumo se descuenta una sola vez por línea vendida.
CREATE UNIQUE INDEX inv_consumo_once ON inv_moves (line_id, ingredient_id) WHERE kind = 'consumo';

CREATE TABLE purchase_orders (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  supplier_id int NOT NULL,
  status text NOT NULL DEFAULT 'pedido' CHECK (status IN ('pedido','recibido','cancelado')),
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  FOREIGN KEY (restaurant_id, supplier_id) REFERENCES suppliers(restaurant_id, id)
);

CREATE TABLE promotions (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  name text NOT NULL,
  category_id int,
  days int[] NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  pct int NOT NULL CHECK (pct > 0 AND pct < 100),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  phone text NOT NULL,
  name text NOT NULL DEFAULT '',
  opt_in boolean NOT NULL DEFAULT false,
  opt_in_at timestamptz,
  opt_out_at timestamptz,
  stamps int NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, phone)
);

CREATE TABLE prep_plans (
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  day date NOT NULL,
  product_id int NOT NULL,
  qty int NOT NULL CHECK (qty >= 0),
  PRIMARY KEY (restaurant_id, day, product_id)
);

-- Cambios del repartidor sincronizados: cada cambio offline se aplica una sola vez.
CREATE TABLE rider_ops (
  restaurant_id int NOT NULL REFERENCES restaurants(id),
  op_id text NOT NULL,
  order_id int NOT NULL,
  result jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, op_id)
);
