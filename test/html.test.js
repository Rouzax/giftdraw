import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, withBreaks } from '../src/html.js';

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

test('withBreaks escapes every line and joins them with <br>, whatever the line ending', () => {
  assert.equal(withBreaks('a <b>\r\n\nc & d').toString(), 'a &lt;b&gt;<br><br>c &amp; d');
  assert.equal(html`<td>${withBreaks('x')}</td>`.toString(), '<td>x</td>');
});
