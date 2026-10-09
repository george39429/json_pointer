# json-pointer

A tiny, dependency-free TypeScript library for resolving and applying RFC 6901 JSON Pointers against parsed JSON values.

## Usage

```js
import { get, set, parsePointer, compilePointer } from 'json-pointer';

const doc = { users: [{ name: 'Ada' }, { name: 'Grace' }] };

get(doc, '/users/0/name'); // 'Ada'

set(doc, '/users/-', { name: 'Margaret' });
// doc.users now has three elements

const tokens = parsePointer('/users/1/name'); // ['users', '1', 'name']
compilePointer(tokens); // '/users/1/name'
```

## Exports

- `parsePointer(pointer: string): string[]` — split a pointer into decoded tokens.
- `compilePointer(tokens: string[]): string` — join tokens back into a pointer string.
- `escapeToken(token: string): string` / `unescapeToken(token: string): string` — single-token helpers.
- `get(doc: unknown, pointer: string): unknown` — read the value at a pointer; throws on a missing key or out-of-bounds index.
- `set(doc: unknown, pointer: string, value: unknown, mutator?: (v: unknown) => unknown): unknown` — mutate the document at a pointer.

## Why

The point of a JSON Pointer library is to be a small, correct implementation of RFC 6901 §3-§4 that you can drop into a project without pulling a dependency tree. Everything here works on parsed JSON values (the output of `JSON.parse`); the library does not parse JSON, serialize it, or implement JSON Patch (RFC 6904) — that is a separate concern.

The trade-off: by staying this small, the library will not validate JSON schema fragments, resolve relative pointers, or apply patch operations like `move` or `copy`. If you need those, compose this library with your own code rather than asking it to grow.

## Awkward edges

- **Tilde escaping.** RFC 6901 escapes `/` as `~1` and `~` as `~0`, and the order matters. `~01` decodes to `~1` (tilde-one), not `/1`. This library applies `~1`→`/` before `~0`→`~` on read, and the reverse on write.
- **Empty-string keys.** A pointer ending in `/` (e.g. `/foo/`) targets the object key `''`. This is legal per the RFC and is supported here.
- **The `-` token.** For arrays, `-` means "one past the last element". `get` returns `undefined` for `-` because no such element exists; `set` treats `-` as an append. Reading `-` is not an error, which mirrors the RFC's framing of `-` as a position rather than an index.
- **Whole-document pointer.** `''` (the empty string) refers to the entire document. `get` returns the document; `set` cannot reassign the caller's variable, so it invokes an optional `mutator` callback instead.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

