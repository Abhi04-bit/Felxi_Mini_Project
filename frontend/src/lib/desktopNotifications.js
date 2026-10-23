export function readNotificationPermission(api) {
  if (!api || typeof api !== 'function' || typeof api.requestPermission !== 'function') return 'unsupported'
  return api.permission
}

export async function requestNotificationPermission(api) {
  const current = readNotificationPermission(api)
  if (current !== 'default') return current
  try {
    const result = await api.requestPermission()
    return ['granted', 'denied', 'default'].includes(result) ? result : 'error'
  } catch {
    return 'error'
  }
}

export function createAlertDesktopNotification(api, alert) {
  if (readNotificationPermission(api) !== 'granted') return 'not-permitted'
  const severity = alert.severity.toLowerCase()
  if (!['critical', 'warning'].includes(severity)) return 'ignored'
  try {
    new api(`SentinelPulse · ${severity.toUpperCase()} alert`, {
      body: `${alert.name} is firing.`,
      tag: `sentinelpulse-${alert.name}`,
    })
    return 'created'
  } catch {
    return 'error'
  }
}

export function shouldSendDesktopNotification(enabled, permission) {
  return enabled && permission === 'granted'
}
