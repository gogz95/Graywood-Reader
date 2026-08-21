import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Search,
  Zap,
  Clock,
  ShieldAlert,
  SlidersHorizontal,
  ExternalLink,
  Ban,
} from 'lucide-react';
import { apiFetch } from '../utils/api';

export interface SourceHealthEntry {
  id: string;
  name: string;
  domain: string;
  engine: string;
  status: string;
  httpStatus: number;
  latencyMs: number;
  challenge: string;
  circuitState?: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  circuitTrips?: number;
  circuitCoolingDownUntil?: number;
  isAlive?: boolean;
}

interface SourceHealthDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SourceHealthDashboardModal: React.FC<SourceHealthDashboardModalProps> = ({ isOpen, onClose }) => {
  const [sources, setSources] = useState<SourceHealthEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'challenged' | 'tripped'>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/sources/dashboard');
      if (res.ok) {
        const data = await res.json();
        const rawList: any[] = data.sources || data.items || [];
        const mapped: SourceHealthEntry[] = rawList.map((s: any) => ({
          id: s.id || s.sourceId || '',
          name: s.name || s.sourceName || s.id || 'Unknown',
          domain: s.domain || s.baseUrl ? s.baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : '',
          engine: s.engine || s.engineType || 'custom',
          status: s.status || (s.isAlive ? 'OK' : 'DOWN'),
          httpStatus: s.httpStatus || (s.isAlive ? 200 : 500),
          latencyMs: s.latencyMs || 0,
          challenge: s.challenge || 'None',
          circuitState: s.circuitState || (s.circuitOpen ? 'OPEN' : 'CLOSED'),
          circuitTrips: s.circuitTrips || 0,
          circuitCoolingDownUntil: s.circuitCoolingDownUntil,
          isAlive: s.isAlive !== false,
        }));
        setSources(mapped);
      }
    } catch (err: any) {
      console.error('Failed to load source health dashboard:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDashboardData();
    }
  }, [isOpen]);

  const handleResetCircuit = async (sourceId?: string) => {
    setIsResetting(true);
    try {
      const res = await apiFetch('/api/kotatsu/sources/circuit-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourceId ? { sourceId } : { all: true }),
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(sourceId ? `Circuit breaker for ${sourceId} reset!` : 'All circuit breakers reset to CLOSED!');
        setTimeout(() => setActionFeedback(null), 3500);
        await fetchDashboardData();
      }
    } catch (err: any) {
      setActionFeedback(`Reset failed: ${err.message}`);
      setTimeout(() => setActionFeedback(null), 3500);
    } finally {
      setIsResetting(false);
    }
  };

  const handleFlagBroken = async (sourceId: string, sourceName: string) => {
    if (!window.confirm(`Flag "${sourceName}" as broken and disable it? This will trip its circuit breaker and stop background updates for this source.`)) return;
    try {
      const res = await apiFetch('/api/kotatsu/sources/flag-broken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, reason: 'Flagged broken via health dashboard' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback(`"${sourceName}" flagged as broken & disabled.`);
        setTimeout(() => setActionFeedback(null), 3500);
        await fetchDashboardData();
      }
    } catch (err: any) {
      setActionFeedback(`Failed to flag: ${err.message}`);
      setTimeout(() => setActionFeedback(null), 3500);
    }
  };

  const summary = useMemo(() => {
    const total = sources.length;
    const healthy = sources.filter((s) => s.circuitState !== 'OPEN' && s.httpStatus === 200 && (!s.challenge || s.challenge === 'None')).length;
    const challenged = sources.filter((s) => s.challenge && s.challenge !== 'None').length;
    const tripped = sources.filter((s) => s.circuitState === 'OPEN').length;
    return { total, healthy, challenged, tripped };
  }, [sources]);

  const availableEngines = useMemo(() => {
    const set = new Set<string>();
    sources.forEach((s) => { if (s.engine) set.add(s.engine); });
    return Array.from(set).sort();
  }, [sources]);

  const filteredSources = useMemo(() => {
    return sources.filter((s) => {
      const matchQuery =
        !searchQuery ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.id.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchQuery) return false;

      if (engineFilter !== 'all' && s.engine !== engineFilter) return false;

      if (statusFilter === 'healthy') {
        return s.circuitState !== 'OPEN' && s.httpStatus === 200 && (!s.challenge || s.challenge === 'None');
      }
      if (statusFilter === 'challenged') {
        return s.challenge && s.challenge !== 'None';
      }
      if (statusFilter === 'tripped') {
        return s.circuitState === 'OPEN';
      }

      return true;
    });
  }, [sources, searchQuery, statusFilter, engineFilter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-surface border border-edge rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-primary">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-edge flex items-center justify-between bg-surface/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent/10 text-accent border border-accent/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-base sm:text-lg flex items-center gap-2">
                Source Health & Live Circuit Dashboard
              </h2>
              <p className="text-secondary text-xs">
                Real-time latency diagnostics, Cloudflare challenge alerts, and circuit breaker controls across all active reading sources.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-elevated hover:bg-elevated/80 text-secondary hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Stats Cards */}
        <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-app border-b border-edge">
          <div className="p-3 bg-surface rounded-xl border border-edge flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10 text-accent">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="text-lg font-black">{summary.total}</div>
              <div className="text-[11px] text-secondary">Total Registered</div>
            </div>
          </div>

          <div className="p-3 bg-surface rounded-xl border border-edge flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-lg font-black text-emerald-400">{summary.healthy}</div>
              <div className="text-[11px] text-secondary">Direct (Healthy)</div>
            </div>
          </div>

          <div className="p-3 bg-surface rounded-xl border border-edge flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-lg font-black text-amber-400">{summary.challenged}</div>
              <div className="text-[11px] text-secondary">Challenged (Bypassed)</div>
            </div>
          </div>

          <div className="p-3 bg-surface rounded-xl border border-edge flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="text-lg font-black text-rose-400">{summary.tripped}</div>
              <div className="text-[11px] text-secondary">Circuit Tripped</div>
            </div>
          </div>
        </div>

        {/* Action / Search Bar */}
        <div className="p-4 border-b border-edge flex flex-wrap items-center justify-between gap-3 bg-surface/50">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
              <input
                type="text"
                placeholder="Filter by source name, domain, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-app border border-edge text-xs font-medium focus:outline-none focus:border-accent"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-app border border-edge text-xs font-medium focus:outline-none focus:border-accent"
            >
              <option value="all">All Statuses ({sources.length})</option>
              <option value="healthy">Healthy Only</option>
              <option value="challenged">Challenged Only</option>
              <option value="tripped">Tripped Circuits Only</option>
            </select>

            <select
              value={engineFilter}
              onChange={(e) => setEngineFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-app border border-edge text-xs font-medium focus:outline-none focus:border-accent"
            >
              <option value="all">All Engines</option>
              {availableEngines.map((eng) => (
                <option key={eng} value={eng}>
                  Engine: {eng}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleResetCircuit()}
              disabled={isResetting}
              className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
              <span>Reset All Circuits</span>
            </button>

            <button
              onClick={fetchDashboardData}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-elevated/80 text-primary border border-edge text-xs font-bold flex items-center gap-1.5 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {actionFeedback && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-accent/15 border border-accent/30 text-accent text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{actionFeedback}</span>
          </div>
        )}

        {/* Source Table List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredSources.length === 0 ? (
            <div className="p-8 text-center text-secondary text-xs font-medium">
              No sources matched your current filter criteria.
            </div>
          ) : (
            filteredSources.slice(0, 150).map((source) => (
              <div
                key={source.id}
                className="p-3 bg-app hover:bg-elevated/40 rounded-xl border border-edge flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center justify-center">
                    {source.circuitState === 'OPEN' ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 ring-4 ring-rose-500/20" title="Circuit OPEN (Cooling down)" />
                    ) : source.challenge && source.challenge !== 'None' ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 ring-4 ring-amber-500/20" title={`Challenge: ${source.challenge}`} />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" title="Healthy / Direct" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs sm:text-sm text-primary truncate">
                        {source.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-surface text-secondary border border-edge">
                        {source.engine}
                      </span>
                    </div>
                    <div className="text-[11px] text-secondary truncate flex items-center gap-1.5">
                      <span>{source.domain || source.id}</span>
                      {source.latencyMs > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-primary font-mono">{source.latencyMs}ms</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {source.challenge && source.challenge !== 'None' && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {source.challenge}
                    </span>
                  )}

                  {source.circuitState === 'OPEN' ? (
                    <button
                      onClick={() => handleResetCircuit(source.id)}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition-all"
                    >
                      Reset Circuit
                    </button>
                  ) : (
                    <button
                      onClick={() => handleFlagBroken(source.id, source.name)}
                      className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-[11px] font-bold flex items-center gap-1 transition-all"
                      title="Manually flag source as broken and disable"
                    >
                      <Ban className="w-3 h-3" />
                      <span>Flag Broken</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-edge bg-surface/80 flex items-center justify-between text-xs text-secondary">
          <span>Showing {Math.min(filteredSources.length, 150)} of {filteredSources.length} sources</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-elevated hover:bg-elevated/80 text-primary font-bold transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
