import { useState } from 'react'
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
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
      </div>

      <div className="flex gap-2 border-b border-gray-200 pb-px">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
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
