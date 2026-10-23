import type { Alert, LoadState } from './prometheus'

export function alertIdentity(alert: Alert): string

export class AlertTransitionTracker {
  observe(status: LoadState<Alert[]>['status'], alerts?: Alert[]): Alert[]
}

export type AlertToastItem = { id: string; alert: Alert }
export type NotificationAction =
  | { type: 'add'; notifications: AlertToastItem[] }
  | { type: 'dismiss'; id: string }

export function notificationReducer(state: AlertToastItem[], action: NotificationAction): AlertToastItem[]
