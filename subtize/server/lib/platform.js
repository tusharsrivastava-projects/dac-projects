import { getSetting, setSetting } from '../db/index.js';
import { config } from '../config.js';

/** Admin-editable platform settings, with config as the fallback. */
export function platformSettings() {
  return {
    upiId: getSetting('platform_upi_id', config.platform.upiId),
    payee: getSetting('platform_payee', config.platform.payee),
    commissionPercent: Number(getSetting('commission_percent', config.platform.commissionPercent)),
    supportEmail: getSetting('support_email', config.platform.supportEmail),
    supportPhone: getSetting('support_phone', config.platform.supportPhone),
    defaultCity: getSetting('default_city', config.platform.defaultCity),
    expiringSoonDays: Number(getSetting('expiring_soon_days', 7)),
  };
}

export function savePlatformSettings(patch) {
  const map = {
    upiId: 'platform_upi_id', payee: 'platform_payee', commissionPercent: 'commission_percent',
    supportEmail: 'support_email', supportPhone: 'support_phone', defaultCity: 'default_city',
    expiringSoonDays: 'expiring_soon_days',
  };
  for (const [k, v] of Object.entries(patch)) if (map[k] && v != null) setSetting(map[k], v);
  return platformSettings();
}

export function publicBaseUrl(req) {
  if (config.baseUrl) return config.baseUrl;
  return `${req.protocol}://${req.get('host')}`;
}
