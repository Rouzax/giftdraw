const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class SafeHtml {
  #value;

  constructor(value) {
    this.#value = value;
  }

  toString() {
    return this.#value;
  }
}

export function escape(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Marks a string as already-safe markup. Only for trusted, static input.
export function raw(string) {
  return new SafeHtml(String(string));
}

function render(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

// Tagged template: every interpolated value is escaped unless it is SafeHtml,
// so nested templates compose without double escaping.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}
