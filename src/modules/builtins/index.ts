// Batteries-included built-in modules (Todo 27).
//
// Registers every shipped module with the executor registry and attaches search
// metadata (used by `searchModules`). Call `registerAllModules()` once at playbook
// startup so the modules are available in PRODUCTION (not only in tests). This
// consolidates the file/service/shell builtins, `config_write`, and the new
// idempotent builtins (http, config_edit, blockinfile, lineinfile, sql,
// shell) under one entrypoint.

import { registerModule } from "../../executor/module";
import type { Module } from "../../executor/module";
import { serviceModule } from "./service";
import { setModuleMeta, type ModuleSummary } from "../search";
import { pkgModule } from "./package";
import { fileModule } from "./file";
import { httpModule } from "./http";
import { configEditModule } from "./config_edit";
import { blockinfileModule } from "./blockinfile";
import { lineinfileModule } from "./lineinfile";
import { sqlModule } from "./sql";
import { shellModule } from "./shell";
import { opensslCertModule } from "./openssl_certificate";
import { debugModule } from "./debug";
import { assertModule } from "./assert";
import { statModule } from "./stat";
import { copyModule } from "./copy";
import { userModule } from "./user";
import { groupModule } from "./group";
import { getUrlModule } from "./get_url";
import { gitModule } from "./git";
import { replaceModule } from "./replace";
import { commandModule } from "./command";
import { scriptModule } from "./script";
import { rawModule } from "./raw";
import { failModule } from "./fail";
import { setFactModule } from "./set_fact";
import { setRegModule } from "./set_reg";
import { addHostModule } from "./add_host";
import { waitForModule } from "./wait_for";
import { fetchModule } from "./fetch";
import { slurpModule } from "./slurp";
import { findModule } from "./find";
import { tempfileModule } from "./tempfile";
import { assembleModule } from "./assemble";
import { cronModule } from "./cron";
import { aptRepositoryModule } from "./apt_repository";
import { yumRepositoryModule } from "./yum_repository";
import { authorizedKeyModule } from "./authorized_key";
import { knownHostsModule } from "./known_hosts";
import { unarchiveModule } from "./unarchive";
import { archiveModule } from "./archive";
import { hostnameModule } from "./hostname";
import { sysctlModule } from "./sysctl";
import { modprobeModule } from "./modprobe";
import { mountModule } from "./mount";
import { selinuxModule } from "./selinux";
import { iptablesModule } from "./iptables";
import { ufwModule } from "./ufw";
import { timezoneModule } from "./timezone";
import { localeGenModule } from "./locale_gen";
import { aclModule } from "./acl";
import { pamLimitsModule } from "./pam_limits";
import { synchronizeModule } from "./synchronize";
import { jsonQueryModule } from "./json_query";
import { serviceFactsModule } from "./service_facts";
import { userInfoModule } from "./user_info";
import { groupInfoModule } from "./group_info";
import { pauseModule } from "./pause";
import { setStatsModule } from "./set_stats";
import { metaModule } from "./meta";
import { partedModule } from "./parted";
import { filesystemModule } from "./filesystem";
import { lvolModule } from "./lvol";
import { lvgModule } from "./lvg";

/**
 * Register all built-in modules with the executor registry (idempotent — safe to
 * call repeatedly) and auto-collect their search metadata. Each module carries its
 * summary on a `meta` property; the guarded blocks below copy it into the search
 * metadata map so `searchModules`/`getModuleSummary` cover every module.
 */
export function registerAllModules(): void {
  // file/service/shell builtins — auto-collect metadata carried on each module's `meta`.
  registerModule(serviceModule);
  if ((serviceModule as any).meta) setModuleMeta(serviceModule.name, (serviceModule as any).meta);

  // P7/P8 builtins — auto-collect metadata carried on each module's `meta`.
  registerModule(pkgModule);
  if ((pkgModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(pkgModule.name, (pkgModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(fileModule);
  if ((fileModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(fileModule.name, (fileModule as Module & { meta?: ModuleSummary }).meta!);

  // Idempotent builtins — auto-collect metadata carried on each module's `meta`.
  registerModule(httpModule);
  if ((httpModule as any).meta) setModuleMeta(httpModule.name, (httpModule as any).meta);
  registerModule(configEditModule);
  if ((configEditModule as any).meta) setModuleMeta(configEditModule.name, (configEditModule as any).meta);
  registerModule(blockinfileModule);
  if ((blockinfileModule as any).meta) setModuleMeta(blockinfileModule.name, (blockinfileModule as any).meta);
  registerModule(lineinfileModule);
  if ((lineinfileModule as any).meta) setModuleMeta(lineinfileModule.name, (lineinfileModule as any).meta);
  registerModule(sqlModule);
  if ((sqlModule as any).meta) setModuleMeta(sqlModule.name, (sqlModule as any).meta);
  registerModule(shellModule);
  if ((shellModule as any).meta) setModuleMeta(shellModule.name, (shellModule as any).meta);
  registerModule(opensslCertModule);
  if ((opensslCertModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(opensslCertModule.name, (opensslCertModule as Module & { meta?: ModuleSummary }).meta!);

  // Core test modules (also registered in executor/module.ts for always-on availability).
  registerModule(debugModule);
  if ((debugModule as any).meta) setModuleMeta(debugModule.name, (debugModule as any).meta);
  registerModule(assertModule);
  if ((assertModule as any).meta) setModuleMeta(assertModule.name, (assertModule as any).meta);
  // New Wave-2 parity modules (stat / copy / user).
  registerModule(statModule);
  if ((statModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(statModule.name, (statModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(copyModule);
  if ((copyModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(copyModule.name, (copyModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(userModule);
  if ((userModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(userModule.name, (userModule as Module & { meta?: ModuleSummary }).meta!);
  // Next-wave parity modules (group / get_url / git / replace).
  registerModule(groupModule);
  if ((groupModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(groupModule.name, (groupModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(getUrlModule);
  if ((getUrlModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(getUrlModule.name, (getUrlModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(gitModule);
  if ((gitModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(gitModule.name, (gitModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(replaceModule);
  if ((replaceModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(replaceModule.name, (replaceModule as Module & { meta?: ModuleSummary }).meta!);
  // Ansible-compatible utility + alternate modules (command/script/raw/fail/set_fact/add_host/wait_for).
  registerModule(commandModule);
  if ((commandModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(commandModule.name, (commandModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(scriptModule);
  if ((scriptModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(scriptModule.name, (scriptModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(rawModule);
  if ((rawModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(rawModule.name, (rawModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(failModule);
  if ((failModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(failModule.name, (failModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(setFactModule);
  if ((setFactModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(setFactModule.name, (setFactModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(setRegModule);
  if ((setRegModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(setRegModule.name, (setRegModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(addHostModule);
  if ((addHostModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(addHostModule.name, (addHostModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(waitForModule);
  if ((waitForModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(waitForModule.name, (waitForModule as Module & { meta?: ModuleSummary }).meta!);
  // File-pull + introspection modules (fetch/slurp/find/tempfile/assemble).
  registerModule(fetchModule);
  if ((fetchModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(fetchModule.name, (fetchModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(slurpModule);
  if ((slurpModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(slurpModule.name, (slurpModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(findModule);
  if ((findModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(findModule.name, (findModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(tempfileModule);
  if ((tempfileModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(tempfileModule.name, (tempfileModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(assembleModule);
  if ((assembleModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(assembleModule.name, (assembleModule as Module & { meta?: ModuleSummary }).meta!);
  // Scheduling + repo + SSH-key modules (cron/apt_repository/yum_repository/authorized_key/known_hosts).
  registerModule(cronModule);
  if ((cronModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(cronModule.name, (cronModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(aptRepositoryModule);
  if ((aptRepositoryModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(aptRepositoryModule.name, (aptRepositoryModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(yumRepositoryModule);
  if ((yumRepositoryModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(yumRepositoryModule.name, (yumRepositoryModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(authorizedKeyModule);
  if ((authorizedKeyModule as Module & { meta?: ModuleSummary }).meta) setModuleMeta(authorizedKeyModule.name, (authorizedKeyModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(knownHostsModule);
  if ((knownHostsModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(knownHostsModule.name, (knownHostsModule as Module & { meta?: ModuleSummary }).meta!);
  // Ansible-parity fill (Wave 5): unarchive/archive/hostname/sysctl/modprobe/mount.
  registerModule(unarchiveModule);
  if ((unarchiveModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(unarchiveModule.name, (unarchiveModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(archiveModule);
  if ((archiveModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(archiveModule.name, (archiveModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(hostnameModule);
  if ((hostnameModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(hostnameModule.name, (hostnameModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(sysctlModule);
  if ((sysctlModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(sysctlModule.name, (sysctlModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(modprobeModule);
  if ((modprobeModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(modprobeModule.name, (modprobeModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(mountModule);
  if ((mountModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(mountModule.name, (mountModule as Module & { meta?: ModuleSummary }).meta!);
  // Ansible-parity fill (Wave 6): selinux/iptables/ufw/timezone/locale_gen/acl/pam_limits.
  registerModule(selinuxModule);
  if ((selinuxModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(selinuxModule.name, (selinuxModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(iptablesModule);
  if ((iptablesModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(iptablesModule.name, (iptablesModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(ufwModule);
  if ((ufwModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(ufwModule.name, (ufwModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(timezoneModule);
  if ((timezoneModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(timezoneModule.name, (timezoneModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(localeGenModule);
  if ((localeGenModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(localeGenModule.name, (localeGenModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(aclModule);
  if ((aclModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(aclModule.name, (aclModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(pamLimitsModule);
  if ((pamLimitsModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(pamLimitsModule.name, (pamLimitsModule as Module & { meta?: ModuleSummary }).meta!);
  // Ansible-parity fill (Wave 7): synchronize/json_query/service_facts/user_info/group_info/pause/set_stats/meta/storage.
  registerModule(synchronizeModule);
  if ((synchronizeModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(synchronizeModule.name, (synchronizeModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(jsonQueryModule);
  if ((jsonQueryModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(jsonQueryModule.name, (jsonQueryModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(serviceFactsModule);
  if ((serviceFactsModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(serviceFactsModule.name, (serviceFactsModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(userInfoModule);
  if ((userInfoModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(userInfoModule.name, (userInfoModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(groupInfoModule);
  if ((groupInfoModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(groupInfoModule.name, (groupInfoModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(pauseModule);
  if ((pauseModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(pauseModule.name, (pauseModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(setStatsModule);
  if ((setStatsModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(setStatsModule.name, (setStatsModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(metaModule);
  if ((metaModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(metaModule.name, (metaModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(partedModule);
  if ((partedModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(partedModule.name, (partedModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(filesystemModule);
  if ((filesystemModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(filesystemModule.name, (filesystemModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(lvolModule);
  if ((lvolModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(lvolModule.name, (lvolModule as Module & { meta?: ModuleSummary }).meta!);
  registerModule(lvgModule);
  if ((lvgModule as Module & { meta?: ModuleSummary }).meta)
    setModuleMeta(lvgModule.name, (lvgModule as Module & { meta?: ModuleSummary }).meta!);
}
export {
  httpModule,
  configEditModule,
  blockinfileModule,
  lineinfileModule,
  sqlModule,
  shellModule,
  opensslCertModule,
  debugModule,
  assertModule,
  serviceModule,
  pkgModule,
  fileModule,
  statModule,
  copyModule,
  userModule,
  groupModule,
  getUrlModule,
  gitModule,
  replaceModule,
  commandModule,
  scriptModule,
  rawModule,
  failModule,
  setFactModule,
  addHostModule,
  waitForModule,
  fetchModule,
  slurpModule,
  findModule,
  tempfileModule,
  assembleModule,
  cronModule,
  aptRepositoryModule,
  yumRepositoryModule,
  authorizedKeyModule,
  knownHostsModule,
  unarchiveModule,
  archiveModule,
  hostnameModule,
  sysctlModule,
  modprobeModule,
  mountModule,
  selinuxModule,
  iptablesModule,
  ufwModule,
  timezoneModule,
  localeGenModule,
  aclModule,
  pamLimitsModule,
  synchronizeModule,
  jsonQueryModule,
  serviceFactsModule,
  userInfoModule,
  groupInfoModule,
  pauseModule,
  setStatsModule,
  metaModule,
  partedModule,
  filesystemModule,
  lvolModule,
  lvgModule,
};
