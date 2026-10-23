import type { Alert } from './prometheus'

export type DesktopPermission = NotificationPermission | 'unsupported' | 'requesting' | 'prompt-dismissed' | 'error'
export type DesktopNotificationApi = {
  permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
  new (title: string, options?: NotificationOptions): Notification
}

export function readNotificationPermission(api?: DesktopNotificationApi): DesktopPermission
export function requestNotificationPermission(api?: DesktopNotificationApi): Promise<DesktopPermission>
export function createAlertDesktopNotification(api: DesktopNotificationApi | undefined, alert: Alert): 'not-permitted' | 'ignored' | 'created' | 'error'
export function shouldSendDesktopNotification(enabled: boolean, permission: DesktopPermission): boolean
