/** Format JC vendor brand references as "AW:123 · SL:456" */
export function formatJcVendorIds(refs) {
  if (!refs?.length) return null
  return refs
    .slice()
    .sort((a, b) => (a.brand || '').localeCompare(b.brand || ''))
    .map(r => `${r.brand === 'Starlight' ? 'SL' : 'AW'}:${r.jc_vendor_id}`)
    .join(' · ')
}
