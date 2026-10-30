/**
 * Structured JSON logger with recursive redaction of secrets, OAuth codes, tokens, and cookies.
 */

const SENSITIVE_KEY_PATTERN = /^(code|authorization_code|access_token|accesstoken|id_token|idtoken|refresh_token|refreshtoken|client_secret|clientsecret|line_channel_secret|session_secret|cookie|set-cookie|authorization|x-csrf-token|csrftoken|csrf_token|token|tx_token|code_verifier|codeverifier|secret|password)$/i;

const SENSITIVE_QUERY_PARAM_PATTERN = /([?&](?:code|state|access_token|id_token|refresh_token|client_secret|session_secret)=)[^&#\s]*/gi;

export function redactString(str) {
  if (typeof str !== 'string') return str;
  let sanitized = str.replace(SENSITIVE_QUERY_PARAM_PATTERN, '$1[REDACTED]');
  // Redact JWT-shaped strings (three base64url segments starting with eyJ)
  sanitized = sanitized.replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
  return sanitized;
}

export function redactValue(value, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message || '')
    };
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }

  return String(value);
}

export function createLogger(env = {}) {
  const sink = typeof env.__LOG_SINK === 'function' ? env.__LOG_SINK : null;

  function emit(level, event, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...redactValue(details)
    };
    const serialized = JSON.stringify(entry);
    if (sink) {
      sink(entry, serialized);
      return;
    }
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  return {
    info: (event, details) => emit('info', event, details),
    warn: (event, details) => emit('warn', event, details),
    error: (event, details) => emit('error', event, details)
  };
}
