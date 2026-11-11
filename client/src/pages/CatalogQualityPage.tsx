import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, CheckCircle2, CircleAlert, Database,
  Download, Filter, Plus, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'

type CatalogModel = {
  id: number
  platform: string
  modelId: string
  displayName: string
  intelligenceRank: number
  speedRank: number
  sizeLabel: string
  contextWindow: number | null
  enabled: boolean
  supportsVision: boolean
  supportsTools: boolean
  source: 'catalog' | 'custom' | 'discovered'
  keyCount: number
  hasProvider: boolean
}

type ImportRow = { platform: string; modelId: string; displayName?: string; contextWindow?: number; supportsVision: boolean; supportsTools: boolean; line: number }

type Filters = {
  query: string
  platform: string
  source: string
  capability: string
  availability: string
  context: string
  sort: string
}

const initialFilters: Filters = {
  query: '',
  platform: 'all',
  source: 'all',
  capability: 'all',
  availability: 'all',
  context: 'all',
  sort: 'intelligence',
}

function formatContext(value: number | null) {
  if (!value) return 'Not listed'
  return value >= 1_000_000
    ? (value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1) + 'M'
    : value >= 1_000
      ? Math.round(value / 1_000) + 'K'
      : value.toLocaleString()
}

function rankLabel(value: number | null | undefined) {
  return value && value > 0 ? '#' + value : 'Not measured'
}

function exportCsv(rows: CatalogModel[]) {
  const columns: (keyof CatalogModel)[] = [
    'platform', 'displayName', 'modelId', 'source', 'enabled',
    'supportsVision', 'supportsTools', 'contextWindow', 'intelligenceRank',
    'speedRank', 'keyCount',
  ]
  const quote = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"'
  const csv = [
    columns.join(','),
    ...rows.map(row => columns.map(column => quote(row[column])).join(',')),
  ].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'freellmapi-filtered-model-catalog.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}


function parseModelCsv(input: string): ImportRow[] {
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some(value => value.trim())) records.push(row)
      row = []
    } else {
      cell += char
    }
  }
  row.push(cell)
  if (row.some(value => value.trim())) records.push(row)
  if (records.length < 2) return []
  const headers = records[0].map(value => value.trim().toLowerCase().replace(/[ _-]/g, ''))
  const index = (...names: string[]) => headers.findIndex(header => names.includes(header))
  const platformIndex = index('platform', 'provider')
  const idIndex = index('modelid', 'id', 'model')
  const nameIndex = index('displayname', 'name')
  const contextIndex = index('contextwindow', 'context')
  const visionIndex = index('supportsvision', 'vision')
  const toolsIndex = index('supportstools', 'tools', 'tooluse')
  if (platformIndex < 0 || idIndex < 0) throw new Error('CSV needs platform/provider and modelId/model columns.')
  const truthy = (value: string) => ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase())
  return records.slice(1).map((values, offset) => {
    const get = (column: number) => column < 0 ? '' : (values[column] ?? '').trim()
    const contextRaw = get(contextIndex)
    const context = contextRaw ? Number(contextRaw) : undefined
    return {
      platform: get(platformIndex),
      modelId: get(idIndex),
      ...(get(nameIndex) ? { displayName: get(nameIndex) } : {}),
      ...(context && Number.isSafeInteger(context) && context > 0 ? { contextWindow: context } : {}),
      supportsVision: truthy(get(visionIndex)),
      supportsTools: truthy(get(toolsIndex)),
      line: offset + 2,
    }
  })
}

export default function CatalogQualityPage() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [limit, setLimit] = useState(50)
  const [addOpen, setAddOpen] = useState(false)
  const [newPlatform, setNewPlatform] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newContext, setNewContext] = useState('')
  const [newVision, setNewVision] = useState(false)
  const [newTools, setNewTools] = useState(true)
  const [bulkRows, setBulkRows] = useState<ImportRow[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const [bulkReport, setBulkReport] = useState<string | null>(null)

  const { data: models = [], isLoading, isError, error, dataUpdatedAt, refetch, isFetching } = useQuery<CatalogModel[]>({
    queryKey: ['catalog-models'],
    queryFn: () => apiFetch('/api/models'),
    refetchInterval: 5 * 60 * 1000,
  })

  const platformOptions = useMemo(
    () => [...new Set(models.filter(model => model.platform !== 'custom').map(model => model.platform))].sort((a, b) => a.localeCompare(b)),
    [models],
  )

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLocaleLowerCase()
    const result = models.filter(model => {
      if (q && ![model.displayName, model.modelId, model.platform].some(value => value.toLocaleLowerCase().includes(q))) return false
      if (filters.platform !== 'all' && model.platform !== filters.platform) return false
      if (filters.source !== 'all' && model.source !== filters.source) return false
      if (filters.capability === 'vision' && !model.supportsVision) return false
      if (filters.capability === 'tools' && !model.supportsTools) return false
      if (filters.capability === 'both' && !(model.supportsVision && model.supportsTools)) return false
      if (filters.availability === 'enabled' && !model.enabled) return false
      if (filters.availability === 'disabled' && model.enabled) return false
      if (filters.context !== 'all') {
        const minimum = Number(filters.context)
        if (!model.contextWindow || model.contextWindow < minimum) return false
      }
      return true
    })

    return result.sort((a, b) => {
      if (filters.sort === 'recent') return b.id - a.id
      if (filters.sort === 'speed') return (a.speedRank || 9999) - (b.speedRank || 9999)
      if (filters.sort === 'name') return a.displayName.localeCompare(b.displayName)
      if (filters.sort === 'provider') return a.platform.localeCompare(b.platform) || a.displayName.localeCompare(b.displayName)
      if (filters.sort === 'context') return (b.contextWindow || 0) - (a.contextWindow || 0)
      return (a.intelligenceRank || 9999) - (b.intelligenceRank || 9999)
    })
  }, [models, filters])

  const addMutation = useMutation({
    mutationFn: () => apiFetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: newPlatform,
        modelId: newModelId.trim(),
        ...(newDisplayName.trim() ? { displayName: newDisplayName.trim() } : {}),
        ...(newContext.trim() ? { contextWindow: Number(newContext) } : {}),
        supportsVision: newVision,
        supportsTools: newTools,
      }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['catalog-models'] })
      setAddOpen(false)
      setNewModelId('')
      setNewDisplayName('')
      setNewContext('')
      setNewVision(false)
      setNewTools(true)
    },
  })


  const handleCsvFile = async (file?: File) => {
    if (!file) return
    setBulkReport(null)
    try {
      const rows = parseModelCsv(await file.text())
      if (rows.length > 1000) throw new Error('One import is limited to 1,000 rows. Split larger files into batches.')
      if (rows.length === 0) throw new Error('No model rows found. Add a header row and at least one model.')
      setBulkRows(rows)
      setBulkProgress({ done: 0, total: rows.length })
    } catch (cause) {
      setBulkRows([])
      setBulkReport(cause instanceof Error ? cause.message : 'Could not read this CSV file.')
    }
  }

  const importCsvRows = async () => {
    if (!bulkRows.length || bulkBusy) return
    setBulkBusy(true)
    setBulkReport(null)
    const knownProviders = new Set(platformOptions)
    const existing = new Set(models.map(model => model.platform.toLowerCase() + '::' + model.modelId.toLowerCase()))
    const seen = new Set<string>()
    const candidates = bulkRows.filter(row => {
      const key = row.platform.toLowerCase() + '::' + row.modelId.toLowerCase()
      if (!row.platform || !row.modelId || !knownProviders.has(row.platform) || existing.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    let added = 0
    let failed = 0
    let skipped = bulkRows.length - candidates.length
    let cursor = 0
    setBulkProgress({ done: 0, total: bulkRows.length })
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < candidates.length) {
        const row = candidates[cursor++]
        try {
          await apiFetch('/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: row.platform,
              modelId: row.modelId,
              ...(row.displayName ? { displayName: row.displayName } : {}),
              ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}),
              supportsVision: row.supportsVision,
              supportsTools: row.supportsTools,
            }),
          })
          added++
        } catch {
          failed++
        } finally {
          setBulkProgress(current => ({ ...current, done: current.done + 1 }))
        }
      }
    }))
    skipped += bulkRows.length - candidates.length
    await queryClient.invalidateQueries({ queryKey: ['catalog-models'] })
    setBulkReport('Import complete: ' + added + ' added, ' + skipped + ' skipped (duplicates/unknown providers/invalid rows), ' + failed + ' failed.')
    setBulkRows([])
    setBulkBusy(false)
  }

  const update = (patch: Partial<Filters>) => {
    setFilters(current => ({ ...current, ...patch }))
    setLimit(50)
  }
  const enabledCount = models.filter(model => model.enabled).length
  const visionCount = models.filter(model => model.supportsVision).length
  const toolCount = models.filter(model => model.supportsTools).length
  const measuredCount = models.filter(model => model.intelligenceRank > 0 || model.speedRank > 0).length
  const shown = filtered.slice(0, limit)
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString() : 'Not yet refreshed'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog Quality Lab"
        description="Search, filter and compare every model currently registered in this FreeLLMAPI instance. New provider-sync and manually added models appear after refresh."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Registered models', value: models.length.toLocaleString(), detail: 'Live API catalog response', icon: Database },
          { label: 'Enabled models', value: enabledCount.toLocaleString(), detail: 'Currently marked enabled', icon: CheckCircle2 },
          { label: 'Vision capable', value: visionCount.toLocaleString(), detail: 'Provider capability metadata', icon: Activity },
          { label: 'Tools capable', value: toolCount.toLocaleString(), detail: 'Tool-use capability metadata', icon: ShieldCheck },
        ].map(item => (
          <div key={item.label} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{item.label}</span><item.icon className="size-4" />
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</div>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Filter the catalog</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {filtered.length.toLocaleString()} matching of {models.length.toLocaleString()} registered models
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">
              <Plus className="size-4" /> Import CSV (up to 1,000)
              <input type="file" accept=".csv,text/csv" className="sr-only" disabled={bulkBusy} onChange={event => { void handleCsvFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
            </label>
            <Button variant="outline" size="sm" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
              <Download className="size-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button size="sm" onClick={() => { setNewPlatform(platformOptions[0] ?? ''); setAddOpen(true) }} disabled={platformOptions.length === 0}>
              <Plus className="size-4" /> Add model
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="xl:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Search name, model ID or provider</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={filters.query} onChange={event => update({ query: event.target.value })} placeholder="Search 1,000+ models…" className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Provider</span>
            <select value={filters.platform} onChange={event => update({ platform: event.target.value })} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="all">All providers</option>
              {platformOptions.map(platform => <option key={platform} value={platform}>{platform}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Catalog source</span>
            <select value={filters.source} onChange={event => update({ source: event.target.value })} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="all">All sources</option>
              <option value="catalog">Provider catalog</option>
              <option value="discovered">Discovered</option>
              <option value="custom">Manually added</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Capability</span>
            <select value={filters.capability} onChange={event => update({ capability: event.target.value })} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="all">Any capability</option>
              <option value="vision">Vision</option>
              <option value="tools">Tool use</option>
              <option value="both">Vision + tool use</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Availability</span>
            <select value={filters.availability} onChange={event => update({ availability: event.target.value })} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="all">All states</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Minimum context window</span>
            <select value={filters.context} onChange={event => update({ context: event.target.value })} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="all">Any / not specified</option>
              <option value="32000">32K+</option>
              <option value="128000">128K+</option>
              <option value="1000000">1M+</option>
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Sort results</span>
            <select value={filters.sort} onChange={event => update({ sort: event.target.value })} className="h-10 w-full rounded-lg border bg-background px-3 text-sm">
              <option value="recent">Recently registered</option>
              <option value="intelligence">Intelligence rank</option>
              <option value="speed">Speed rank</option>
              <option value="context">Largest context first</option>
              <option value="provider">Provider</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Filter className="size-3.5" /> Filters run against the complete fetched catalog, not just the visible page.</span>
          <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => update(initialFilters)}>Clear filters</button>
        </div>
      </section>


      {(bulkRows.length > 0 || bulkReport) && (
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-sm">Bulk model import</h2>
              <p className="mt-1 text-xs text-muted-foreground">Preview first. Only providers already present in this instance can be imported with this quick tool.</p>
            </div>
            {bulkRows.length > 0 && <Button size="sm" onClick={() => void importCsvRows()} disabled={bulkBusy}>{bulkBusy ? 'Importing…' : 'Import ' + bulkRows.length + ' CSV rows'}</Button>}
          </div>
          {bulkRows.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{bulkRows.length.toLocaleString()} rows read · {bulkProgress.done.toLocaleString()} / {bulkProgress.total.toLocaleString()} processed</p>
              <div className="max-h-48 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted"><tr><th className="p-2 text-left">Line</th><th className="p-2 text-left">Provider</th><th className="p-2 text-left">Model ID</th><th className="p-2 text-left">Capabilities</th></tr></thead>
                  <tbody>{bulkRows.slice(0, 12).map(row => <tr key={row.line} className="border-t"><td className="p-2">{row.line}</td><td className="p-2">{row.platform || '—'}</td><td className="p-2">{row.modelId || '—'}</td><td className="p-2">{[row.supportsVision ? 'Vision' : '', row.supportsTools ? 'Tools' : ''].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody>
                </table>
              </div>
              {bulkRows.length > 12 && <p className="text-xs text-muted-foreground">Showing first 12 rows in preview; all {bulkRows.length.toLocaleString()} rows are considered on import.</p>}
            </>
          )}
          {bulkReport && <p role="status" className="text-sm">{bulkReport}</p>}
        </section>
      )}

      {isLoading && <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">Loading registered models…</div>}
      {isError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium"><CircleAlert className="size-4" /> Could not load the model catalog</div>
          <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : 'The API request failed.'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
        </div>
      )}
      {!isLoading && !isError && (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="font-semibold text-sm">Model results</div>
            <div className="text-xs text-muted-foreground">Showing {shown.length.toLocaleString()} / {filtered.length.toLocaleString()}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Model / provider</th>
                  <th className="px-3 py-3 font-medium">Source</th>
                  <th className="px-3 py-3 font-medium">Capabilities</th>
                  <th className="px-3 py-3 font-medium">Context</th>
                  <th className="px-3 py-3 font-medium">Intelligence rank</th>
                  <th className="px-3 py-3 font-medium">Speed rank</th>
                  <th className="px-3 py-3 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(model => (
                  <tr key={model.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{model.displayName}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{model.platform} · {model.modelId}</div>
                    </td>
                    <td className="px-3 py-3"><span className="rounded-md bg-muted px-2 py-1 text-xs">{model.source}</span></td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {model.supportsVision && <span className="rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-700 dark:text-blue-300">Vision</span>}
                        {model.supportsTools && <span className="rounded-md bg-teal-500/10 px-2 py-1 text-xs text-teal-700 dark:text-teal-300">Tools</span>}
                        {!model.supportsVision && !model.supportsTools && <span className="text-xs text-muted-foreground">Not listed</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{formatContext(model.contextWindow)}</td>
                    <td className="px-3 py-3 tabular-nums">{rankLabel(model.intelligenceRank)}</td>
                    <td className="px-3 py-3 tabular-nums">{rankLabel(model.speedRank)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${model.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                        {model.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No models match these filters. Try clearing one or more filters.</td></tr>}
              </tbody>
            </table>
          </div>
          {shown.length < filtered.length && (
            <div className="border-t p-4 text-center">
              <Button variant="outline" onClick={() => setLimit(value => value + 50)}>
                Load 50 more models
              </Button>
            </div>
          )}
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            Last refreshed: {lastUpdated} · Auto-refresh every 5 minutes while this page is open.
          </div>
        </section>
      )}

      <section className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Quality evidence, not marketing claims</p>
            <p>Capability labels and rank values come from this platform's registered model records. A rank is a recorded ordering signal, not an independent benchmark. Actual response speed, reliability, cost and output quality must be measured from real test runs before a model is promoted as superior.</p>
            <p>{measuredCount.toLocaleString()} models have at least one rank value recorded. Missing values are shown as “Not measured”; they are never treated as a zero-cost or perfect score.</p>
          </div>
        </div>
      </section>

      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAddOpen(false) }}>
          <div role="dialog" aria-modal="true" aria-labelledby="add-model-title" className="w-full max-w-lg rounded-xl border bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="add-model-title" className="font-semibold">Add a provider model</h2>
                <p className="mt-1 text-xs text-muted-foreground">Adds a model record through the existing platform API.</p>
              </div>
              <button type="button" aria-label="Close" className="rounded-md p-2 hover:bg-muted" onClick={() => setAddOpen(false)}><X className="size-4" /></button>
            </div>
            <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); addMutation.mutate() }}>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Provider</span>
                <select required value={newPlatform} onChange={event => setNewPlatform(event.target.value)} className="h-10 w-full rounded-lg border bg-background px-3">
                  {platformOptions.map(platform => <option key={platform} value={platform}>{platform}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Model ID</span>
                <input required value={newModelId} onChange={event => setNewModelId(event.target.value)} placeholder="provider/model-id" className="h-10 w-full rounded-lg border bg-background px-3" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Display name (optional)</span>
                <input value={newDisplayName} onChange={event => setNewDisplayName(event.target.value)} placeholder="Readable model name" className="h-10 w-full rounded-lg border bg-background px-3" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">Context window in tokens (optional)</span>
                <input type="number" min="1" value={newContext} onChange={event => setNewContext(event.target.value)} placeholder="128000" className="h-10 w-full rounded-lg border bg-background px-3" />
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={newVision} onChange={event => setNewVision(event.target.checked)} /> Vision</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={newTools} onChange={event => setNewTools(event.target.checked)} /> Tool use</label>
              </div>
              {addMutation.isError && <p role="alert" className="text-sm text-destructive">{addMutation.error instanceof Error ? addMutation.error.message : 'Could not add model.'}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={addMutation.isPending || !newPlatform || !newModelId.trim()}>
                  {addMutation.isPending ? 'Adding…' : 'Add model'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
