/** Area manager colors — shared by Coverage Map and Teams page. */
export const ACM_PALETTE = ['#087482', '#2196f3', '#f9a825', '#e91e63']

/** Assign palette colors by ACM list order (must match map manager sort). */
export function buildAcmColorMap(acms) {
  const map = {}
  acms.forEach((acm, i) => {
    map[acm.id] = ACM_PALETTE[i % ACM_PALETTE.length]
  })
  return map
}

export function acmPanelStyle(color) {
  if (!color) return {}
  return {
    borderColor: `${color}55`,
    backgroundColor: `${color}18`,
  }
}
