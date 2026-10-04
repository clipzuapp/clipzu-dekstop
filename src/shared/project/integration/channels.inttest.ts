/**
 * channels.inttest.ts — IPC contract parity tests (task.txt Phase 5).
 *
 * The channel NAME STRINGS are the contract between main, preload, and
 * renderer. These tests pin the exact values: any rename/edit must be
 * deliberate and synchronized, never a silent typo that dead-ends a menu
 * item again. Usage parity (all three layers import these consts instead of
 * literals) is enforced by typecheck + grep, asserted here by value.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MENU,
  MENU_CHANNELS,
  PROJECT_SAVE_CHANNEL,
  PROJECT_LOAD_CHANNEL,
  PROJECT_LOAD_PATH_CHANNEL,
  PROJECT_EXPORT_SRT_CHANNEL,
  PROJECT_CREATE_TEMP_SRT_CHANNEL,
  PROJECT_CREATE_TEMP_ASS_CHANNEL,
  PROJECT_RELINK_LIST_CHANNEL,
  PROJECT_RELINK_LOCATE_CHANNEL,
  PROJECT_RELINK_SCAN_CHANNEL,
  PROJECT_RELINK_RETRY_CHANNEL,
  PROJECT_RELINK_CANCEL_CHANNEL,
  PROJECT_CHANNELS,
  MODEL_GET_STATUS_CHANNEL,
  MODEL_DOWNLOAD_CHANNEL,
  MODEL_CANCEL_CHANNEL,
  MODEL_PROGRESS_CHANNEL,
  MODEL_INVOKE_CHANNELS,
  MEDIA_RUNTIME_GET_STATUS_CHANNEL,
  MEDIA_RUNTIME_DOWNLOAD_CHANNEL,
  MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL,
  MEDIA_RUNTIME_CANCEL_CHANNEL,
  MEDIA_RUNTIME_PROGRESS_CHANNEL,
  MEDIA_RUNTIME_INVOKE_CHANNELS,
  DIAGNOSTICS_EXPORT_CHANNEL,
} from '../../ipc/channels'

describe('IPC channel contracts (task.txt Phase 5)', () => {
  it('menu channels match the native File menu sends exactly', () => {
    assert.equal(MENU.newProject, 'menu:new-project')
    assert.equal(MENU.openProject, 'menu:open-project')
    assert.equal(MENU.save, 'menu:save')
    assert.equal(MENU.saveAs, 'menu:save-as')
    assert.deepEqual([...MENU_CHANNELS], [
      'menu:new-project',
      'menu:open-project',
      'menu:save',
      'menu:save-as',
    ])
  })

  it('project channels match handler registrations exactly', () => {
    assert.equal(PROJECT_SAVE_CHANNEL, 'project:save')
    assert.equal(PROJECT_LOAD_CHANNEL, 'project:load')
    assert.equal(PROJECT_LOAD_PATH_CHANNEL, 'project:loadPath')
    assert.equal(PROJECT_EXPORT_SRT_CHANNEL, 'project:exportSRT')
    assert.equal(PROJECT_CREATE_TEMP_SRT_CHANNEL, 'project:createTempSRT')
    assert.equal(PROJECT_CREATE_TEMP_ASS_CHANNEL, 'project:createTempASS')
    assert.equal(PROJECT_RELINK_LIST_CHANNEL, 'project:relink:list')
    assert.equal(PROJECT_RELINK_LOCATE_CHANNEL, 'project:relink:locate')
    assert.equal(PROJECT_RELINK_SCAN_CHANNEL, 'project:relink:scan')
    assert.equal(PROJECT_RELINK_RETRY_CHANNEL, 'project:relink:retry')
    assert.equal(PROJECT_RELINK_CANCEL_CHANNEL, 'project:relink:cancel')
    assert.deepEqual([...PROJECT_CHANNELS], [
      'project:save',
      'project:load',
      'project:loadPath',
      'project:exportSRT',
      'project:createTempSRT',
      'project:createTempASS',
      'project:relink:list',
      'project:relink:locate',
      'project:relink:scan',
      'project:relink:retry',
      'project:relink:cancel',
    ])
  })

  it('no duplicate channel names across contracts', () => {
    const all = [...MENU_CHANNELS, ...PROJECT_CHANNELS, ...MODEL_INVOKE_CHANNELS, MODEL_PROGRESS_CHANNEL, ...MEDIA_RUNTIME_INVOKE_CHANNELS, MEDIA_RUNTIME_PROGRESS_CHANNEL, DIAGNOSTICS_EXPORT_CHANNEL]
    assert.equal(new Set(all).size, all.length)
  })

  it('model delivery channels expose only fixed catalog operations', () => {
    assert.deepEqual([...MODEL_INVOKE_CHANNELS], [
      MODEL_GET_STATUS_CHANNEL,
      MODEL_DOWNLOAD_CHANNEL,
      MODEL_CANCEL_CHANNEL,
    ])
    assert.equal(MODEL_GET_STATUS_CHANNEL, 'model:getStatus')
    assert.equal(MODEL_DOWNLOAD_CHANNEL, 'model:download')
    assert.equal(MODEL_CANCEL_CHANNEL, 'model:cancel')
    assert.equal(MODEL_PROGRESS_CHANNEL, 'model:progress')
  })

  it('media runtime delivery exposes download, offline install, status, and cancel', () => {
    assert.deepEqual([...MEDIA_RUNTIME_INVOKE_CHANNELS], [
      MEDIA_RUNTIME_GET_STATUS_CHANNEL,
      MEDIA_RUNTIME_DOWNLOAD_CHANNEL,
      MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL,
      MEDIA_RUNTIME_CANCEL_CHANNEL,
    ])
    assert.equal(MEDIA_RUNTIME_GET_STATUS_CHANNEL, 'mediaRuntime:getStatus')
    assert.equal(MEDIA_RUNTIME_DOWNLOAD_CHANNEL, 'mediaRuntime:download')
    assert.equal(MEDIA_RUNTIME_INSTALL_LOCAL_CHANNEL, 'mediaRuntime:installLocal')
    assert.equal(MEDIA_RUNTIME_CANCEL_CHANNEL, 'mediaRuntime:cancel')
    assert.equal(MEDIA_RUNTIME_PROGRESS_CHANNEL, 'mediaRuntime:progress')
  })

  it('diagnostics export has one explicit opt-in channel', () => {
    assert.equal(DIAGNOSTICS_EXPORT_CHANNEL, 'diagnostics:export')
  })
})
