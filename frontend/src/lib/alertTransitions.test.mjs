import test from 'node:test'
import assert from 'node:assert/strict'
import { AlertTransitionTracker, alertIdentity, notificationReducer } from './alertTransitions.js'

const alert = (name, state = 'firing', labels = {}) => ({
  name,
  severity: 'warning',
  state,
  labels: { alertname: name, job: 'sentinelpulse-exporter', ...labels },
})

test('initial page load seeds already-firing alerts without toasts', () => {
  const tracker = new AlertTransitionTracker()
  assert.deepEqual(tracker.observe('ready', [alert('FailedSSHLoginBurst')]), [])
  assert.deepEqual(tracker.observe('ready', [alert('FailedSSHLoginBurst')]), [])
})

test('a new firing alert notifies once and repeated polls do not duplicate it', () => {
  const tracker = new AlertTransitionTracker()
  tracker.observe('ready', [])
  const current = [alert('FailedSSHLoginBurst')]
  assert.equal(tracker.observe('ready', current).length, 1)
  assert.deepEqual(tracker.observe('ready', current), [])
})

test('multiple newly firing alerts each produce a notification', () => {
  const tracker = new AlertTransitionTracker()
  tracker.observe('ready', [])
  assert.deepEqual(
    tracker.observe('ready', [alert('FailedSSHLoginBurst'), alert('ExporterUnavailable')]).map(({ name }) => name),
    ['FailedSSHLoginBurst', 'ExporterUnavailable'],
  )
})

test('pending-to-firing notifies, disappearance is quiet, and a later re-fire notifies once', () => {
  const tracker = new AlertTransitionTracker()
  tracker.observe('ready', [alert('TLSCertificateExpiryWarning', 'pending')])
  assert.equal(tracker.observe('ready', [alert('TLSCertificateExpiryWarning')]).length, 1)
  assert.deepEqual(tracker.observe('ready', []), [])
  assert.equal(tracker.observe('ready', [alert('TLSCertificateExpiryWarning')]).length, 1)
})

test('loading preserves state; API failure suppresses uncertain recovery transitions', () => {
  const tracker = new AlertTransitionTracker()
  tracker.observe('ready', [])
  assert.equal(tracker.observe('ready', [alert('ExporterUnavailable')]).length, 1)
  tracker.observe('loading')
  assert.deepEqual(tracker.observe('error'), [])
  assert.deepEqual(tracker.observe('ready', [alert('ExporterUnavailable'), alert('HttpsProbeUnavailable')]), [])
  assert.equal(tracker.observe('ready', [alert('ExporterUnavailable'), alert('HttpsProbeUnavailable'), alert('TLSCertificateExpiryCritical')]).length, 1)
})

test('alert identity is stable when Prometheus label key order changes', () => {
  const first = alert('FailedSSHLoginBurst', 'firing', { instance: 'exporter:9108', severity: 'critical' })
  const second = { ...first, labels: { severity: 'critical', job: first.labels.job, alertname: first.labels.alertname, instance: first.labels.instance } }
  assert.equal(alertIdentity(first), alertIdentity(second))
})

test('toast reducer supports multiple alerts and dismissal', () => {
  const notifications = [{ id: 'one', alert: alert('FailedSSHLoginBurst') }, { id: 'two', alert: alert('ExporterUnavailable') }]
  const added = notificationReducer([], { type: 'add', notifications })
  assert.equal(added.length, 2)
  assert.deepEqual(notificationReducer(added, { type: 'dismiss', id: 'one' }), [notifications[1]])
})
