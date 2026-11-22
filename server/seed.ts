// Datos ficticios para pruebas y capacitación. Solo se cargan en la base de pruebas (APP_ENV=test).
import type { PGlite } from '@electric-sql/pglite';
import { one } from './db.ts';
import { hashSecret, newToken } from './core.ts';
import { applyTemplate, TEMPLATES } from './templates.ts';

export const TEST_PASSWORD = 'prueba1234';
export const TEST_PIN = '1234';

export async function seed(db: PGlite) {
  const pw = await hashSecret(TEST_PASSWORD);
  const pin = await hashSecret(TEST_PIN);
  const user = async (email: string, name: string, admin = false) =>
    (await one(db, 'INSERT INTO users (email, name, password_hash, is_platform_admin) VALUES ($1,$2,$3,$4) RETURNING id', [email, name, pw, admin]))!.id as number;
  const member = (u: number, r: number, roles: string[], withPin = false) =>
    db.query('INSERT INTO memberships (user_id, restaurant_id, roles, pin_hash) VALUES ($1,$2,$3,$4)', [u, r, roles, withPin ? pin : null]);

  await user('admin@bmdev.test', 'Soporte BM Dev', true);

  // ---------- Local A: bodegón ----------
  const A = (await one(db, `INSERT INTO restaurants (slug, name, theme, settings) VALUES ('esquina','La Esquina de Boedo','bodegon',$1) RETURNING id`, [JSON.stringify({
    ...TEMPLATES.bodegon.settings, takeaway: true, delivery: true, hours: 'Martes a domingo · 12 a 15.30 y 20 a 0.30', address: 'Av. Boedo 1234, CABA (ficticio)',
    tagline: 'Cocina de bodegón desde 1962 (local ficticio de prueba)', whatsapp_phone: '5491100000000', google_review_url: 'https://g.page/r/ejemplo-ficticio/review',
    reservations: { enabled: true, times: ['20:00', '20:30', '21:00', '21:30', '22:00'], capacity: 24 },
    features: { ...TEMPLATES.bodegon.settings.features, loyalty: true },
  })]))!.id as number;
  await applyTemplate(db, A, 'bodegon');
  const st = async (r: number, kind: string) => (await one(db, 'SELECT id FROM stations WHERE restaurant_id=$1 AND kind=$2 ORDER BY id LIMIT 1', [r, kind]))!.id as number;
  const cat = async (r: number, name: string) => (await one(db, 'SELECT id FROM categories WHERE restaurant_id=$1 AND name=$2', [r, name]))!.id as number;
  const kA = await st(A, 'kitchen'), bA = await st(A, 'bar');

  const ownerA = await user('dueno@esquina.test', 'Marta Dueña');
  const mozo1 = await user('mozo1@esquina.test', 'Lucas Mozo');
  const mozo2 = await user('mozo2@esquina.test', 'Sofía Moza');
  const cocina = await user('cocina@esquina.test', 'Ramón Cocina');
  const barra = await user('barra@esquina.test', 'Julia Barra');
  const caja = await user('caja@esquina.test', 'Diego Caja');
  const rider = await user('reparto@esquina.test', 'Nico Reparto');
  await member(ownerA, A, ['owner'], true);
  await member(mozo1, A, ['waiter']);
  await member(mozo2, A, ['waiter', 'all_tables']);
  await member(cocina, A, ['kitchen', 'pass', 'stock']);
  await member(barra, A, ['bar']);
  await member(caja, A, ['cashier', 'reservations']);
  await member(rider, A, ['rider']);

  for (let n = 1; n <= 8; n++) await db.query('INSERT INTO tables (restaurant_id, number, area, seats, qr_token) VALUES ($1,$2,$3,$4,$5)', [A, String(n), 'Salón', n % 3 === 0 ? 6 : 4, n === 4 ? 'mesa4-esquina-demo' : newToken(9)]);
  for (const n of ['9', '10']) await db.query('INSERT INTO tables (restaurant_id, number, area, seats, qr_token) VALUES ($1,$2,$3,$4,$5)', [A, n, 'Vereda', 2, newToken(9)]);
  await db.query('INSERT INTO tables (restaurant_id, number, area, seats, qr_token) VALUES ($1,$2,$3,$4,$5)', [A, 'B1', 'Barra', 2, newToken(9)]);

  const prod = async (r: number, c: number, s: number, name: string, price: number, extra: Record<string, unknown> = {}, options: [string, string, number, boolean?][] = []) => {
    const cols = ['restaurant_id', 'category_id', 'station_id', 'name', 'price_cents', ...Object.keys(extra)];
    const p = (await one(db, `INSERT INTO products (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, [r, c, s, name, price * 100, ...Object.values(extra)]))!.id as number;
    for (const [grp, oname, delta, multi] of options) await db.query('INSERT INTO product_options (restaurant_id, product_id, grp, name, price_delta_cents, multi) VALUES ($1,$2,$3,$4,$5,$6)', [r, p, grp, oname, delta * 100, !!multi]);
    return p;
  };
  const ent = await cat(A, 'Entradas'), pri = await cat(A, 'Principales'), pos = await cat(A, 'Postres'), beb = await cat(A, 'Bebidas');
  await prod(A, ent, kA, 'Provoleta a la plancha', 7800, { description: 'Con orégano y aceite de oliva.', course: 'entrada', tags: ['vegetariano'], allergens: 'lácteos', prep_minutes: 8 });
  await prod(A, ent, kA, 'Empanada de carne cortada a cuchillo', 2400, { description: 'Frita o al horno.', course: 'entrada', prep_minutes: 6 }, [['Cocción', 'Frita', 0], ['Cocción', 'Al horno', 0]]);
  const mila = await prod(A, pri, kA, 'Milanesa de nalga', 14500, { description: 'Con guarnición a elección. Pedila napolitana.', favorite: true, prep_minutes: 15, allergens: 'gluten, huevo' },
    [['Guarnición', 'Papas fritas', 0], ['Guarnición', 'Puré de papas', 0], ['Guarnición', 'Ensalada mixta', 0], ['Extras', 'Napolitana', 2500, true], ['Extras', 'Huevo frito', 1200, true]]);
  await prod(A, pri, kA, 'Bife de chorizo', 19800, { description: '400 g, con papas rústicas.', favorite: true, prep_minutes: 20 }, [['Punto', 'Jugoso', 0], ['Punto', 'A punto', 0], ['Punto', 'Cocido', 0]]);
  await prod(A, pri, kA, 'Vacío a la parrilla (última del día)', 17500, { description: 'Porciones limitadas.', stock_qty: 1, prep_minutes: 18 });
  await prod(A, pri, kA, 'Sorrentinos de calabaza y queso de cabra con salsa de manteca, salvia y nueces tostadas', 15200, { description: 'Pasta casera. Plato de nombre largo para probar el diseño.', tags: ['vegetariano'], allergens: 'gluten, lácteos, frutos secos', prep_minutes: 14 });
  const menuEj = await prod(A, pri, kA, 'Menú ejecutivo para llevar', 12000, { description: 'Plato del día con envase térmico.', prep_minutes: 12 });
  await prod(A, pos, kA, 'Flan casero con dulce de leche', 5200, { course: 'postre', tags: ['sin TACC'], prep_minutes: 3 });
  await prod(A, beb, bA, 'Gaseosa línea Coca-Cola 500 ml', 3200, { course: 'bebida', favorite: true, prep_minutes: 1 });
  await prod(A, beb, bA, 'Agua mineral sin gas', 2600, { course: 'bebida', favorite: true, prep_minutes: 1 });
  await prod(A, beb, bA, 'Copa de Malbec de la casa', 4500, { course: 'bebida', prep_minutes: 1 });
  await prod(A, beb, bA, 'Fernet con cola', 5900, { course: 'bebida', prep_minutes: 2 });
  await db.query(`UPDATE products SET suggestion_id=(SELECT id FROM products WHERE restaurant_id=$1 AND name LIKE 'Copa de Malbec%') WHERE id=$2`, [A, mila]);

  for (const [n, fee, min] of [['Boedo', 1500, 8000], ['Almagro', 2000, 10000], ['Caballito', 2800, 12000]] as const)
    await db.query('INSERT INTO delivery_zones (restaurant_id, name, fee_cents, min_cents) VALUES ($1,$2,$3,$4)', [A, n, fee * 100, min * 100]);

  // Recetas y stock (A15: venta $12.000, ingredientes $4.000, envase $500).
  const sup = (await one(db, `INSERT INTO suppliers (restaurant_id, name, phone) VALUES ($1,'Carnes Don Tito (ficticio)','1100000001') RETURNING id`, [A]))!.id;
  const ing = async (name: string, unit: string, packQty: number, cost: number | null, extra: Record<string, unknown> = {}) => {
    const cols = ['restaurant_id', 'name', 'unit', 'pack_qty', 'pack_cost_cents', 'cost_updated_at', 'supplier_id', ...Object.keys(extra)];
    return (await one(db, `INSERT INTO ingredients (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, [A, name, unit, packQty, cost == null ? null : cost * 100, cost == null ? null : new Date(), sup, ...Object.values(extra)]))!.id as number;
  };
  const nalga = await ing('Nalga', 'g', 1000, 12000, { yield_pct: 90, stock_qty: 8000 });
  const pan = await ing('Pan rallado', 'g', 1000, 2500, { stock_qty: 5000 });
  const huevo = await ing('Huevo', 'u', 30, 9000, { stock_qty: 60 });
  const papa = await ing('Papa', 'g', 1000, 1200, { yield_pct: 80, stock_qty: 20000 });
  const kitEj = await ing('Insumos del menú ejecutivo', 'u', 1, 4000, { stock_qty: 30 });
  const envase = await ing('Envase térmico', 'u', 1, 500, { kind: 'envase', stock_qty: 100 });
  const rebozado = (await one(db, `INSERT INTO ingredients (restaurant_id, name, unit, kind, batch_qty) VALUES ($1,'Rebozado (subreceta)','g','subreceta',1000) RETURNING id`, [A]))!.id;
  await db.query('INSERT INTO recipe_items (restaurant_id, parent_ingredient_id, ingredient_id, qty) VALUES ($1,$2,$3,700),($1,$2,$4,10)', [A, rebozado, pan, huevo]);
  await db.query('INSERT INTO recipe_items (restaurant_id, product_id, ingredient_id, qty) VALUES ($1,$2,$3,250),($1,$2,$4,80),($1,$2,$5,300)', [A, mila, nalga, rebozado, papa]);
  await db.query('INSERT INTO recipe_items (restaurant_id, product_id, ingredient_id, qty) VALUES ($1,$2,$3,1),($1,$2,$4,1)', [A, menuEj, kitEj, envase]);
  const bife = (await one(db, `SELECT id FROM products WHERE restaurant_id=$1 AND name='Bife de chorizo'`, [A]))!.id;
  const bifeIng = await ing('Bife de chorizo (corte)', 'g', 1000, null, { stock_qty: 4000 }); // costo faltante -> estimación incompleta
  await db.query('INSERT INTO recipe_items (restaurant_id, product_id, ingredient_id, qty) VALUES ($1,$2,$3,400)', [A, bife, bifeIng]);

  // Historial: un turno cerrado de ayer y ventas de semanas anteriores para preparación e informes.
  const yesterday = new Date(Date.now() - 86400_000);
  await db.query(`INSERT INTO cash_shifts (restaurant_id, status, opened_by, opened_at, opening_cents, closed_by, closed_at, counted_cents, expected_cents) VALUES ($1,'closed',$2,$3,2000000,$2,$4,2450000,2500000)`,
    [A, caja, new Date(yesterday.getTime() - 6 * 3600_000), yesterday]);
  const t8 = (await one(db, `SELECT id FROM tables WHERE restaurant_id=$1 AND number='8'`, [A]))!.id;
  const products = (await db.query<{ id: number; name: string; price_cents: number; station_id: number; course: string }>(`SELECT id, name, price_cents, station_id, course FROM products WHERE restaurant_id=$1`, [A])).rows;
  for (let d = 1; d <= 28; d++) {
    const at = new Date(Date.now() - d * 86400_000);
    at.setUTCHours(23, 30, 0, 0); // 20.30 en Argentina
    const v = (await one(db, `INSERT INTO visits (restaurant_id, status, waiter_id, guests, access_code, opened_at, closed_at) VALUES ($1,'closed',$2,4,'0000',$3,$3) RETURNING id`, [A, mozo1, at]))!.id;
    await db.query('INSERT INTO visit_tables (restaurant_id, visit_id, table_id, assigned_at, released_at) VALUES ($1,$2,$3,$4,$4)', [A, v, t8, at]);
    const r = (await one(db, `INSERT INTO rounds (restaurant_id, visit_id, number, op_id, op_hash, created_by, created_at) VALUES ($1,$2,1,$3,'seed',$4,$5) RETURNING id`, [A, v, `seed-hist-${d}`, mozo1, at]))!.id;
    for (const p of products) {
      const qty = ((d * 7 + p.id * 3) % 5) + (p.name.startsWith('Milanesa') ? 6 : p.course === 'bebida' ? 4 : 1);
      const cost = p.id === mila ? 416333 : p.id === menuEj ? 450000 : null;
      await db.query(`INSERT INTO order_lines (restaurant_id, round_id, visit_id, product_id, station_id, name, unit_price_cents, unit_cost_cents, cost_complete, qty, status, qty_ready, qty_delivered, course, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'delivered',$10,$10,$11,$12)`,
        [A, r, v, p.id, p.station_id, p.name, p.price_cents, cost == null ? null : Math.round(cost), cost != null, qty, p.course, at]);
    }
  }
  await db.query('INSERT INTO cash_shifts (restaurant_id, opened_by, opening_cents) VALUES ($1,$2,2000000)', [A, caja]);

  // ---------- Local B: pizzería ----------
  const B = (await one(db, `INSERT INTO restaurants (slug, name, theme, settings) VALUES ('fuego','Pizzería Fuego de Almagro','pizzeria',$1) RETURNING id`, [JSON.stringify({
    ...TEMPLATES.pizzeria.settings, hours: 'Todos los días · 19 a 0', address: 'Av. Corrientes 4321, CABA (ficticio)', tagline: 'Pizza a la piedra y empanadas (local ficticio de prueba)', slot_capacity: 2,
  })]))!.id as number;
  await applyTemplate(db, B, 'pizzeria');
  const kB = await st(B, 'kitchen'), bB = await st(B, 'bar');
  const ownerB = await user('dueno@fuego.test', 'Carlos Dueño');
  const mozoB = await user('mozo@fuego.test', 'Pía Moza');
  const cajaB = await user('caja@fuego.test', 'Tomás Caja');
  await member(ownerB, B, ['owner'], true);
  await member(mozoB, B, ['waiter', 'kitchen', 'bar']);
  await member(cajaB, B, ['cashier']);
  for (let n = 1; n <= 6; n++) await db.query('INSERT INTO tables (restaurant_id, number, area, seats, qr_token) VALUES ($1,$2,$3,$4,$5)', [B, String(n), 'Salón', 4, newToken(9)]);
  const piz = await cat(B, 'Pizzas'), emp = await cat(B, 'Empanadas'), bebB = await cat(B, 'Bebidas');
  const pizzaExtras: [string, string, number, boolean][] = [['Extras', 'Extra muzzarella', 2200, true], ['Extras', 'Aceitunas', 900, true], ['Extras', 'Huevo duro', 1100, true]];
  await prod(B, piz, kB, 'Muzzarella', 11000, { kind: 'pizza', description: 'Salsa de tomate, muzzarella y orégano.', favorite: true }, pizzaExtras);
  await prod(B, piz, kB, 'Fugazzeta', 13000, { kind: 'pizza', description: 'Rellena de muzzarella, cebolla y orégano.', favorite: true }, pizzaExtras);
  await prod(B, piz, kB, 'Napolitana', 12500, { kind: 'pizza', description: 'Muzzarella, rodajas de tomate y ajo.' }, pizzaExtras);
  await prod(B, piz, kB, 'Calabresa', 14000, { kind: 'pizza', description: 'Muzzarella y longaniza calabresa.' }, pizzaExtras);
  await prod(B, emp, kB, 'Docena de empanadas surtidas', 21000, { kind: 'dozen', description: 'Elegí 12 entre los gustos. Caprese tiene adicional.' },
    [['Gusto', 'Carne suave', 0], ['Gusto', 'Pollo', 0], ['Gusto', 'Jamón y queso', 0], ['Gusto', 'Humita', 0], ['Gusto', 'Caprese', 200]]);
  await prod(B, bebB, bB, 'Cerveza rubia 1 L', 6500, { course: 'bebida' });
  await prod(B, bebB, bB, 'Gaseosa 1,5 L', 4800, { course: 'bebida' });
  for (const [n, fee] of [['Almagro', 1200], ['Villa Crespo', 1800]] as const)
    await db.query('INSERT INTO delivery_zones (restaurant_id, name, fee_cents, min_cents) VALUES ($1,$2,$3,0)', [B, n, fee * 100]);
  await db.query('INSERT INTO cash_shifts (restaurant_id, opened_by, opening_cents) VALUES ($1,$2,1000000)', [B, cajaB]);

  return { A, B };
}
