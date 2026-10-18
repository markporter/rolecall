---
title: transport
kind: module
longname: module:transport
---

# transport

<SourceLink href="/source/src/transport/index-ts/#L1" label="index.ts:1" />

---

## Classes

- [`AbortError`](/module/transport/aborterror)
- [`HttpApiConnection`](/module/transport/httpapiconnection)
- [`LocalConnection`](/module/transport/localconnection)
- [`NetworkSshConnection`](/module/transport/networksshconnection)
- [`SshConnection`](/module/transport/sshconnection)
- [`TimeoutError`](/module/transport/timeouterror)

## Interfaces

- [`ApplyOptions`](/module/transport/applyoptions)
- [`ApplyResult`](/module/transport/applyresult)
- [`BaseConnectionOptions`](/module/transport/baseconnectionoptions)
- [`ConfigDiff`](/module/transport/configdiff)
- [`Connection`](/module/transport/connection)
- [`ConnectionFacts`](/module/transport/connectionfacts)
- [`Credentials`](/module/transport/credentials)
- [`ExecOptions`](/module/transport/execoptions)
- [`ExecResult`](/module/transport/execresult)
- [`HealthStatus`](/module/transport/healthstatus)
- [`HttpApiConnectionOptions`](/module/transport/httpapiconnectionoptions)
- [`HttpApiRequest`](/module/transport/httpapirequest)
- [`HttpGrpcCapability`](/module/transport/httpgrpccapability)
- [`LocalConnectionOptions`](/module/transport/localconnectionoptions)
- [`NetworkConnectionOptions`](/module/transport/networkconnectionoptions)
- [`ResilienceConfig`](/module/transport/resilienceconfig)
- [`RetryConfig`](/module/transport/retryconfig)
- [`SshConnectionOptions`](/module/transport/sshconnectionoptions)
- [`VendorDriver`](/module/transport/vendordriver)

## Type Aliases

- [`ConnectionOptions`](/module/transport/connectionoptions)
- [`CoreExec`](/module/transport/coreexec)
- [`HttpAuth`](/module/transport/httpauth)
- [`Server`](/module/transport/server)

## Functions

- [`createConnection`](/module/transport/createconnection)
- [`createResilientRunner`](/module/transport/createresilientrunner)
- [`diffConfigs`](/module/transport/diffconfigs)
- [`isFatalError`](/module/transport/isfatalerror)
- [`normalizeConfig`](/module/transport/normalizeconfig)
- [`planCommit`](/module/transport/plancommit)
- [`resolveRetryConfig`](/module/transport/resolveretryconfig)
- [`verifyHostKey`](/module/transport/verifyhostkey)

## Variables

- [`DEFAULT_CONCURRENCY`](/module/transport/default-concurrency)
- [`DEFAULT_RETRY_CONFIG`](/module/transport/default-retry-config)
- [`DEFAULT_TIMEOUT_MS`](/module/transport/default-timeout-ms)
- [`IOS_DRIVER`](/module/transport/ios-driver)
- [`Server`](/module/transport/server)
