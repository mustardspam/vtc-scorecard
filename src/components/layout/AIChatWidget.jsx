import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { MessageSquare, X, Send, Loader2, Sparkles } from 'lucide-react'

export default function AIChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out — try again`)), ms)),
    ])
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setError('')
    const nextMessages = [...messages, { role: 'user', text }]
    setMessages(nextMessages)
    setSending(true)

    try {
      const token = useAuth.getState().session?.access_token
      if (!token) throw new Error('Not signed in')

      const controller = new AbortController()
      const res = await withTimeout(
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: text, history: nextMessages }),
          signal: controller.signal,
        }).catch(err => { throw err }),
        40000,
        'Request'
      ).catch(err => { controller.abort(); throw err })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setMessages(prev => [...prev, { role: 'assistant', text: data.reply }])
    } catch (err) {
      setError(err.message)
      setMessages(prev => prev.slice(0, -1))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {open && (
        <div className="ai-chat-panel">
          <div className="ai-chat-header">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--g-accent)' }} />
              <span className="font-semibold text-[13px]" style={{ color: 'var(--g-text)' }}>Ask about your data</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="bg-transparent border-none cursor-pointer" style={{ color: 'var(--g-dim)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2.5">
            {messages.length === 0 && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--g-dim)' }}>
                Ask questions about vendor scores, communities, or feedback — e.g. &quot;which vendors have the lowest scores&quot; or &quot;any recent complaints in Houston.&quot;
                <br /><br />
                Read-only — this can&apos;t change any data.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ai-chat-bubble-user' : 'ai-chat-bubble-assistant'}>
                {m.text}
              </div>
            ))}
            {sending && (
              <div className="self-start p-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--g-dim)' }} />
              </div>
            )}
            {error && <p className="text-[11px]" style={{ color: '#a72727' }}>{error}</p>}
          </div>

          <div className="p-2.5 border-t flex gap-1.5" style={{ borderColor: 'var(--g-line)' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask a question..."
              disabled={sending}
              className="glass-input flex-1"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="glass-btn-primary px-3 flex items-center justify-center disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={() => setOpen(o => !o)} title="Ask about your data" className="ai-chat-fab">
        {open ? <X className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
      </button>
    </>
  )
}
