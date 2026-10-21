import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw } from '../src/html.js';

test('html escapes interpolated values', () => {
  assert.equal(String(html`<p>${'<b>&"\''}</p>`),
    '<p>&lt;b&gt;&amp;&quot;&#39;</p>');
});

test('html keeps raw() and nested html untouched and joins arrays', () => {
  const items = ['a', '<b>'].map((x) => html`<li>${x}</li>`);
  assert.equal(String(html`<ul>${items}${raw('<hr>')}</ul>`),
    '<ul><li>a</li><li>&lt;b&gt;</li><hr></ul>');
});

test('html renders null and undefined as empty', () => {
  assert.equal(String(html`${null}${undefined}`), '');
});
