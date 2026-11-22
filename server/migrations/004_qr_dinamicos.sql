-- QR dinámicos: el cartel impreso apunta a /q/<token> y el destino se cambia desde el panel. Solo agrega columnas.

-- Destino del QR de una mesa: NULL = carta de la mesa; 'reservar'; o un enlace externo.
ALTER TABLE tables ADD COLUMN qr_target text;

-- QR de reseñas del local (uno por restaurante, el mismo cartel en todas las mesas): /q/resenas/<token>.
ALTER TABLE restaurants ADD COLUMN review_qr_token text;
UPDATE restaurants SET review_qr_token = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 16) WHERE review_qr_token IS NULL;
ALTER TABLE restaurants ALTER COLUMN review_qr_token SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16);
ALTER TABLE restaurants ALTER COLUMN review_qr_token SET NOT NULL;
CREATE UNIQUE INDEX restaurants_review_qr_idx ON restaurants (review_qr_token);
