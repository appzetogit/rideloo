import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, RefreshCw, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';
import SubscriberReport from './SubscriberReport';
import UnmatchedRentalAdvances from './UnmatchedRentalAdvances';

/**
 * Every payment the platform takes, in one place: ride fares (cash, online,
 * wallet, subscription), driver subscription passes and wallet top-ups by
 * drivers and riders - with an invoice or receipt PDF for each.
 *
 * Rides are listed by how they were actually paid, so a ride booked as cash
 * and paid online at the end shows as Online with its gateway reference.
 */

const KINDS = [
  { value: '', label: 'All payments' },
  { value: 'ride', label: 'Ride fares' },
  { value: 'subscription', label: 'Driver subscriptions' },
  { value: 'driver_top_up', label: 'Driver wallet top-ups' },
  { value: 'rider_top_up', label: 'Rider wallet top-ups' },
];

const METHODS = [
  { value: '', label: 'Any method' },
  { value: 'online', label: 'Online' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'subscription', label: 'Subscription' },
];

const METHOD_STYLES = {
  online: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cash: 'bg-amber-50 text-amber-700 border-amber-200',
  wallet: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  subscription: 'bg-sky-50 text-sky-700 border-sky-200',
};

const STATUS_STYLES = {
  paid: 'text-emerald-700',
  pending: 'text-amber-700',
  unpaid: 'text-rose-700',
};

const inputClass =
  'border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none';

const isoDay = (date) => date.toISOString().slice(0, 10);
const rupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const when = (value) =>
  value
    ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';

const unwrap = (res) => {
  const body = res?.data?.data || res?.data || res || {};
  return body.results ? body : body.data || body;
};

const PAGE_SIZE = 25;

const Payments = () => {
  const today = useMemo(() => new Date(), []);
  const [filters, setFilters] = useState({
    kind: '',
    method: '',
    vehicle_type_id: '',
    from: isoDay(new Date(today.getTime() - 30 * 864e5)),
    to: isoDay(today),
    q: '',
  });
  const [page, setPage] = useState(1);
  // 'all': the payments ledger. 'subscribers': the daily-pass report.
  const [tab, setTab] = useState('all');
  const [data, setData] = useState({ results: [], totals: {}, total: 0 });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState('');
  const [exporting, setExporting] = useState(false);
  const [vehicles, setVehicles] = useState([]);

  // For the Vehicle filter: active vehicle types first.
  useEffect(() => {
    api.get('/admin/types/vehicle-types/list')
      .then((res) => {
        const body = res?.data ?? res;
        const list = body?.data?.results || body?.results || body?.data || body || [];
        setVehicles(
          (Array.isArray(list) ? list : [])
            .filter((v) => v && (v._id || v.id))
            .map((v) => ({ id: String(v._id || v.id), name: v.name || 'Vehicle', active: v.active !== false && v.status !== 'inactive' }))
            .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
        );
      })
      .catch((err) => console.error('Load vehicle types failed:', err));
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/payments', { params: { ...filters, page, limit: PAGE_SIZE } });
      const body = unwrap(res);
      setData({ results: body.results || [], totals: body.totals || {}, total: body.total || 0 });
    } catch (err) {
      console.error('Load payments failed:', err);
      toast.error('Could not load payments');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // PDFs are fetched directly: the shared API client reshapes JSON bodies.
  const downloadInvoice = async (row) => {
    try {
      setDownloading(row.id);
      const token = localStorage.getItem('adminToken');
      const res = await fetch(
        `${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/admin/payments/${row.kind}/${row.record_id}/invoice`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`Invoice failed (${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] || `${row.invoice_number}.pdf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Could not generate the invoice');
    } finally {
      setDownloading('');
    }
  };

  // The whole filtered set, not just this page.
  const exportCsv = async () => {
    try {
      setExporting(true);
      const rows = [];
      for (let p = 1; p <= 50; p += 1) {
        const body = unwrap(await api.get('/admin/payments', { params: { ...filters, page: p, limit: 200 } }));
        rows.push(...(body.results || []));
        if (rows.length >= (body.total || 0) || !(body.results || []).length) break;
      }
      const header = ['Date', 'Invoice No.', 'Type', 'Paid by', 'Phone', 'For', 'Vehicle', 'Method', 'Detail', 'Reference', 'Status', 'Amount'];
      const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const lines = [
        header.map(cell).join(','),
        ...rows.map((r) =>
          [when(r.date), r.invoice_number, r.kind_label, r.payer.name, r.payer.phone, r.description, (r.vehicle_names || []).join(' / '), r.method_label, r.detail, r.reference, r.status, r.amount]
            .map(cell)
            .join(','),
        ),
      ];
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `payments_${filters.from}_to_${filters.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error('Could not export payments');
    } finally {
      setExporting(false);
    }
  };

  const totals = data.totals || {};
  const pages = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
  const cards = [
    { label: 'Received online', value: totals.received_online, note: 'Gateway payments: rides, top-ups, passes' },
    { label: 'Cash with drivers', value: totals.cash_with_drivers, note: 'Ride fares collected in cash' },
    { label: 'Paid from wallets', value: totals.paid_from_wallet, note: 'Already counted when the wallet was topped up' },
    { label: 'Pending online', value: totals.pending_online, note: 'Online rides not paid yet' },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FD] p-3 lg:p-4 font-sans">
      <div className="mb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-gray-100 pb-2">
        <div>
          <h1 className="text-xl font-bold text-[#1E293B]">Payments</h1>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Every ride fare, driver subscription and wallet top-up, with an invoice for each.
          </p>
        </div>
        <div className={`flex items-center gap-2 ${tab === 'all' ? '' : 'hidden'}`}>
          <button
            onClick={load}
            className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900 px-2 py-1.5"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold px-3 py-1.5 rounded-md disabled:opacity-50"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export CSV
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-3 border-b border-gray-200">
        {[
          { key: 'all', label: 'All payments' },
          { key: 'subscribers', label: 'Subscribers' },
          { key: 'unmatched-rental', label: 'Unmatched rental advances' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`px-3 py-1.5 text-xs font-bold border-b-2 -mb-px transition-colors ${
              tab === item.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'subscribers' ? (
        <SubscriberReport />
      ) : tab === 'unmatched-rental' ? (
        <UnmatchedRentalAdvances />
      ) : (
        <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{rupees(card.value)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{card.note}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[10px] font-semibold text-gray-500">
          From
          <input type="date" className={`${inputClass} block mt-1`} value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          To
          <input type="date" className={`${inputClass} block mt-1`} value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Type
          <select className={`${inputClass} block mt-1`} value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500">
          Method
          <select className={`${inputClass} block mt-1`} value={filters.method} onChange={(e) => setFilter('method', e.target.value)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500" title="Rides of this vehicle, and passes and top-ups of drivers who drive it">
          Vehicle
          <select className={`${inputClass} block mt-1`} value={filters.vehicle_type_id} onChange={(e) => setFilter('vehicle_type_id', e.target.value)}>
            <option value="">All vehicles</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.active ? '' : ' (inactive)'}</option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-semibold text-gray-500 flex-1 min-w-[180px]">
          Search
          <span className="relative block mt-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className={`${inputClass} w-full pl-6`}
              placeholder="Name, phone, payment ID…"
              value={filters.q}
              onChange={(e) => setFilter('q', e.target.value)}
            />
          </span>
        </label>
      </div>

      <div className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Paid by</th>
              <th className="px-3 py-2 font-semibold">For</th>
              <th className="px-3 py-2 font-semibold">Method</th>
              <th className="px-3 py-2 font-semibold">Reference</th>
              <th className="px-3 py-2 font-semibold text-right">Amount</th>
              <th className="px-3 py-2 font-semibold">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-10 text-center">
                  <Loader2 size={18} className="animate-spin text-indigo-500 inline" />
                </td>
              </tr>
            ) : data.results.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-gray-400">No payments for these filters.</td>
              </tr>
            ) : (
              data.results.map((row) => (
                <tr key={row.id} className="border-b border-gray-50 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{when(row.date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-800">{row.kind_label}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold text-gray-800">{row.payer.name}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{row.payer.role}{row.payer.phone ? ` · ${row.payer.phone}` : ''}</p>
                  </td>
                  <td className="px-3 py-2 max-w-[240px]">
                    <p className="text-gray-700 truncate" title={row.description}>{row.description}</p>
                    {row.kind === 'ride' && row.payee?.name ? (
                      <p className="text-[10px] text-gray-400">Driver: {row.payee.name}</p>
                    ) : null}
                    {row.vehicle_names?.length ? (
                      <p className="text-[10px] text-gray-500">Vehicle: {row.vehicle_names.join(', ')}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-bold ${METHOD_STYLES[row.method] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                      {row.method_label}
                    </span>
                    <p className="text-[10px] text-gray-500 mt-0.5 max-w-[200px]">{row.detail}</p>
                    <p className={`text-[10px] font-semibold capitalize ${STATUS_STYLES[row.status] || 'text-gray-500'}`}>{row.status}</p>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-gray-500 break-all max-w-[160px]">{row.reference || '-'}</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900 whitespace-nowrap">{rupees(row.amount)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      onClick={() => downloadInvoice(row)}
                      disabled={downloading === row.id}
                      className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                      title={row.invoice_number}
                    >
                      {downloading === row.id ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                      {row.kind === 'ride' ? 'Invoice' : 'Receipt'}
                    </button>
                    <p className="text-[9px] text-gray-400 font-mono mt-0.5">{row.invoice_number}</p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-[11px] text-gray-500">
        <span>{data.total} payment{data.total === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1 disabled:opacity-30">
            <ChevronLeft size={14} />
          </button>
          <span>Page {page} of {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="p-1 disabled:opacity-30">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

export default Payments;
