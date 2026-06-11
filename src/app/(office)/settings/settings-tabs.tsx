'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CompanyForm, type SettingsRow } from './company-form'
import { UsersSection, type ProfileRow } from './users-section'
import { RatesSection, type RateItemRow } from './rates-section'
import { CostCodesSection, type CostCodeRow } from './cost-codes-section'
import { PlantSection, type PlantRow } from './plant-section'
import {
  ChecklistsSection,
  type ChecklistTemplateRow,
} from './checklists-section'

export type SettingsTab =
  | 'company'
  | 'users'
  | 'rates'
  | 'cost-codes'
  | 'plant'
  | 'checklists'

const TABS: { value: SettingsTab; label: string }[] = [
  { value: 'company', label: 'Company' },
  { value: 'users', label: 'Users' },
  { value: 'rates', label: 'Rates' },
  { value: 'cost-codes', label: 'Cost codes' },
  { value: 'plant', label: 'Plant' },
  { value: 'checklists', label: 'Checklists' },
]

interface SettingsTabsProps {
  initialTab: SettingsTab
  settings: SettingsRow | null
  profiles: ProfileRow[]
  rateItems: RateItemRow[]
  costCodes: CostCodeRow[]
  plant: PlantRow[]
  checklists: ChecklistTemplateRow[]
}

export function SettingsTabs({
  initialTab,
  settings,
  profiles,
  rateItems,
  costCodes,
  plant,
  checklists,
}: SettingsTabsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)

  function handleChange(value: unknown) {
    const next = value as SettingsTab
    setTab(next)
    // Keep the URL shareable without a server round-trip.
    window.history.replaceState(null, '', `/settings?tab=${next}`)
  }

  return (
    <Tabs value={tab} onValueChange={handleChange}>
      <TabsList className="flex-wrap">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="px-3">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="company" className="pt-4">
        <CompanyForm settings={settings} />
      </TabsContent>
      <TabsContent value="users" className="pt-4">
        <UsersSection profiles={profiles} />
      </TabsContent>
      <TabsContent value="rates" className="pt-4">
        <RatesSection rateItems={rateItems} />
      </TabsContent>
      <TabsContent value="cost-codes" className="pt-4">
        <CostCodesSection costCodes={costCodes} />
      </TabsContent>
      <TabsContent value="plant" className="pt-4">
        <PlantSection plant={plant} />
      </TabsContent>
      <TabsContent value="checklists" className="pt-4">
        <ChecklistsSection checklists={checklists} />
      </TabsContent>
    </Tabs>
  )
}
