-- Personalizar mi restaurante: cambios de carta en borrador hasta publicar, categorías ocultables y combos.
-- Solo agrega columnas y tablas (sin borrar datos).

-- Borrador pendiente de publicar: mismos campos que el plato o la categoría, ya validados al guardar.
ALTER TABLE products ADD COLUMN draft jsonb;
ALTER TABLE categories ADD COLUMN draft jsonb;
ALTER TABLE categories ADD COLUMN visible boolean NOT NULL DEFAULT true;

ALTER TABLE products DROP CONSTRAINT products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('normal','pizza','dozen','combo'));

-- Componentes de un combo publicado. Al pedirlo, cada componente va a su estación con su parte del precio.
CREATE TABLE combo_items (
  id serial PRIMARY KEY,
  restaurant_id int NOT NULL,
  combo_id int NOT NULL,
  product_id int NOT NULL,
  qty int NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 20),
  FOREIGN KEY (restaurant_id, combo_id) REFERENCES products(restaurant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (restaurant_id, product_id) REFERENCES products(restaurant_id, id)
);
CREATE INDEX combo_items_combo_idx ON combo_items (combo_id);

-- Marca publicada: el estilo de carta arranca según el rubro que ya tenía cada local.
UPDATE restaurants SET settings = settings || jsonb_build_object('brand', jsonb_build_object(
  'style', CASE WHEN theme = 'pizzeria' THEN 'moderna' ELSE 'clasica' END,
  'color', CASE WHEN theme = 'pizzeria' THEN '#a8231b' ELSE '#1f4d3a' END,
  'paper', CASE WHEN theme = 'pizzeria' THEN 'blanco' ELSE 'marfil' END))
WHERE NOT settings ? 'brand';
