import type { DesktopPermission } from '../lib/desktopNotifications.js'

type Props = {
  permission: DesktopPermission
  enabled: boolean
  notificationError: string | null
  onEnable: () => void
  onDisable: () => void
}

function statusLabel(permission: DesktopPermission, enabled: boolean) {
  if (permission === 'unsupported') return 'Unsupported'
  if (permission === 'denied') return 'Blocked'
  if (permission === 'requesting') return 'Requesting…'
  if (permission === 'error') return 'Unavailable'
  if (permission === 'prompt-dismissed') return 'Not enabled'
  return enabled ? 'On' : 'Off'
}

function statusDescription(permission: DesktopPermission, enabled: boolean) {
  if (permission === 'unsupported') return 'This browser or page context does not support desktop notifications.'
  if (permission === 'denied') return 'Notifications are blocked by browser settings. Allow them for this site in the browser’s site settings, then reload SentinelPulse.'
  if (permission === 'requesting') return 'Waiting for the browser permission choice.'
  if (permission === 'error') return 'The browser could not request notification permission. Check this site’s browser settings and reload to try again.'
  if (permission === 'prompt-dismissed') return 'The permission prompt was dismissed. Check browser site settings and reload before trying again.'
  if (enabled) return 'Enabled for new critical and warning alerts while SentinelPulse is open. Alert details stay in the in-app Alert Center.'
  return 'Off. Enable this option to receive new critical and warning alerts while SentinelPulse is open.'
}

export default function DesktopNotificationSettings({ permission, enabled, notificationError, onEnable, onDisable }: Props) {
  const actionDisabled = ['unsupported', 'denied', 'requesting', 'prompt-dismissed', 'error'].includes(permission)

  return (
    <details className="desktop-notification-settings">
      <summary aria-label={`Desktop notifications: ${statusLabel(permission, enabled)}`}>
        <span aria-hidden="true">♧</span> Desktop alerts <span className={`desktop-setting-state ${enabled ? 'enabled' : ''}`}>{statusLabel(permission, enabled)}</span>
      </summary>
      <div className="desktop-settings-popover">
        <strong>Browser desktop notifications</strong>
        <p>{statusDescription(permission, enabled)}</p>
        <p className="desktop-privacy-note">Only the alert name and severity are sent to the browser notification. Alertmanager remains the configured external notification path.</p>
        <button type="button" className="desktop-settings-action" disabled={enabled ? false : actionDisabled} onClick={enabled ? onDisable : onEnable}>
          {enabled ? 'Disable desktop notifications' : permission === 'denied' ? 'Blocked in browser settings' : permission === 'unsupported' ? 'Not supported' : permission === 'requesting' ? 'Requesting permission…' : permission === 'prompt-dismissed' || permission === 'error' ? 'Check browser settings' : 'Enable desktop notifications'}
        </button>
        {notificationError && <p className="desktop-notification-error" role="status">{notificationError}</p>}
      </div>
    </details>
  )
}
