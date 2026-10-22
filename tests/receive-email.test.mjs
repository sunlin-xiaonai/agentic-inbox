import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import PostalMime from 'postal-mime';
import { webcrypto } from 'node:crypto';
const source = fs.readFileSync(new URL('../workers/index.ts', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('async function receiveEmail('), source.indexOf('\nexport { app, receiveEmail }'));
const js = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const receive = vm.runInNewContext(`${js}\nreceiveEmail`, {
  PostalMime, crypto: webcrypto, Request, console, Folders: { INBOX: 'inbox' },
  streamToArrayBuffer: async (stream) => new Response(stream).arrayBuffer(),
});
async function deliver({ to = 'support@newyougo.com', header = '', allowed = [], exists = true } = {}) {
  const calls = [], heads = [], ids = [];
  const raw = new TextEncoder().encode(`From: sender@example.com\r\n${header}Subject: regression\r\nMessage-ID: <test@example.com>\r\n\r\nHello`);
  const env = {
    EMAIL_ADDRESSES: allowed,
    BUCKET: { head: async key => { heads.push(key); return exists ? {} : null; } },
    MAILBOX: { idFromName: id => { ids.push(id); return id; }, get: () => ({
      findThreadBySubject: async () => null, createEmail: async (...args) => calls.push(args),
    }) },
    EMAIL_AGENT: { idFromName: id => id, get: () => ({ fetch: async () => new Response('ok') }) },
  };
  await receive({ to, rawSize: raw.length, raw: new Blob([raw]).stream() }, env, { waitUntil() {} });
  return { calls, heads, ids };
}
test('receives Bcc mail with no To header using envelope recipient', async () => {
  const r = await deliver(); assert.equal(r.calls.length, 1);
  assert.equal(r.ids[0], 'support@newyougo.com');
  assert.equal(r.calls[0][1].recipient, 'support@newyougo.com');
});
test('envelope selects actual mailbox when To names another mailbox', async () => {
  const r = await deliver({ header: 'To: support@aifinderplus.com\r\n', allowed: ['support@newyougo.com'] });
  assert.equal(r.calls.length, 1); assert.equal(r.ids[0], 'support@newyougo.com');
  assert.equal(r.calls[0][1].recipient, 'support@aifinderplus.com');
});
test('does not bypass allowlist through a forged To header', async () => {
  const r = await deliver({ to: 'unknown@newyougo.com', header: 'To: support@newyougo.com\r\n', allowed: ['support@newyougo.com'] });
  assert.equal(r.calls.length, 0); assert.equal(r.heads.length, 0);
});
test('normalizes envelope and requires an existing mailbox', async () => {
  const r = await deliver({ to: ' Support@NewYouGo.com ', exists: false });
  assert.equal(r.heads[0], 'mailboxes/support@newyougo.com.json'); assert.equal(r.calls.length, 0);
});
test('rejects a missing envelope recipient', async () => {
  await assert.rejects(deliver({ to: '', header: 'To: support@newyougo.com\r\n' }), /recipient/);
});
