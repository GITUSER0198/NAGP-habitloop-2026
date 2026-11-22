import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailDomain, tenantLabel } from '../src/lib/organization';

test('the organization tenant is the email domain', () => {
  assert.equal(emailDomain(' Dhruv.Goel@Nagarro.com '), 'nagarro.com');
  assert.equal(tenantLabel('dhruv.goel@nagarro.com'), 'nagarro.com');
});
test('public mail providers show a personal account', () => {
  for (const domain of ['gmail.com', 'outlook.com', 'proton.me']) assert.equal(tenantLabel(`a@${domain}`), 'Personal account (public email domain)');
});
test('the label stays empty until the domain is complete', () => {
  for (const value of ['', 'abc', 'abc@', 'abc@nagarro']) assert.equal(tenantLabel(value), '');
});
