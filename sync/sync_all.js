/*!
 * cnpmjs.org - sync/sync_all.js
 *
 * Copyright(c) cnpmjs.org and other contributors.
 * MIT Licensed
 *
 * Authors:
 *  dead_horse <dead_horse@qq.com> (http://deadhorse.me)
 */

'use strict';

/**
 * Module dependencies.
 */

var ms = require('humanize-ms');
var thunkify = require('thunkify-wrap');
var config = require('../config');
var Status = require('./status');
var npmService = require('../services/npm');
var totalService = require('../services/total');
var SyncModuleWorker = require('../controllers/sync_module_worker');
var logger = require('../common/logger');

/**
 * when sync from official at the first time
 * get all packages by short and restart from last synced module
 * @param {String} lastSyncModule
 */
function* getFirstSyncPackages(lastSyncModule) {
  var pkgs = yield* npmService.getShort();
  if (!lastSyncModule) {
    return pkgs;
  }
  // start from last success
  var lastIndex = pkgs.indexOf(lastSyncModule);
  if (lastIndex > 0) {
    return pkgs.slice(lastIndex);
  }
}

/**
 * get all the packages that update time > lastSyncTime
 * @param {Number} lastSyncTime
 */
function* getCommonSyncPackages(lastSyncTime) {
  var data = yield* npmService.getAllSince(lastSyncTime);
  if (!data) {
    return [];
  } else if (Array.isArray(data)) {
    // support https://registry.npmjs.org/-/all/static/today.json
    return data.map(function (item) {
      return item.name;
    });
  } else {
    delete data._updated;
    return Object.keys(data);
  }
}

module.exports = function* sync() {
  var syncTime = Date.now();
  var info = yield* totalService.getTotalInfo();
  if (!info) {
    throw new Error('can not found total info');
  }

  var packages;
  logger.syncInfo('Last sync time %s', new Date(info.last_sync_time));
  if (!info.last_sync_time) {
    logger.syncInfo('First time sync all packages from official registry');
    packages = yield* getFirstSyncPackages(info.last_sync_module);
  } else {
    packages = yield* getCommonSyncPackages(info.last_sync_time - ms('10m'));
  }

  packages = packages || [];
  if (!packages.length) {
    logger.syncInfo('no packages need be sync');
    return;
  }
  logger.syncInfo('Total %d packages to sync: %j', packages.length, packages);

  var worker = new SyncModuleWorker({
    username: 'admin',
    name: packages,
    noDep: true,
    concurrency: config.syncConcurrency,
    syncUpstreamFirst: false,
  });
  Status.init({need: packages.length}, worker);
  worker.start();
  var end = thunkify.event(worker);
  yield end();

  logger.syncInfo('All packages sync done, successes %d, fails %d',
      worker.successes.length, worker.fails.length);
  //only when all succss, set last sync time
  if (!worker.fails.length) {
    yield* totalService.setLastSyncTime(syncTime);
  }
  return {
    successes: worker.successes,
    fails: worker.fails
  };
};
