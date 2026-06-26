import { categoryChipStyle } from '../../lib/design/tokens'

export default function CategoryChip({ name }) {
  if (!name) return null
  return (
    <span className="glass-category-chip" style={categoryChipStyle(name)}>
      {name}
    </span>
  )
}
