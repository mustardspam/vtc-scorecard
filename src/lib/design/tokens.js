/** Liquid Glass design tokens — tier + category colors from design handoff v2.1 */

export const TIER_COLORS = {
  Good:       { fg: '#1f7a44', softBg: '#dcf2e4', bar: '#2fa35f' },
  Watch:      { fg: '#8a5a08', softBg: '#f8ecc9', bar: '#d99316' },
  Probation:  { fg: '#b45309', softBg: '#fbe2cf', bar: '#d97b16' },
  Critical:   { fg: '#a72727', softBg: '#f8dada', bar: '#d44848' },
  'No data':  { fg: 'var(--g-dim)', softBg: 'rgba(125,125,125,0.14)', bar: '#9aa3b2' },
}

export const CATEGORY_COLORS = {
  'Trim Carpenter': '#16a34a',
  'Painter': '#a855f7',
  'Service': '#94a3b8',
  'SWPPP': '#65a30d',
  'Grading': '#b45309',
  'Electrician': '#ca8a04',
  'HVAC': '#06b6d4',
  'Plumber': '#3b82f6',
  'Framer': '#ea580c',
  'Insulation': '#ec4899',
  'Fence': '#78716c',
  'Mirror/Glass': '#0ea5e9',
  'Bricker': '#ef4444',
  'Concrete': '#6b7280',
  'Landscape': '#22c55e',
  'Garage Door': '#6366f1',
  'Cleaner': '#14b8a6',
  'Trash': '#71717a',
  'Drywall': '#f59e0b',
  'Roofer': '#f43f5e',
  'Flooring': '#d97706',
  'Countertops': '#0d9488',
  'Cabinets': '#eab308',
  'Supplier': '#8b5cf6',
}

export const CATEGORY_FALLBACK = '#64748b'

export const BRAND_CHIPS = {
  starlight: { bg: 'rgba(217,147,22,0.16)', text: '#9a6a0c' },
  ashton:    { bg: 'rgba(59,130,246,0.16)', text: '#2563c9' },
}

export const TYPE_CHIPS = {
  Trade:  { bg: 'rgba(99,102,241,0.16)', text: '#4f46e5' },
  Vendor: { bg: 'rgba(168,85,247,0.16)', text: '#7e22ce' },
}

export function categoryColor(name) {
  return CATEGORY_COLORS[name] || CATEGORY_FALLBACK
}

export function categoryChipStyle(name) {
  const hex = categoryColor(name)
  return {
    background: `color-mix(in srgb, ${hex} 16%, transparent)`,
    color: hex,
  }
}

export function tierPillStyle(tier) {
  const c = TIER_COLORS[tier?.label] || TIER_COLORS['No data']
  return { color: c.fg, backgroundColor: c.softBg }
}

export function tierValueColor(tier) {
  const c = TIER_COLORS[tier?.label] || TIER_COLORS['No data']
  return c.fg
}

export function tierBarColor(tier) {
  const c = TIER_COLORS[tier?.label] || TIER_COLORS['No data']
  return c.bar
}
