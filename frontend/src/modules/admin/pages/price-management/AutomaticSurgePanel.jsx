import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleMap, PolygonF, OverlayViewF, OVERLAY_MOUSE_TARGET } from '@react-google-maps/api';
import { Loader2, RefreshCw, RotateCcw, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';
import { HAS_VALID_GOOGLE_MAPS_KEY, useBaseGoogleMapsLoader } from '../../utils/googleMaps';

const inputClass =
  'w-full border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors shadow-sm';
const labelClass = 'block text-[10px] font-semibold text-gray-500 mb-1';
// Default map centre when no surge area is drawn yet.
const DEFAULT_CENTER = { lat: 25.3463, lng: 74.6364 }; // Bhilwara
const REFRESH_MS = 60 * 1000;
const DEFAULT_TAB = 'default';

// Each setting, with the help text an admin needs to set it sensibly.
// `shared` ones are the same for every vehicle and only edited on Default.
const FIELDS = [
  { key: 'max_multiplier', label: 'Maximum surge (x)', step: 0.05, min: 1, max: 2, help: 'Legal ceiling is 2x the base fare; some states allow less.' },
  { key: 'min_demand', label: 'Min riders to trigger', step: 1, min: 1, help: 'Distinct riders asking for a price in an area before it can surge.' },
  { key: 'trigger_ratio', label: 'Riders per free driver to start', step: 0.1, min: 0.5, help: 'Surge starts when riders outnumber free drivers by this much.' },
  { key: 'step', label: 'Increase per step (x)', step: 0.01, min: 0.01, max: 0.5, help: 'How much each step adds, e.g. 0.05 = 1.05x, 1.10x, ...' },
  { key: 'ratio_step', label: 'Riders per driver per step', step: 0.1, min: 0.1, help: 'How much busier an area must get for the next step.' },
  { key: 'window_minutes', label: 'Demand window (min)', step: 1, min: 2, max: 60, help: 'How far back rider demand is counted.' },
  { key: 'hold_minutes', label: 'Hold surge for (min)', step: 1, min: 1, max: 60, help: 'A surge lasts at least this long, so prices do not flicker.' },
  { key: 'resolution', label: 'Area size', type: 'select', shared: true, help: 'Size of each hexagon on the map. Shared by every vehicle.' },
];
const EDITABLE_KEYS = ['enabled', ...FIELDS.map((field) => field.key)];

const RESOLUTIONS = [
  { value: 7, label: 'Large (~5 km²)' },
  { value: 8, label: 'Medium (~0.7 km²)' },
  { value: 9, label: 'Small (~0.1 km²)' },
];

// Deeper red for a higher multiplier, like the driver-app surge map.
const surgeColour = (multiplier) => {
  if (multiplier >= 1.4) return '#B91C1C';
  if (multiplier >= 1.2) return '#DC2626';
  if (multiplier >= 1.1) return '#EF4444';
  return '#F87171';
};

const pickEditable = (settings = {}) => Object.fromEntries(EDITABLE_KEYS.map((key) => [key, settings[key]]));
const sameValues = (a = {}, b = {}) => EDITABLE_KEYS.every((key) => String(a[key] ?? '') === String(b[key] ?? ''));

/**
 * Automatic surge, set per vehicle type. "Default" prices every vehicle that
 * has no settings of its own; giving a vehicle its own (its tab, then Save)
 * makes it surge on its own drivers and limits. Each tab saves only itself,
 * and unsaved edits on one tab survive switching to another.
 */
const AutomaticSurgePanel = () => {
  const { isLoaded } = useBaseGoogleMapsLoader();
  const [state, setState] = useState(null);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState(DEFAULT_TAB);
  // Unsaved edits per tab: { [tabKey]: settings }.
  const [drafts, setDrafts] = useState({});

  // The minute-by-minute refresh only updates the live areas: replacing the
  // settings too could overwrite what is on screen while it is being edited.
  const apply = (payload, { areasOnly = false } = {}) => {
    const data = payload?.data || payload || {};
    if (data.settings && !areasOnly) setState({ settings: data.settings, vehicles: data.vehicles || [] });
    setActive(Array.isArray(data.active) ? data.active : []);
  };

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true);
      apply(await api.get('/admin/surge'), { areasOnly: quiet });
    } catch (err) {
      console.error('Fetch automatic surge failed:', err);
      if (!quiet) toast.error('Could not load automatic surge');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const vehicles = useMemo(
    () => [...(state?.vehicles || [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)),
    [state],
  );
  const vehicle = tab === DEFAULT_TAB ? null : vehicles.find((item) => item.vehicle_type_id === tab) || null;
  const isDefault = tab === DEFAULT_TAB;
  const hasOwn = isDefault || Boolean(vehicle?.has_own_settings);

  // What is saved for this tab: default's, or the vehicle's own - or, for a
  // vehicle still following default, default's values as a starting point.
  const saved = useMemo(() => {
    if (!state) return null;
    return pickEditable(isDefault ? state.settings : (vehicle?.settings || state.settings));
  }, [state, isDefault, vehicle]);
  const values = drafts[tab] || saved;
  const dirty = Boolean(drafts[tab]) && !sameValues(drafts[tab], saved);

  const setField = (key, value) =>
    setDrafts((prev) => ({ ...prev, [tab]: { ...(prev[tab] || saved), [key]: value } }));

  const resetTab = () =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[tab];
      return next;
    });

  const tabName = isDefault ? 'Default' : vehicle?.name || 'this vehicle';

  const save = async () => {
    const payload = { ...values };
    if (!isDefault) {
      payload.vehicle_type_id = tab;
      delete payload.resolution;
    }
    try {
      setSaving(true);
      apply(await api.patch('/admin/surge', payload));
      resetTab();
      toast.success(`${tabName} surge saved`);
    } catch (err) {
      console.error('Save automatic surge failed:', err);
      toast.error(err?.response?.data?.message || 'Could not save automatic surge');
    } finally {
      setSaving(false);
    }
  };

  const followDefault = async () => {
    if (!vehicle || !window.confirm(`${vehicle.name} will stop using its own surge settings and follow Default again. Continue?`)) return;
    try {
      setSaving(true);
      apply(await api.delete(`/admin/surge/vehicles/${vehicle.vehicle_type_id}`));
      resetTab();
      toast.success(`${vehicle.name} now follows Default`);
    } catch (err) {
      console.error('Reset vehicle surge failed:', err);
      toast.error(err?.response?.data?.message || 'Could not reset this vehicle');
    } finally {
      setSaving(false);
    }
  };

  // Areas surging under the settings this tab shows: a vehicle that follows
  // default surges wherever default does.
  const tabAreas = useMemo(() => {
    const key = hasOwn && !isDefault ? tab : null;
    return active.filter((area) => (area.vehicle_type_id || null) === key);
  }, [active, tab, hasOwn, isDefault]);

  const mapCenter = useMemo(() => {
    if (!tabAreas.length) return DEFAULT_CENTER;
    const lat = tabAreas.reduce((sum, area) => sum + area.center.lat, 0) / tabAreas.length;
    const lng = tabAreas.reduce((sum, area) => sum + area.center.lng, 0) / tabAreas.length;
    return { lat, lng };
  }, [tabAreas]);

  if (loading || !state || !values) {
    return (
      <div className="bg-white border border-gray-100 rounded-lg p-6 mb-4 flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  const ownCount = vehicles.filter((item) => item.has_own_settings).length;
  const tabButton = (key, label, { on, own, muted } = {}) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={`shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors ${
        tab === key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
      } ${muted ? 'opacity-60' : ''}`}
      title={own ? 'Has its own surge settings' : 'Follows Default'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      {label}
      {drafts[key] && <span className="text-amber-500" title="Unsaved changes">•</span>}
    </button>
  );

  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm mb-5">
      <div className="mb-2">
        <h2 className="text-sm font-bold text-[#1E293B] flex items-center gap-1.5">
          <Zap size={14} className="text-amber-500" /> Automatic surge
        </h2>
        <p className="text-[11px] text-gray-500 mt-0.5 max-w-3xl">
          Like Rapido and Uber: the city is split into hexagons, and every minute each one compares the
          riders asking for a price there with the free drivers nearby. Every vehicle follows <b>Default</b>{' '}
          unless you give it its own settings: then it surges on its own drivers and limits, and saving one
          vehicle never changes another.
        </p>
      </div>

      {/* Vehicle tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 border-b border-gray-100">
        {tabButton(DEFAULT_TAB, 'Default', { on: state.settings.enabled, own: true })}
        {vehicles.map((item) =>
          tabButton(item.vehicle_type_id, item.name, {
            on: item.has_own_settings ? item.settings.enabled : state.settings.enabled,
            own: item.has_own_settings,
            muted: !item.active,
          }),
        )}
      </div>
      <p className="text-[10px] text-gray-400 mt-1">
        Green dot = surge on. {ownCount} of {vehicles.length} vehicles have their own settings; the rest follow Default.
      </p>

      <div className="mt-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-gray-800">
            {isDefault ? 'Default - every vehicle without its own settings' : vehicle?.name}
            {!isDefault && !vehicle?.active && <span className="ml-1 text-[10px] font-normal text-gray-400">(inactive vehicle)</span>}
          </p>
          {!isDefault && !hasOwn && (
            <p className="text-[11px] text-amber-600 mt-0.5">
              Follows Default now (values below are Default&apos;s). Change them and Save to give {vehicle?.name} its own surge.
            </p>
          )}
          {!isDefault && hasOwn && (
            <p className="text-[11px] text-gray-500 mt-0.5">
              Own settings: surges on {vehicle?.name} drivers only, whatever Default does.
            </p>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={Boolean(values.enabled)}
            disabled={saving}
            onChange={(e) => setField('enabled', e.target.checked)}
          />
          Surge {values.enabled ? 'on' : 'off'}
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
        {FIELDS.filter((field) => isDefault || !field.shared).map((field) => (
          <div key={field.key}>
            <label className={labelClass} title={field.help}>{field.label}</label>
            {field.type === 'select' ? (
              <select
                className={inputClass}
                value={values[field.key]}
                onChange={(e) => setField(field.key, Number(e.target.value))}
              >
                {RESOLUTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                className={inputClass}
                step={field.step}
                min={field.min}
                max={field.max}
                value={values[field.key]}
                onChange={(e) => setField(field.key, e.target.value)}
              />
            )}
            <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{field.help}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
        <button
          onClick={() => load()}
          className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900 px-2 py-1"
        >
          <RefreshCw size={11} /> Refresh
        </button>
        {!isDefault && vehicle?.has_own_settings && (
          <button
            onClick={followDefault}
            disabled={saving}
            className="text-[11px] font-semibold text-gray-600 hover:text-red-600 px-2 py-1 disabled:opacity-50"
          >
            Use Default settings
          </button>
        )}
        <button
          onClick={resetTab}
          disabled={!dirty || saving}
          className="flex items-center gap-1 border border-gray-200 text-gray-700 text-[11px] font-semibold px-3 py-1 rounded-md hover:bg-gray-50 disabled:opacity-40"
          title="Discard unsaved changes on this tab"
        >
          <RotateCcw size={11} /> Reset
        </button>
        <button
          onClick={save}
          disabled={saving || (!dirty && hasOwn)}
          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold px-3 py-1 rounded-md transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={11} className="animate-spin" />}
          Save {tabName}
        </button>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-700">
            Surging now for {tabName}: {tabAreas.length} {tabAreas.length === 1 ? 'area' : 'areas'}
          </p>
          <p className="text-[10px] text-gray-400">Updates every minute</p>
        </div>

        {HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
          <div className="h-72 rounded-lg overflow-hidden border border-gray-100">
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={mapCenter}
              zoom={tabAreas.length ? 12 : 11}
              options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
            >
              {tabAreas.map((area) => (
                <React.Fragment key={`${area.vehicle_type_id || 'default'}-${area.hex}`}>
                  <PolygonF
                    paths={area.boundary}
                    options={{
                      fillColor: surgeColour(area.multiplier),
                      fillOpacity: 0.35,
                      strokeColor: surgeColour(area.multiplier),
                      strokeOpacity: 0.8,
                      strokeWeight: 1,
                    }}
                  />
                  <OverlayViewF position={area.center} mapPaneName={OVERLAY_MOUSE_TARGET}>
                    <div className="-translate-x-1/2 -translate-y-1/2 bg-emerald-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded shadow">
                      {area.multiplier.toFixed(2)}x
                    </div>
                  </OverlayViewF>
                </React.Fragment>
              ))}
            </GoogleMap>
          </div>
        ) : null}

        {tabAreas.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="py-1 pr-3 font-semibold">Multiplier</th>
                  <th className="py-1 pr-3 font-semibold">Riders</th>
                  <th className="py-1 pr-3 font-semibold">Free drivers</th>
                  <th className="py-1 pr-3 font-semibold">Ends in</th>
                  <th className="py-1 font-semibold">Area</th>
                </tr>
              </thead>
              <tbody>
                {tabAreas.map((area) => (
                  <tr key={`${area.vehicle_type_id || 'default'}-${area.hex}`} className="border-t border-gray-50 text-gray-700">
                    <td className="py-1 pr-3 font-bold">{area.multiplier.toFixed(2)}x</td>
                    <td className="py-1 pr-3">{area.demand}</td>
                    <td className="py-1 pr-3">{area.supply}</td>
                    <td className="py-1 pr-3">{area.ends_in_minutes} min</td>
                    <td className="py-1 text-gray-400">
                      {area.center.lat.toFixed(4)}, {area.center.lng.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 mt-2">
            {saved.enabled
              ? 'No area is busy enough to surge right now.'
              : `Surge is off for ${tabName}.`}
          </p>
        )}
      </div>
    </div>
  );
};

export default AutomaticSurgePanel;
