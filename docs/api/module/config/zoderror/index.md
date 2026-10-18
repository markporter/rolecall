---
title: ZodError
kind: interface
longname: module:config.ZodError
description: An Error-like class used to store Zod validation issues.
---

# ZodError

<Signature
  code="interface ZodError<T = unknown> extends $ZodError<T> {
	_zod: { def: $ZodIssue[]; output: T };
	cause?: unknown;
	isEmpty: boolean;
	issues: $ZodIssue[];
	message: string;
	name: string;
	stack?: string;
	type: T;
	addIssue(issue: $ZodIssue): void;
	addIssues(issues: $ZodIssue[]): void;
	flatten(): $ZodFlattenedError<T>;
	format(): $ZodFormattedError<T>;
}"
/>

<SourceLink href="/source/node-modules/zod/v4/classic/errors-d-cts/#L6" label="errors.d.cts:6" />

An Error-like class used to store Zod validation issues.

**Type Parameters**

- `T` = `unknown`

**Type**

`$constructor<`[`ZodError`](/module/config/zoderror)`<unknown>, $ZodIssue[]>`

#### Hierarchy

- `$ZodError<T>`
- `ZodError`

---

## Properties

<MemberHeading id="zod" depth="3" name="_zod" sig="_zod: { def: $ZodIssue[]; output: T }" />

<MemberMeta sourceHref="/source/node-modules/zod/v4/core/errors-d-cts/#L139" sourceLabel="errors.d.cts:139" />

_Inherited from&#x20;_`_zod`

**Properties**

- `def` ($ZodIssue\[])
- `output` (T)

<MemberHeading id="cause" depth="3" name="cause" sig="cause: unknown" />

<MemberMeta sourceHref="/source/node-modules/typescript/lib/lib-es2022-error-d-ts/#L26" sourceLabel="lib.es2022.error.d.ts:26" />

_Inherited from&#x20;_`cause`

The cause of the error.

<MemberHeading id="isempty" depth="3" name="isEmpty" sig="isEmpty: boolean" />

<MemberMeta badges="deprecated" sourceHref="/source/node-modules/zod/v4/classic/errors-d-cts/#L18" sourceLabel="errors.d.cts:18" />

<Callout type="error">
  &#x20;Check \`err.issues.length === 0\` instead.
</Callout>

<MemberHeading id="issues" depth="3" name="issues" sig="issues: $ZodIssue[]" />

<MemberMeta sourceHref="/source/node-modules/zod/v4/core/errors-d-cts/#L138" sourceLabel="errors.d.cts:138" />

_Inherited from&#x20;_`issues`

<MemberHeading id="message" depth="3" name="message" sig="message: string" />

<MemberMeta sourceHref="/source/node-modules/typescript/lib/lib-es5-d-ts/#L1077" sourceLabel="lib.es5.d.ts:1077" />

_Inherited from&#x20;_`message`

<MemberHeading id="name" depth="3" name="name" sig="name: string" />

<MemberMeta sourceHref="/source/node-modules/zod/v4/core/errors-d-cts/#L144" sourceLabel="errors.d.cts:144" />

_Inherited from&#x20;_`name`

<MemberHeading id="stack" depth="3" name="stack" sig="stack: string" />

<MemberMeta sourceHref="/source/node-modules/zod/v4/core/errors-d-cts/#L143" sourceLabel="errors.d.cts:143" />

_Inherited from&#x20;_`stack`

<MemberHeading id="type" depth="3" name="type" sig="type: T" />

<MemberMeta sourceHref="/source/node-modules/zod/v4/core/errors-d-cts/#L137" sourceLabel="errors.d.cts:137" />

_Inherited from&#x20;_`type`

## Methods

<MemberHeading id="addissue" depth="3" name="addIssue" sig="addIssue(issue: $ZodIssue): void" />

<MemberMeta badges="deprecated" sourceHref="/source/node-modules/zod/v4/classic/errors-d-cts/#L14" sourceLabel="errors.d.cts:14" />

<Callout type="error">
  &#x20;Push directly to \`.issues\` instead.
</Callout>

**Parameters**

- `issue` ($ZodIssue)

**Returns**

- `void`

<MemberHeading id="addissues" depth="3" name="addIssues" sig="addIssues(issues: $ZodIssue[]): void" />

<MemberMeta badges="deprecated" sourceHref="/source/node-modules/zod/v4/classic/errors-d-cts/#L16" sourceLabel="errors.d.cts:16" />

<Callout type="error">
  &#x20;Push directly to \`.issues\` instead.
</Callout>

**Parameters**

- `issues` ($ZodIssue\[])

**Returns**

- `void`

<MemberHeading id="flatten" depth="3" name="flatten" sig="flatten" />

<MemberMeta badges="deprecated" sourceHref="/source/node-modules/zod/v4/classic/errors-d-cts/#L11" sourceLabel="errors.d.cts:11" />

<Callout type="error">
  &#x20;Use the \`z.treeifyError(err)\` function instead.
</Callout>

<Signature code="flatten(): $ZodFlattenedError<T>" />

**Returns**

- `$ZodFlattenedError<T>`

<Signature
  code="flatten<
	U,
>(
	mapper: (issue: $ZodIssue) => U,
): $ZodFlattenedError<T, U>"
/>

**Type Parameters**

- `U`

**Parameters**

- `mapper` ((issue: $ZodIssue) => U)

**Returns**

- `$ZodFlattenedError<T, U>`

<MemberHeading id="format" depth="3" name="format" sig="format" />

<MemberMeta badges="deprecated" sourceHref="/source/node-modules/zod/v4/classic/errors-d-cts/#L8" sourceLabel="errors.d.cts:8" />

<Callout type="error">
  &#x20;Use the \`z.treeifyError(err)\` function instead.
</Callout>

<Signature code="format(): $ZodFormattedError<T>" />

**Returns**

- `$ZodFormattedError<T>`

<Signature
  code="format<
	U,
>(
	mapper: (issue: $ZodIssue) => U,
): $ZodFormattedError<T, U>"
/>

**Type Parameters**

- `U`

**Parameters**

- `mapper` ((issue: $ZodIssue) => U)

**Returns**

- `$ZodFormattedError<T, U>`
