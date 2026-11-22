import type { Q } from './db.ts';

const base = {
  mode: 'orders', // 'menu' solo carta · 'calls' llamados · 'orders' pedidos por QR (cada mesa los habilita su mozo)
  pizza_rule: 'max',
  cutoff_hour: 6,
  bill_alert_min: 5,
  payment_methods: ['efectivo', 'transferencia', 'tarjeta'],
  takeaway: false,
  delivery: false,
  delivery_paused_until: null,
  whatsapp_only: false,
  whatsapp_phone: '',
  google_review_url: '',
  hours: '',
  address: '',
  last_order: '23:30',
  slot_start: '20:00',
  slot_end: '23:30',
  slot_minutes: 30,
  slot_capacity: 6,
  reservations: { enabled: false, times: ['20:00', '20:30', '21:00', '21:30', '22:00'], capacity: 24 },
  loyalty_goal: 10,
  dish_of_day: null,
  tagline: '',
  features: { halves: false, dozen: false, happy_hour: false, daily_menu: false, courses: false, loyalty: false, stock: true },
};

/** Plantillas por rubro: estaciones, categorías y funciones que corresponden a cada negocio. */
export const TEMPLATES = {
  bodegon: { label: 'Bodegón / restaurante', settings: { ...base, features: { ...base.features, courses: true } }, stations: [['Cocina', 'kitchen', 20], ['Barra', 'bar', 8]], categories: ['Entradas', 'Principales', 'Postres', 'Bebidas'] },
  pizzeria: { label: 'Pizzería', settings: { ...base, takeaway: true, delivery: true, features: { ...base.features, halves: true, dozen: true } }, stations: [['Horno', 'kitchen', 18], ['Barra', 'bar', 6]], categories: ['Pizzas', 'Empanadas', 'Bebidas', 'Postres'] },
  parrilla: { label: 'Parrilla', settings: { ...base, features: { ...base.features, courses: true } }, stations: [['Parrilla', 'kitchen', 25], ['Cocina', 'kitchen', 15], ['Barra', 'bar', 8]], categories: ['Entradas', 'Parrilla', 'Guarniciones', 'Bebidas', 'Postres'] },
  bar: { label: 'Bar', settings: { ...base, features: { ...base.features, happy_hour: true } }, stations: [['Barra', 'bar', 6], ['Cocina', 'kitchen', 15]], categories: ['Tragos', 'Cervezas', 'Para picar'] },
  rotiseria: { label: 'Rotisería', settings: { ...base, mode: 'menu', takeaway: true, delivery: true, features: { ...base.features, daily_menu: true } }, stations: [['Cocina', 'kitchen', 15]], categories: ['Menú del día', 'Minutas', 'Guarniciones', 'Bebidas'] },
  cafeteria: { label: 'Cafetería', settings: { ...base, takeaway: true }, stations: [['Barra café', 'bar', 5], ['Cocina', 'kitchen', 10]], categories: ['Cafés', 'Pastelería', 'Salado'] },
} as const;

export async function applyTemplate(q: Q, rid: number, key: string) {
  const t = TEMPLATES[key as keyof typeof TEMPLATES] ?? TEMPLATES.bodegon;
  for (const [name, kind, delay] of t.stations) await q.query('INSERT INTO stations (restaurant_id, name, kind, delay_minutes) VALUES ($1,$2,$3,$4)', [rid, name, kind, delay]);
  let i = 0;
  for (const c of t.categories) await q.query('INSERT INTO categories (restaurant_id, name, position) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [rid, c, i++]);
}
