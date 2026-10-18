---
title: ParsedCron
kind: interface
longname: module:orchestrator.ParsedCron
---

# ParsedCron

<Signature
  code="interface ParsedCron {
	dom: ReadonlySet<number>;
	domRestricted: boolean;
	dow: ReadonlySet<number>;
	dowNormalized: ReadonlySet<number>;
	dowRestricted: boolean;
	hour: ReadonlySet<number>;
	minute: ReadonlySet<number>;
	month: ReadonlySet<number>;
	rawDom: string;
	rawDow: string;
	rawHour: string;
	rawMinute: string;
	rawMonth: string;
}"
/>

<SourceLink href="/source/src/orchestrator/cron-ts/#L11" label="cron.ts:11" />

---

## Properties

<MemberHeading id="dom" depth="3" name="dom" sig="dom: ReadonlySet<number>" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L14" sourceLabel="cron.ts:14" />

<MemberHeading id="domrestricted" depth="3" name="domRestricted" sig="domRestricted: boolean" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L25" sourceLabel="cron.ts:25" />

True when the raw field was anything other than a bare "\*".

<MemberHeading id="dow" depth="3" name="dow" sig="dow: ReadonlySet<number>" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L16" sourceLabel="cron.ts:16" />

<MemberHeading id="downormalized" depth="3" name="dowNormalized" sig="dowNormalized: ReadonlySet<number>" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L18" sourceLabel="cron.ts:18" />

day-of-week normalized to 0..6 (Sunday both 0 and 7 -> 0).

<MemberHeading id="dowrestricted" depth="3" name="dowRestricted" sig="dowRestricted: boolean" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L26" sourceLabel="cron.ts:26" />

<MemberHeading id="hour" depth="3" name="hour" sig="hour: ReadonlySet<number>" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L13" sourceLabel="cron.ts:13" />

<MemberHeading id="minute" depth="3" name="minute" sig="minute: ReadonlySet<number>" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L12" sourceLabel="cron.ts:12" />

<MemberHeading id="month" depth="3" name="month" sig="month: ReadonlySet<number>" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L15" sourceLabel="cron.ts:15" />

<MemberHeading id="rawdom" depth="3" name="rawDom" sig="rawDom: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L21" sourceLabel="cron.ts:21" />

<MemberHeading id="rawdow" depth="3" name="rawDow" sig="rawDow: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L23" sourceLabel="cron.ts:23" />

<MemberHeading id="rawhour" depth="3" name="rawHour" sig="rawHour: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L20" sourceLabel="cron.ts:20" />

<MemberHeading id="rawminute" depth="3" name="rawMinute" sig="rawMinute: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L19" sourceLabel="cron.ts:19" />

<MemberHeading id="rawmonth" depth="3" name="rawMonth" sig="rawMonth: string" />

<MemberMeta badges="readonly" sourceHref="/source/src/orchestrator/cron-ts/#L22" sourceLabel="cron.ts:22" />
