import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePointer,
  compilePointer,
  escapeToken,
  unescapeToken,
  get,
  set,
} from '../src/index.js';

describe('escapeToken / unescapeToken', () => {
  test('round-trips slashes and tildes', () => {
    const keys = ['a', 'a/b', 'a~b', '~/~', '~~//', ''];
    for (const k of keys) {
      assert.equal(unescapeToken(escapeToken(k)), k);
    }
  });

  test('unescapeToken applies ~1 before ~0', () => {
    assert.equal(unescapeToken('~01'), '~1');
  });

  test('escapeToken escapes ~ before /', () => {
    assert.equal(escapeToken('/'), '~1');
    assert.equal(escapeToken('~'), '~0');
    assert.equal(escapeToken('~/'), '~0~1');
  });
});

describe('parsePointer', () => {
  test('empty string is whole-document', () => {
    assert.deepEqual(parsePointer(''), []);
  });

  test('splits on slashes and decodes', () => {
    assert.deepEqual(parsePointer('/foo'), ['foo']);
    assert.deepEqual(parsePointer('/foo/0'), ['foo', '0']);
    assert.deepEqual(parsePointer('/a~1b~0c'), ['a/b~c']);
  });

  test('trailing slash yields an empty final token', () => {
    assert.deepEqual(parsePointer('/foo/'), ['foo', '']);
  });

  test('rejects pointer not starting with /', () => {
    assert.throws(() => parsePointer('foo'), /must start with/);
  });

  test('rejects dangling tilde', () => {
    assert.throws(() => parsePointer('/foo~'), /escape/);
    assert.throws(() => parsePointer('/foo~2'), /escape/);
  });
});

describe('compilePointer', () => {
  test('empty token list is empty string', () => {
    assert.equal(compilePointer([]), '');
  });

  test('escapes tokens', () => {
    assert.equal(compilePointer(['a/b', 'c~d']), '/a~1b/c~0d');
  });

  test('round-trips with parsePointer', () => {
    const pointers = ['', '/foo', '/foo/0', '/a~1b/c~0d', '/trailing/'];
    for (const p of pointers) {
      assert.equal(compilePointer(parsePointer(p)), p);
    }
  });
});

describe('get', () => {
  const doc = {
    foo: ['bar', 'baz', { '': 'empty key' }],
    'a/b': 'slash key',
    'm~n': 'tilde key',
    num: 42,
  };

  test('whole-document pointer returns the doc', () => {
    assert.equal(get(doc, ''), doc);
  });

  test('object key access', () => {
    assert.equal(get(doc, '/a~1b'), 'slash key');
    assert.equal(get(doc, '/m~0n'), 'tilde key');
  });

  test('array index access', () => {
    assert.equal(get(doc, '/foo/0'), 'bar');
    assert.equal(get(doc, '/foo/1'), 'baz');
  });

  test('empty-string object key', () => {
    assert.equal(get(doc, '/foo/2/'), 'empty key');
  });

  test('missing object key throws', () => {
    assert.throws(() => get(doc, '/nope'), /not found/);
  });

  test('out-of-bounds array index throws', () => {
    assert.throws(() => get(doc, '/foo/9'), /out of bounds/);
  });

  test('non-numeric array index throws', () => {
    assert.throws(() => get(doc, '/foo/x'), /Invalid array index/);
  });

  test('descending into a scalar throws', () => {
    assert.throws(() => get(doc, '/num/x'), /Cannot descend/);
  });

  test("'-' returns undefined (no such element)", () => {
    assert.equal(get(doc, '/foo/-'), undefined);
  });
});

describe('set', () => {
  test('replaces object value', () => {
    const doc = { foo: 'bar' };
    set(doc, '/foo', 'baz');
    assert.equal(doc.foo, 'baz');
  });

  test('replaces array element', () => {
    const doc = { foo: ['a', 'b', 'c'] };
    set(doc, '/foo/1', 'B');
    assert.deepEqual(doc.foo, ['a', 'B', 'c']);
  });

  test("'-' appends to array", () => {
    const doc = { foo: ['a'] };
    set(doc, '/foo/-', 'b');
    assert.deepEqual(doc.foo, ['a', 'b']);
  });

  test('index equal to length appends', () => {
    const doc = { foo: ['a'] };
    set(doc, '/foo/1', 'b');
    assert.deepEqual(doc.foo, ['a', 'b']);
  });

  test('creates missing object key', () => {
    const doc = {};
    set(doc, '/new', 'value');
    assert.equal(doc.new, 'value');
  });

  test('out-of-bounds array index throws', () => {
    const doc = { foo: ['a'] };
    assert.throws(() => set(doc, '/foo/5', 'x'), /out of bounds/);
  });

  test('whole-document pointer replaces root via mutator', () => {
    const doc = { old: true };
    let captured;
    set(doc, '', { new: true }, (v) => { captured = v; return v; });
    assert.deepEqual(captured, { new: true });
  });

  test('intermediate missing key throws', () => {
    const doc = { a: {} };
    assert.throws(() => set(doc, '/a/b/c', 1), /not found/);
  });
});
