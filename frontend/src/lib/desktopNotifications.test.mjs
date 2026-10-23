import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAlertDesktopNotification,
  readNotificationPermission,
  requestNotificationPermission,
  shouldSendDesktopNotification,
} from './desktopNotifications.js'

const alert = (severity = 'critical') => ({
  name: 'FailedSSHLoginBurst',
  severity,
  state: 'firing',
  summary: 'Sensitive annotation must not be sent to the desktop.',
  labels: { alertname: 'FailedSSHLoginBurst' },
})

function notificationApi(permission, onCreate = () => {}) {
  return class FakeNotification {
    static permission = permission
    static async requestPermission() { return permission }
    constructor(title, options) { onCreate(title, options) }
  }
}

test('granted browser permission allows concise critical and warning notifications', () => {
  const created = []
  const api = notificationApi('granted', (title, options) => created.push({ title, options }))
  assert.equal(createAlertDesktopNotification(api, alert()), 'created')
  assert.equal(createAlertDesktopNotification(api, alert('warning')), 'created')
  assert.equal(created.length, 2)
  assert.equal(created[0].title, 'SentinelPulse · CRITICAL alert')
  assert.equal(created[0].options.body, 'FailedSSHLoginBurst is firing.')
  assert.equal(JSON.stringify(created).includes('Sensitive annotation'), false)
})

test('denied and unsupported permission states do not create notifications', () => {
  let constructions = 0
  const denied = notificationApi('denied', () => constructions++)
  assert.equal(readNotificationPermission(denied), 'denied')
  assert.equal(createAlertDesktopNotification(denied, alert()), 'not-permitted')
  assert.equal(readNotificationPermission(undefined), 'unsupported')
  assert.equal(createAlertDesktopNotification(undefined, alert()), 'not-permitted')
  assert.equal(constructions, 0)
})

test('permission request only calls the API while permission is default', async () => {
  let calls = 0
  const api = notificationApi('default')
  api.requestPermission = async () => { calls += 1; return 'granted' }
  assert.equal(await requestNotificationPermission(api), 'granted')
  assert.equal(calls, 1)
  const denied = notificationApi('denied')
  denied.requestPermission = async () => { calls += 1; return 'granted' }
  assert.equal(await requestNotificationPermission(denied), 'denied')
  assert.equal(calls, 1)
})

test('application opt-out and informational alerts remain desktop-silent', () => {
  assert.equal(shouldSendDesktopNotification(false, 'granted'), false)
  assert.equal(shouldSendDesktopNotification(true, 'denied'), false)
  assert.equal(createAlertDesktopNotification(notificationApi('granted'), alert('info')), 'ignored')
})

test('notification construction errors are reported without claiming delivery', () => {
  class BrokenNotification {
    static permission = 'granted'
    static async requestPermission() { return 'granted' }
    constructor() { throw new Error('browser blocked notification') }
  }
  assert.equal(createAlertDesktopNotification(BrokenNotification, alert()), 'error')
})
