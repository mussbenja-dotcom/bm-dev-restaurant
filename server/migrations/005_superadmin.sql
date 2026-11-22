-- Superadmin: papelera de locales y enlaces de acceso de un solo uso. Solo agrega; no borra datos.

-- Estado «En papelera»: el local queda fuera de servicio y se puede restaurar como estaba.
ALTER TABLE restaurants DROP CONSTRAINT restaurants_status_check;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_status_check CHECK (status IN ('active','suspended','trashed'));
ALTER TABLE restaurants ADD COLUMN trashed_at timestamptz;
ALTER TABLE restaurants ADD COLUMN trashed_from text CHECK (trashed_from IN ('active','suspended'));

-- Enlaces de acceso: «activate» (cuenta nueva, la persona define su contraseña) e «invite» (cuenta existente, se vincula al local sin tocar la contraseña).
-- Se guarda solo el hash del token; vencen y se usan una sola vez. restaurant_id NULL = alta de la cuenta de plataforma.
CREATE TABLE account_links (
  id serial PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('activate','invite')),
  user_id int NOT NULL REFERENCES users(id),
  restaurant_id int REFERENCES restaurants(id),
  created_by int REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX account_links_restaurant_idx ON account_links (restaurant_id);
