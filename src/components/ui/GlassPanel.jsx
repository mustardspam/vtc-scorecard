import { cn } from '../../lib/cn'

export default function GlassPanel({ className, children, ...props }) {
  return (
    <div className={cn('glass-panel', className)} {...props}>
      {children}
    </div>
  )
}
