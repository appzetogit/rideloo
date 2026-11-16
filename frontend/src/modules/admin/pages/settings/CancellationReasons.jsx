import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, Loader2, X, Save, Info } from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

const inputClass =
  "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 outline-none transition-colors";
const labelClass = "block text-xs font-semibold text-gray-500 mb-1.5";

const StatusToggle = ({ active, onToggle }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    className={`w-12 h-6 rounded-full transition-all duration-300 relative ${
      active ? 'bg-yellow-400' : 'bg-gray-300'
    }`}
  >
    <div
      className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all duration-300 ${
        active ? 'right-1' : 'left-1'
      }`}
    />
  </button>
);

const emptyForm = {
  title: '',
  audience: 'user',
  order_by: '',
  requiresNote: false,
  active: true,
};

/**
 * Manages the reasons riders and drivers pick from when they cancel a trip.
 *
 * The apps read this list at cancel time, so wording changes take effect
 * without an app release.
 */
const CancellationReasons = () => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reasons, setReasons] = useState([]);
  const [audience, setAudience] = useState('user');
  const [searchTerm, setSearchTerm] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = create
  const [formData, setFormData] = useState(emptyForm);

  const fetchReasons = async () => {
    try {
      setLoading(true);
      const res = await adminService.getCancellationReasons({});
      const data =
        (Array.isArray(res?.data?.results) && res.data.results) ||
        (Array.isArray(res?.data?.data?.results) && res.data.data.results) ||
        (Array.isArray(res?.results) && res.results) ||
        (Array.isArray(res?.data) && res.data) ||
        (Array.isArray(res) && res) ||
        [];
      setReasons(data);
    } catch {
      toast.error('Failed to load cancellation reasons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReasons();
  }, []);

  const visibleReasons = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return reasons
      .filter((r) => (r.audience || 'user') === audience)
      .filter((r) => (term ? (r.title || '').toLowerCase().includes(term) : true))
      .sort((a, b) => (Number(a.order_by) || 0) - (Number(b.order_by) || 0));
  }, [reasons, audience, searchTerm]);

  const openCreate = () => {
    // Defaults to the end of the currently shown list so a new reason does not
    // silently jump above existing ones.
    const nextOrder = visibleReasons.length
      ? Math.max(...visibleReasons.map((r) => Number(r.order_by) || 0)) + 1
      : 1;
    setFormData({ ...emptyForm, audience, order_by: String(nextOrder) });
    setEditing({});
  };

  const openEdit = (reason) => {
    setFormData({
      title: reason.title || '',
      audience: reason.audience || 'user',
      order_by: String(reason.order_by ?? ''),
      requiresNote: Boolean(reason.requiresNote || reason.requires_note),
      active: reason.active !== false,
    });
    setEditing(reason);
  };

  const handleSave = async () => {
    const title = formData.title.trim();
    if (!title) {
      toast.error('Reason text is required');
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        title,
        audience: formData.audience,
        order_by: Number(formData.order_by) || 0,
        requiresNote: formData.requiresNote,
        active: formData.active,
      };

      const reasonId = editing?.id || editing?._id;
      if (reasonId) {
        await adminService.updateCancellationReason(reasonId, payload);
        toast.success('Cancellation reason updated');
      } else {
        await adminService.createCancellationReason(payload);
        toast.success('Cancellation reason added');
      }

      setEditing(null);
      await fetchReasons();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the cancellation reason');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (reason) => {
    const reasonId = reason.id || reason._id;
    // Optimistic so the switch feels instant; reverted by the refetch on error.
    setReasons((prev) =>
      prev.map((r) => ((r.id || r._id) === reasonId ? { ...r, active: !r.active } : r)),
    );

    try {
      await adminService.updateCancellationReason(reasonId, { active: !reason.active });
    } catch {
      toast.error('Could not update the reason');
      fetchReasons();
    }
  };

  const handleDelete = async (reason) => {
    const reasonId = reason.id || reason._id;
    if (!window.confirm(`Delete “${reason.title}”?\n\nRides already cancelled with this reason keep their recorded text.`)) {
      return;
    }

    try {
      await adminService.deleteCancellationReason(reasonId);
      toast.success('Cancellation reason deleted');
      await fetchReasons();
    } catch {
      toast.error('Could not delete the reason');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cancellation Reasons</h1>
          <p className="text-sm text-gray-500 mt-1">
            Shown in the apps when a trip is cancelled. Changes apply immediately — no app update needed.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold text-sm px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} /> Add Reason
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          {['user', 'driver'].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAudience(value)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors capitalize ${
                audience === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {value === 'user' ? 'Rider' : 'Driver'}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search reasons"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : visibleReasons.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            No cancellation reasons for {audience === 'user' ? 'riders' : 'drivers'} yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left font-semibold px-5 py-3 w-16">Order</th>
                <th className="text-left font-semibold px-5 py-3">Reason</th>
                <th className="text-left font-semibold px-5 py-3 w-40">Asks for note</th>
                <th className="text-left font-semibold px-5 py-3 w-28">Active</th>
                <th className="text-right font-semibold px-5 py-3 w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleReasons.map((reason) => (
                <tr key={reason.id || reason._id} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-5 py-3.5 text-gray-500">{reason.order_by ?? 0}</td>
                  <td className="px-5 py-3.5 font-medium text-gray-900">{reason.title}</td>
                  <td className="px-5 py-3.5 text-gray-500">
                    {reason.requiresNote || reason.requires_note ? 'Yes' : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusToggle active={reason.active !== false} onToggle={() => handleToggleActive(reason)} />
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(reason)}
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(reason)}
                        className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !submitting && setEditing(null)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-gray-900">
                  {editing?.id || editing?._id ? 'Edit Reason' : 'Add Reason'}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>Reason text</label>
                  <input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Driver is taking too long"
                    className={inputClass}
                    autoFocus
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Shown to</label>
                    <div className="inline-flex bg-gray-100 rounded-lg p-1 w-full">
                      {['user', 'driver'].map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFormData({ ...formData, audience: value })}
                          className={`flex-1 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                            formData.audience === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                          }`}
                        >
                          {value === 'user' ? 'Rider' : 'Driver'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>Order</label>
                    <input
                      type="number"
                      value={formData.order_by}
                      onChange={(e) => setFormData({ ...formData, order_by: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requiresNote}
                    onChange={(e) => setFormData({ ...formData, requiresNote: e.target.checked })}
                    className="mt-0.5 w-4 h-4 accent-yellow-400"
                  />
                  <span className="text-sm text-gray-700">
                    Ask for a written note
                    <span className="block text-xs text-gray-400 mt-0.5">
                      Use this for catch-all entries like “Other”.
                    </span>
                  </span>
                </label>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-medium text-gray-700">Active</span>
                  <StatusToggle
                    active={formData.active}
                    onToggle={() => setFormData({ ...formData, active: !formData.active })}
                  />
                </div>

                <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Rides already cancelled keep the wording the customer saw, so editing this
                    will not rewrite past records.
                  </span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={submitting}
                  className="flex-1 border border-gray-200 text-gray-700 font-semibold text-sm py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-60 text-gray-900 font-semibold text-sm py-2.5 rounded-lg transition-colors"
                >
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Save
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CancellationReasons;
