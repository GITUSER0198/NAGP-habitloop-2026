import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestCommunity } from '../src/lib/community-name';

test('a work email suggests a capitalised community name', () => {
  assert.equal(suggestCommunity('dhruv.goel@nagarro.com'), 'Nagarro');
  assert.equal(suggestCommunity(' Ana@Mail.Acme-Corp.co.uk '), 'Acme Corp');
});

test('public mail domains and incomplete addresses give no suggestion', () => {
  for (const email of ['a@gmail.com', 'a@outlook.com', 'a@yahoo.com', 'a@hotmail.com', 'a@icloud.com', 'a@', 'a', '', 'a@b']) {
    assert.equal(suggestCommunity(email), '', email);
  }
});
