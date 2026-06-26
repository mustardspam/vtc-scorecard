import { useState } from 'react'
import { cn } from '../lib/cn'
import VendorManager from '../components/admin/VendorManager'
import CommunityManager from '../components/admin/CommunityManager'
import FeedbackRulesEditor from '../components/admin/FeedbackRulesEditor'
import SeverityRulesEditor from '../components/admin/SeverityRulesEditor'
import UserManager from '../components/admin/UserManager'
import ScoringConfig from '../components/admin/ScoringConfig'
import WeightHistory from '../components/admin/WeightHistory'
import DigestRecipients from '../components/admin/DigestRecipients'
import CommunityMapConfig from '../components/admin/CommunityMapConfig'
import { Settings, Users, Building2, MessageSquare, Shield, Calculator, History, Mail, Map } from 'lucide-react'

const TABS = [
  { id: 'vendors', label: 'Vendors / Trades', icon: Building2 },
  { id: 'communities', label: 'Communities', icon: Building2 },
  { id: 'community-map', label: 'Community Map', icon: Map },
  { id: 'feedback-rules', label: 'Feedback Rules', icon: MessageSquare },
  { id: 'severity-rules', label: 'Severity Rules', icon: Shield },
  { id: 'scoring', label: 'Scoring Config', icon: Calculator },
  { id: 'weight-history', label: 'Weight History', icon: History },
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'digest', label: 'Digest Recipients', icon: Mail },
]

export default function AdminPage() {
  const [tab, setTab] = useState('vendors')

  return (
    <div className="space-y-[18px]">
      <div className="flex items-center gap-2">
        <Settings className="w-6 h-6" style={{ color: 'var(--g-dim)' }} />
        <h1 className="glass-page-title">Admin Settings</h1>
      </div>

      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--g-line)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap', tab === t.id ? 'glass-tab-active' : 'glass-tab')}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="glass-panel p-6">
        {tab === 'vendors' && <VendorManager />}
        {tab === 'communities' && <CommunityManager />}
        {tab === 'community-map' && <CommunityMapConfig />}
        {tab === 'feedback-rules' && <FeedbackRulesEditor />}
        {tab === 'severity-rules' && <SeverityRulesEditor />}
        {tab === 'scoring' && <ScoringConfig />}
        {tab === 'weight-history' && <WeightHistory />}
        {tab === 'users' && <UserManager />}
        {tab === 'digest' && <DigestRecipients />}
      </div>
    </div>
  )
}
