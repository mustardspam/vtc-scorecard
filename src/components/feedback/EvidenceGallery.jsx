import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { FileText, Image as ImageIcon } from 'lucide-react'

const SIGNED_URL_TTL = 60 * 60 // 1 hour

function formatBytes(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Renders evidence attachments (from builder_feedback.evidence_photos) as a row of
 * signed-URL thumbnails / file chips. The `uploads` bucket is private, so each path is
 * exchanged for a short-lived signed URL on mount.
 */
export default function EvidenceGallery({ photos }) {
  const [urls, setUrls] = useState({})

  const items = Array.isArray(photos) ? photos.filter(p => p?.path) : []

  useEffect(() => {
    let mounted = true
    if (items.length === 0) return
    const paths = items.map(p => p.path)
    supabase.storage
      .from('uploads')
      .createSignedUrls(paths, SIGNED_URL_TTL)
      .then(({ data, error }) => {
        if (error || !mounted || !data) return
        const map = {}
        data.forEach((row, i) => {
          if (row?.signedUrl) map[paths[i]] = row.signedUrl
        })
        setUrls(map)
      })
    return () => { mounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map(p => p.path).join('|')])

  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 mt-2.5">
      {items.map((f) => {
        const url = urls[f.path]
        const isImage = f.type?.startsWith('image/')
        const title = `${f.name || 'attachment'}${f.size ? ` · ${formatBytes(f.size)}` : ''}`

        if (isImage) {
          return (
            <a
              key={f.path}
              href={url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={title}
              className="block w-14 h-14 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 hover:border-gray-400 transition-colors"
            >
              {url ? (
                <img src={url} alt={f.name || 'evidence'} className="w-full h-full object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full">
                  <ImageIcon className="w-4 h-4 text-gray-300" />
                </span>
              )}
            </a>
          )
        }

        return (
          <a
            key={f.path}
            href={url || undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={title}
            className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-600 hover:border-gray-400 transition-colors max-w-[180px]"
          >
            <FileText className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
            <span className="truncate">{f.name || 'Attachment'}</span>
          </a>
        )
      })}
    </div>
  )
}
