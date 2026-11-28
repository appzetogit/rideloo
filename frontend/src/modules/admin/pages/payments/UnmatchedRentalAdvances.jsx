import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';

/**
 * Payments > Unmatched rental advances.
 *
 * Rental advances the rider paid through Cashfree that no rental booking
 * uses - usually the app closed after paying and before the booking was
 * made. Refund them from the Cashfree dashboard (search the order id) or make
 * the booking for the rider. Orders younger than 10 minutes are not listed,
 * as the rider may still be finishing the booking.
 */

const rupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const time = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const unwrap = (res) => {
  const body = res?.data?.data || res?.data || res || {};
  return Array.isArray(body.results) ? body : body.data || body;
};

const UnmatchedRentalAdvances = () => {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ results: [], count: 0, total: 0 });

  const load = useCallback(async (recheck = false) => {
    setLoading(true);
    try {
      const res = await api.get('/admin/payments/cashfree/unmatched-rental-advances', {
        params: { days, ...(recheck ? { recheck: 1 } : {}) },
      });
      const body = unwrap(res);
      setData({ results: body.results || [], count: body.count || 0, total: body.total || 0 });
      if (recheck) {
        toast.success(`Checked ${body.rechecked || 0} order(s) with Cashfree`);
      }
    } catch (error) {
      toast.error(error?.message || 'Could not load the report');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-xs font-bold text-gray-800">Paid rental advances without a booking</p>
          <p className="text-[10px] text-gray-500 leading-snug">
            The rider paid through Cashfree but no booking was made. Refund from the Cashfree dashboard
            (search the order id) or book the rental for the rider.
          </p>
        </div>
        <select
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className="border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-800 bg-white"
        >
          {[7, 30, 90, 180].map((value) => (
            <option key={value} value={value}>Last {value} days</option>
          ))}
        </select>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Check with Cashfree
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Unmatched payments</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{data.count}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Amount to settle</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{rupees(data.total)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <th className="px-3 py-2">Cashfree order</th>
              <th className="px-3 py-2">Rider</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Paid at</th>
              <th className="px-3 py-2">Booking ref</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Loading...</td></tr>
            ) : data.results.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Nothing to settle. Every paid rental advance has a booking.</td></tr>
            ) : (
              data.results.map((item) => (
                <tr key={item.orderId} className="border-b border-gray-50">
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-800">
                    {item.orderId}
                    {!item.isProduction ? <span className="ml-1.5 text-[9px] font-bold text-amber-600">TEST</span> : null}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{item.user?.name || '-'} <span className="text-gray-400">{item.user?.phone || ''}</span></td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{rupees(item.amount)}</td>
                  <td className="px-3 py-2 text-gray-600">{time(item.paidAt || item.createdAt)}</td>
                  <td className="px-3 py-2 text-gray-600">{item.bookingReference || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UnmatchedRentalAdvances;
