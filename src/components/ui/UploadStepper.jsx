export default function UploadStepper({ step }) {
  const steps = [
    { id: 'upload', label: 'Upload' },
    { id: 'map-columns', label: 'Map Columns' },
    { id: 'vendor-match', label: 'Match Vendors' },
    { id: 'preview', label: 'Review' },
    { id: 'done', label: 'Import' },
  ]

  const activeIdx = (() => {
    if (step === 'upload' || step === 'select-sheet' || step === 'jc-preview') return 0
    if (step === 'map-columns') return 1
    if (step === 'vendor-match') return 2
    if (step === 'preview') return 3
    if (step === 'done') return 4
    return 0
  })()

  return (
    <div className="glass-panel p-4 flex items-center justify-between gap-2 flex-wrap">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 flex-1 min-w-[100px]">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{
              background: i <= activeIdx ? 'var(--g-accent-gradient)' : 'var(--g-panel-2)',
              color: i <= activeIdx ? '#fff' : 'var(--g-dim)',
              border: i > activeIdx ? '1px solid var(--g-line)' : 'none',
            }}
          >
            {i < activeIdx ? '✓' : i + 1}
          </div>
          <span className="text-xs font-semibold" style={{ color: i === activeIdx ? 'var(--g-accent)' : 'var(--g-dim)' }}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className="flex-1 h-px mx-1 hidden sm:block" style={{ background: i < activeIdx ? 'var(--g-accent)' : 'var(--g-line)' }} />}
        </div>
      ))}
    </div>
  )
}
