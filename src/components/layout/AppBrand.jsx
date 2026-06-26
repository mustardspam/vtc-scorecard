export default function AppBrand({ centered = false, showSubtitle = true }) {
  const mark = (
    <div
      className="shrink-0 rounded-xl"
      style={{
        width: 36,
        height: 36,
        background: 'var(--g-accent-gradient)',
        boxShadow: '0 4px 14px rgba(15, 182, 203, 0.35)',
      }}
    />
  )

  const text = (
    <div className={centered ? 'text-center' : ''}>
      <p className="text-sm font-bold leading-tight" style={{ color: 'var(--g-text)' }}>
        VTC Scorecard
      </p>
      {showSubtitle && (
        <p className="text-[10px] leading-tight mt-0.5" style={{ color: 'var(--g-dim)' }}>
          Vendor &amp; Trade Performance
        </p>
      )}
    </div>
  )

  if (centered) {
    return (
      <div className="flex flex-col items-center gap-2.5">
        {mark}
        {text}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5">
      {mark}
      {text}
    </div>
  )
}
