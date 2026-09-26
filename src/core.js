/**
 * JSON Pointer (RFC 6901) core operations.
 *
 * Design decisions:
 *
 * - The library works on parsed JSON values (the result of JSON.parse). It does
 *   not parse JSON itself, keeping it dependency-free and letting the caller
 *   control error handling for malformed input.
 *
 * - Object keys are accessed by string identity. JSON objects are unordered
 *   by spec, but in practice they are JS objects whose string keys are compared
 *   by value. Array indices are validated as non-negative base-10 integers and
 *   required to fit within the array bounds; leading zeros are rejected per
 *   the spirit of RFC 6901 (which uses JSON-number-like tokens for arrays).
 *
 * - The only thrown error type is Error. Callers can catch generically. The
 *   error messages are specific so that a failing pointer can be diagnosed
 *   from a stack trace.
 */

/**
 * Decode a single RFC 6901 reference token: '~1' -> '/', '~0' -> '~'.
 *
 * RFC 6901 §3 mandates this exact transformation order: '~1' first, then '~0'.
 * Reversing the order would mis-decode '~01' (which should be '~1', not '/'
 * followed by '1').
 */
export function unescapeToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Encode a single token for inclusion in a JSON Pointer: '/' -> '~1', '~' -> '~0'.
 *
 * Here the order is '~' -> '~0' first, then '/' -> '~1'. This is the inverse of
 * unescapeToken and is required so that a literal '/' in the key is not
 * accidentally turned into '~01' by the '~' rule.
 */
export function escapeToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Parse a JSON Pointer string into a list of decoded reference tokens.
 *
 * - The empty string '' is the whole-document pointer and yields [].
 * - A pointer that does not start with '/' is invalid.
 * - A pointer that contains a raw '~' not followed by '0' or '1' is invalid.
 * - A trailing '/' (e.g. '/foo/') is a one-token pointer whose final token is
 *   the empty string; this is legal per RFC 6901 and refers to the '' key.
 */
export function parsePointer(pointer) {
  if (typeof pointer !== 'string') {
    throw new TypeError('JSON Pointer must be a string');
  }
  if (pointer === '') {
    return [];
  }
  if (pointer[0] !== '/') {
    throw new Error(`Invalid JSON Pointer: '${pointer}' (must start with '/')`);
  }

  // Validate escapes before splitting so we fail fast on a dangling '~'.
  if (/~([^01]|$)/.test(pointer)) {
    throw new Error(`Invalid JSON Pointer escape in '${pointer}'`);
  }

  // Slice off the leading '/', then split on '/'. Because the leading slash is
  // gone, a trailing '/' produces a final empty-string token as required.
  return pointer.slice(1).split('/').map(unescapeToken);
}

/**
 * Build a JSON Pointer string from a list of (already-decoded) tokens.
 * Each token is escaped and joined with '/'. An empty token list is the
 * whole-document pointer ''.
 */
export function compilePointer(tokens) {
  if (!Array.isArray(tokens)) {
  if (!Array.isArray(tokens)) {
    throw new TypeError('tokens must be an array');
  }
  throw new TypeError('tokens must be an array');
  }
  if (tokens.length === 0) {
    return '';
  }
  return '/' + tokens.map(escapeToken).join('/');
}

/**
 * Resolve a JSON Pointer against a parsed JSON document and return the
 * referenced value (without copying; mutations to the result affect the doc).
 *
 * Returns undefined for the whole-document pointer '' applied to the value
 * undefined itself. For any non-empty pointer, an absent key or an
 * out-of-bounds/invalid array index throws an Error.
 *
 * The '-' token is supported for arrays: it refers to the position one past
 * the last element (useful for append with add). Reading '-' returns undefined
 * because no such element exists; callers using '-' for append should use the
 * parent plus the computed index instead.
 */
export function get(doc, pointer) {
  const tokens = parsePointer(pointer);
  let value = doc;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (Array.isArray(value)) {
      if (token === '-') {
        // '-' means "one past the end"; no element exists there to read.
        return undefined;
      }
      if (!/^[0-9]+$/.test(token)) {
        throw new Error(`Invalid array index '${token}'`);
      }
      const index = Number(token);
      if (index > 2 ** 53 - 1) {
        throw new Error(`Array index out of range: '${token}'`);
      }
      if (index >= value.length) {
        throw new Error(`Index ${index} out of bounds for array of length ${value.length}`);
      }
      value = value[index];
    } else if (value !== null && typeof value === 'object') {
      if (!Object.prototype.hasOwnProperty.call(value, token)) {
        throw new Error(`Key '${token}' not found`);
      }
      value = value[token];
    } else {
      throw new Error(`Cannot descend into ${typeof value} at token '${token}'`);
    }
  }
  return value;
}

/**
 * Apply an RFC 6901 JSON Pointer operation that sets a value.
 *
 * Mutates the document in place. The whole-document pointer '' replaces the
 * root via reassignment through the provided mutator (see setRoot below).
 *
 * For arrays, '-' appends; a numeric index equal to length appends; a numeric
 * index < length replaces; any other index is out of bounds.
 */
export function set(doc, pointer, value, mutator) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return mutator ? mutator(value) : (doc = value);
  }
  let target = doc;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    target = descendForWrite(target, token);
  }
  const last = tokens[tokens.length - 1];
  assignLeaf(target, last, value);
  return doc;
}

/**
 * Walk one step for a write operation, throwing if the path is impossible.
 */
function descendForWrite(target, token) {
  if (Array.isArray(target)) {
    if (token === '-') {
      throw new Error("'-' is only valid as the final token of a write");
    }
    if (!/^[0-9]+$/.test(token)) {
      throw new Error(`Invalid array index '${token}'`);
    }
    const index = Number(token);
    if (index >= target.length) {
      throw new Error(`Index ${index} out of bounds for array of length ${target.length}`);
    }
    return target[index];
  }
  if (target !== null && typeof target === 'object') {
    if (!Object.prototype.hasOwnProperty.call(target, token)) {
      throw new Error(`Key '${token}' not found`);
    }
    return target[token];
  }
  throw new Error(`Cannot descend into ${typeof target} at token '${token}'`);
}

/**
 * Assign the final leaf of a write. Handles array append/replace and object set.
 */
function assignLeaf(target, token, value) {
  if (Array.isArray(target)) {
    if (token === '-') {
      target.push(value);
      return;
    }
    if (!/^[0-9]+$/.test(token)) {
      throw new Error(`Invalid array index '${token}'`);
    }
    const index = Number(token);
    if (index > target.length) {
      throw new Error(`Index ${index} out of bounds for array of length ${target.length}`);
    }
    if (index === target.length) {
      target.push(value);
    } else {
      target[index] = value;
    }
    return;
  }
  if (target !== null && typeof target === 'object') {
    target[token] = value;
    return;
  }
  throw new Error(`Cannot assign into ${typeof target} at token '${token}'`);
}
