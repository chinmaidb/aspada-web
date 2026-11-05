<script lang="ts">
  import { onMount } from 'svelte'
  import toast from 'svelte-french-toast'
  import { fade, slide } from 'svelte/transition'
  import pb from '../../lib/pb'
  import { Collections, type LeadsResponse, LeadsStatusOptions } from '../../types/pocketbase-types'

  // State using Svelte 5 runes
  let leads = $state<LeadsResponse[]>([])
  let loading = $state(true)
  let searchTerm = $state('')
  let statusFilter = $state<string>('All')
  let selectedLeadId = $state<string | null>(null)
  let showStats = $state(true)

  // Derived state for filtering and stats
  const filteredLeads = $derived(
    leads.filter((lead) => {
      const matchesSearch =
        !searchTerm ||
        lead.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.contactNo?.includes(searchTerm) ||
        lead.contactEmail?.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesStatus = statusFilter === 'All' || lead.status === statusFilter

      return matchesSearch && matchesStatus
    })
  )

  const selectedLead = $derived(leads.find((l) => l.id === selectedLeadId) || null)

  const stats = $derived({
    total: leads.length,
    new: leads.filter((l) => l.status === LeadsStatusOptions.New).length,
    qualified: leads.filter((l) => l.status === LeadsStatusOptions.Qualified).length,
    closed: leads.filter((l) => l.status === LeadsStatusOptions.Closed).length,
  })

  async function fetchLeads() {
    loading = true
    try {
      const records = await pb.collection(Collections.Leads).getFullList({
        sort: '-created',
      })
      leads = records
    } catch (error) {
      console.error('Error fetching leads:', error)
      toast.error('Failed to load leads')
    } finally {
      loading = false
    }
  }

  async function updateLeadStatus(leadId: string, newStatus: LeadsStatusOptions) {
    try {
      const record = await pb.collection(Collections.Leads).update(leadId, {
        status: newStatus,
      })
      leads = leads.map((l) => (l.id === leadId ? (record as LeadsResponse) : l))
      toast.success(`Lead marked as ${newStatus}`)
    } catch (error) {
      toast.error('Update failed')
    }
  }

  async function deleteLead(leadId: string) {
    if (!confirm('Are you sure you want to delete this lead?')) return
    try {
      await pb.collection(Collections.Leads).delete(leadId)
      leads = leads.filter((l) => l.id !== leadId)
      if (selectedLeadId === leadId) selectedLeadId = null
      toast.success('Lead deleted')
    } catch (error) {
      toast.error('Delete failed')
    }
  }

  onMount(() => {
    fetchLeads()

    // Real-time subscription
    const unsubscribePromise = pb.collection(Collections.Leads).subscribe('*', (e) => {
      if (e.action === 'create') {
        leads = [e.record as LeadsResponse, ...leads]
      } else if (e.action === 'update') {
        leads = leads.map((l) => (l.id === e.record.id ? (e.record as LeadsResponse) : l))
      } else if (e.action === 'delete') {
        leads = leads.filter((l) => l.id !== e.record.id)
      }
    })

    return () => {
      unsubscribePromise.then((unsubscribe) => unsubscribe())
    }
  })

  function getStatusColor(status: string) {
    switch (status) {
      case 'New':
        return 'bg-blue-500'
      case 'Contacted':
        return 'bg-purple-500'
      case 'Qualified':
        return 'bg-emerald-500'
      case 'Site Visit':
        return 'bg-cyan-500'
      case 'Negotiation':
        return 'bg-amber-500'
      case 'Closed':
        return 'bg-green-600'
      case 'Lost':
        return 'bg-rose-500'
      default:
        return 'bg-slate-400'
    }
  }

  const statusOptions = ['All', ...Object.values(LeadsStatusOptions)]
</script>

<div class="flex flex-col h-full gap-6 p-4 md:p-8 font-sans bg-slate-50/50">
  <!-- Header & Stats -->
  <header class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <div>
          <h1 class="text-4xl font-black text-aspada-navy tracking-tight">Leads Manager</h1>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button
          onclick={fetchLeads}
          class="p-4 rounded-2xl bg-white border border-slate-200 text-aspada-navy hover:border-aspada-gold transition-all shadow-sm group"
          title="Refresh Data"
        >
          <span
            class="i-lucide-refresh-cw group-active:rotate-180 transition-transform duration-500"
          ></span>
        </button>
        <button
          title="Stats"
          onclick={() => (showStats = !showStats)}
          class="p-4 rounded-2xl bg-white border border-slate-200 text-aspada-navy hover:border-aspada-gold transition-all shadow-sm"
        >
          <span class={showStats ? 'i-lucide-chart-bar-off' : 'i-lucide-chart-bar'}></span>
        </button>
        <button
          onclick={() => toast.success('New Lead form coming soon!')}
          class="flex items-center gap-2 px-6 py-4 bg-aspada-gold text-aspada-navy font-black uppercase tracking-widest text-xs rounded-2xl shadow-xl shadow-aspada-gold/20 hover:-translate-y-1 transition-all"
        >
          <span class="i-lucide-user-plus"></span>
          Add New Lead
        </button>
      </div>
    </div>

    {#if showStats}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4" transition:slide>
        {#each [{ label: 'Total Leads', value: stats.total, color: 'from-aspada-navy to-aspada-steel' }, { label: 'New', value: stats.new, color: 'from-blue-500 to-blue-600' }, { label: 'Qualified', value: stats.qualified, color: 'from-emerald-500 to-emerald-600' }, { label: 'Closed', value: stats.closed, color: 'from-aspada-gold to-yellow-600' }] as stat}
          <div
            class="bg-gradient-to-br {stat.color} p-6 rounded-3xl text-white shadow-xl shadow-opacity-10 border border-white/10"
          >
            <p class="text-xs uppercase tracking-widest font-black opacity-60 mb-1">{stat.label}</p>
            <p class="text-3xl font-black">{stat.value}</p>
          </div>
        {/each}
      </div>
    {/if}
  </header>

  <!-- Main Content Area -->
  <div class="flex flex-1 gap-6 min-h-0">
    <!-- Leads List Panel -->
    <div
      class="w-full lg:w-2/5 flex flex-col gap-4 bg-white/60 backdrop-blur-xl border border-slate-200 rounded-[2.5rem] p-6 shadow-2xl shadow-slate-200/50"
    >
      <!-- Search & Filters -->
      <div class="space-y-4">
        <div class="relative group">
          <input
            type="text"
            bind:value={searchTerm}
            placeholder="Search by name, email or phone..."
            class="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl outline-none transition-all
                   focus:ring-4 focus:ring-aspada-gold/10 focus:border-aspada-gold/50 font-bold text-aspada-navy"
          />
          <span
            class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl group-focus-within:text-aspada-gold transition-colors"
          >
            <span class="i-lucide-search"></span>
          </span>
        </div>

        <div class="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {#each statusOptions as option}
            <button
              onclick={() => (statusFilter = option)}
              class="px-4 py-2 rounded-xl whitespace-nowrap text-xs font-black uppercase tracking-tight transition-all
                     {statusFilter === option
                ? 'bg-aspada-navy text-white shadow-lg'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}"
            >
              {option}
            </button>
          {/each}
        </div>
      </div>

      <!-- Scrollable List -->
      <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {#if loading}
          <div class="flex flex-col items-center justify-center h-full gap-4 text-aspada-steel">
            <div
              class="w-12 h-12 border-4 border-aspada-gold border-t-transparent rounded-full animate-spin"
            ></div>
            <p class="font-bold animate-pulse">Fetching leads...</p>
          </div>
        {:else if filteredLeads.length === 0}
          <div class="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
            <span class="i-lucide-users text-6xl opacity-20"></span>
            <p class="font-bold">No leads found</p>
          </div>
        {:else}
          <div class="space-y-3">
            {#each filteredLeads as lead (lead.id)}
              <button
                onclick={() => (selectedLeadId = lead.id)}
                class="w-full group text-left p-5 rounded-3xl border-2 transition-all relative overflow-hidden
                       {selectedLeadId === lead.id
                  ? 'border-aspada-gold bg-aspada-gold/5 shadow-inner'
                  : 'border-slate-50 bg-white hover:border-slate-200 hover:shadow-lg hover:-translate-y-0.5'}"
              >
                <div class="flex justify-between items-start gap-4">
                  <div class="min-w-0">
                    <p class="font-black text-aspada-navy truncate text-lg">
                      {lead.fullName || 'Anonymous'}
                    </p>
                    <p class="text-xs text-aspada-steel font-medium truncate mt-0.5 opacity-70">
                      {lead.contactEmail || 'No email'} • {lead.contactNo || 'No phone'}
                    </p>
                  </div>
                  <div class="flex flex-col items-end gap-2">
                    <span
                      class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-white shadow-sm {getStatusColor(
                        lead.status || ''
                      )}"
                    >
                      {lead.status}
                    </span>
                    <span class="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">
                      {new Date(lead.created).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {#if selectedLeadId === lead.id}
                  <div
                    class="absolute bottom-0 left-0 h-1 bg-aspada-gold w-full"
                    transition:fade
                  ></div>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Lead Details Panel -->
    <div
      class="hidden lg:flex lg:w-3/5 flex-col bg-white/60 backdrop-blur-xl border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-2xl shadow-slate-200/50"
    >
      {#if selectedLead}
        <div class="flex flex-col h-full" transition:fade>
          <!-- Detail Header -->
          <div class="p-8 bg-gradient-to-r from-aspada-navy to-aspada-steel text-white relative">
            <div class="flex justify-between items-start">
              <div>
                <h2 class="text-3xl font-black tracking-tight">{selectedLead.fullName}</h2>
                <p class="text-white/60 font-bold text-sm mt-1 uppercase tracking-widest">
                  Lead ID: {selectedLead.id}
                </p>
              </div>
              <button
                onclick={() => deleteLead(selectedLead!.id)}
                class="p-3 bg-rose-500/20 hover:bg-rose-500 text-white rounded-2xl transition-all border border-white/10"
                title="Delete Lead"
              >
                <span class="i-lucide-trash-2"></span>
              </button>
            </div>

            <div class="flex gap-4 mt-8">
              <div
                class="flex-1 bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10"
              >
                <p class="text-[10px] uppercase font-black text-white/50 mb-1">Source</p>
                <p class="font-bold flex items-center gap-2">
                  <span class="i-lucide-globe text-aspada-gold"></span>
                  {selectedLead.source || 'Unknown'}
                </p>
              </div>
              <div
                class="flex-1 bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10"
              >
                <p class="text-[10px] uppercase font-black text-white/50 mb-1">Created</p>
                <p class="font-bold flex items-center gap-2">
                  <span class="i-lucide-calendar text-aspada-gold"></span>
                  {new Date(selectedLead.created).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          <!-- Detail Content -->
          <div class="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
            <!-- Contact Info -->
            <section>
              <h3
                class="text-xs uppercase tracking-widest font-black text-slate-400 mb-4 flex items-center gap-2"
              >
                <span class="i-lucide-contact"></span> Contact Information
              </h3>
              <div class="grid grid-cols-2 gap-4">
                <div
                  class="bg-slate-50 p-5 rounded-3xl border border-slate-100 group hover:border-aspada-gold/30 transition-all"
                >
                  <p class="text-[10px] uppercase font-black text-slate-400 mb-1">Email Address</p>
                  <a
                    href="mailto:{selectedLead.contactEmail}"
                    class="font-bold text-aspada-navy hover:text-aspada-gold transition-colors break-all"
                  >
                    {selectedLead.contactEmail || 'Not provided'}
                  </a>
                </div>
                <div
                  class="bg-slate-50 p-5 rounded-3xl border border-slate-100 group hover:border-aspada-gold/30 transition-all"
                >
                  <p class="text-[10px] uppercase font-black text-slate-400 mb-1">Phone Number</p>
                  <a
                    href="tel:{selectedLead.contactNo}"
                    class="font-bold text-aspada-navy hover:text-aspada-gold transition-colors"
                  >
                    {selectedLead.contactNo || 'Not provided'}
                  </a>
                </div>
              </div>
            </section>

            <!-- Interests & Preferences -->
            <section>
              <h3
                class="text-xs uppercase tracking-widest font-black text-slate-400 mb-4 flex items-center gap-2"
              >
                <span class="i-lucide-heart"></span> Interests & Preferences
              </h3>
              <div class="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-6">
                <div>
                  <p class="text-[10px] uppercase font-black text-slate-400 mb-2">Interested In</p>
                  <p
                    class="text-aspada-navy font-bold text-lg leading-relaxed bg-white p-4 rounded-2xl border border-slate-200"
                  >
                    {selectedLead.interest || 'No interest details shared.'}
                  </p>
                </div>

                <div class="grid grid-cols-2 gap-6">
                  <div>
                    <p class="text-[10px] uppercase font-black text-slate-400 mb-1">
                      Preferred Location
                    </p>
                    <p class="font-bold text-aspada-navy">
                      {selectedLead.preferredLocation || 'Any'}
                    </p>
                  </div>
                  <div>
                    <p class="text-[10px] uppercase font-black text-slate-400 mb-1">Budget Range</p>
                    <p class="font-bold text-aspada-navy">
                      {#if selectedLead.budgetMin || selectedLead.budgetMax}
                        ₹{selectedLead.budgetMin?.toLocaleString() || '0'} - ₹{selectedLead.budgetMax?.toLocaleString() ||
                          'Any'}
                      {:else}
                        Not specified
                      {/if}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <!-- Status Management -->
            <section>
              <h3
                class="text-xs uppercase tracking-widest font-black text-slate-400 mb-4 flex items-center gap-2"
              >
                <span class="i-lucide-trello"></span> Update Lead Status
              </h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {#each Object.values(LeadsStatusOptions) as status}
                  <button
                    onclick={() => updateLeadStatus(selectedLead!.id, status)}
                    class="p-3 rounded-2xl border-2 text-[10px] font-black uppercase tracking-tight transition-all
                           {selectedLead.status === status
                      ? 'bg-aspada-navy text-white border-aspada-navy'
                      : 'bg-white text-slate-500 border-slate-100 hover:border-aspada-gold'}"
                  >
                    {status}
                  </button>
                {/each}
              </div>
            </section>
          </div>

          <!-- Footer Actions -->
          <div class="p-6 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
            <button
              class="px-6 py-3 rounded-2xl bg-white border border-slate-200 text-aspada-navy font-black uppercase tracking-widest text-xs hover:bg-slate-100 transition-all"
              onclick={() => (selectedLeadId = null)}
            >
              Close
            </button>
            <button
              class="px-6 py-3 rounded-2xl bg-aspada-gold text-aspada-navy font-black uppercase tracking-widest text-xs shadow-lg hover:shadow-aspada-gold/20 transition-all"
              onclick={() => toast.success('Lead details saved')}
            >
              Save Notes
            </button>
          </div>
        </div>
      {:else}
        <div
          class="flex flex-col items-center justify-center h-full text-slate-300 gap-6 p-12 text-center"
          transition:fade
        >
          <div
            class="w-24 h-24 rounded-full bg-slate-50 flex items-center justify-center border-4 border-dashed border-slate-200"
          >
            <span class="i-lucide-user-check text-4xl"></span>
          </div>
          <div>
            <h3 class="text-2xl font-black text-slate-400">Select a lead</h3>
            <p class="font-medium mt-2 max-w-xs">
              Choose a lead from the list to view their full profile and manage their status.
            </p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
  .no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 6px;
  }
  .custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
  }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
  }
</style>
