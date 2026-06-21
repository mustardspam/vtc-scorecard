import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { MessageCircle, X, Send, Loader2, Sparkles } from 'lucide-react'

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
      const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 8000, 'Checking session')
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Not signed in')

      const controller = new AbortController()
      const res = await withTimeout(
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: text, history: nextMessages }),
          signal: controller.signal,
        }).catch(err => { throw err }),
        25000,
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
        <div style={{
          position: 'fixed', bottom: '88px', right: '24px', width: '340px', height: '460px',
          background: '#fff', borderRadius: '12px', border: '1px solid #e5e3db',
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column',
          zIndex: 1000,
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0ede4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles style={{ width: '16px', height: '16px', color: '#087482' }} />
              <span style={{ fontWeight: 600, fontSize: '13px', color: '#1a1a18' }}>Ask about your data</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>
              <X style={{ width: '16px', height: '16px' }} />
            </button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {messages.length === 0 && (
              <p style={{ fontSize: '12px', color: '#aaa', lineHeight: 1.5 }}>
                Ask questions about vendor scores, communities, or feedback — e.g. "which vendors have the lowest scores" or "any recent complaints in Houston."
                <br /><br />
                Read-only — this can't change any data.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%', padding: '8px 11px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.45,
                background: m.role === 'user' ? '#087482' : '#f5f4ef',
                color: m.role === 'user' ? '#fff' : '#333',
                whiteSpace: 'pre-wrap',
              }}>
                {m.text}
              </div>
            ))}
            {sending && (
              <div style={{ alignSelf: 'flex-start', padding: '8px 11px' }}>
                <Loader2 style={{ width: '14px', height: '14px', color: '#aaa', animation: 'spin 0.8s linear infinite' }} />
              </div>
            )}
            {error && (
              <p style={{ fontSize: '11px', color: '#c0392b' }}>{error}</p>
            )}
          </div>

          <div style={{ padding: '10px', borderTop: '1px solid #f0ede4', display: 'flex', gap: '6px' }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Ask a question..."
              disabled={sending}
              style={{ flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              style={{
                padding: '8px 10px', borderRadius: '8px', border: 'none',
                background: sending || !input.trim() ? '#e0e0e0' : '#087482',
                color: '#fff', cursor: sending || !input.trim() ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Send style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(o => !o)}
        title="Ask about your data"
        style={{
          position: 'fixed', bottom: '24px', right: '24px', width: '52px', height: '52px',
          borderRadius: '50%', background: '#087482', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 14px rgba(0,0,0,0.2)', zIndex: 1000,
        }}
      >
        {open ? <X style={{ width: '22px', height: '22px', color: '#fff' }} /> : <MessageCircle style={{ width: '22px', height: '22px', color: '#fff' }} />}
      </button>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}
