'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validPassword } = require('../routes/registration-compliance');
const registrationCompliance = require('../routes/registration-compliance');

test('registration passwords require 12-128 Unicode characters', () => {
  assert.equal(validPassword('short'), false);
  assert.equal(validPassword('correct horse battery staple'), true);
  assert.equal(validPassword('a'.repeat(129)), false);
});
test('registration password rejects bcrypt truncation and common credentials', () => {
  assert.equal(validPassword('é'.repeat(37)), false);
  assert.equal(validPassword('password123456'), false);
  assert.equal(validPassword('123456789012'), false);
  assert.equal(validPassword('Z'.repeat(12)), false);
});
test('registration compliance requires explicit minimum-age acknowledgement', () => {
  let status;
  const res = {status(n){status=n;return this;},json(body){this.body=body;return this;}};
  let called=false;
  registrationCompliance({method:'POST',body:{age_confirmed:false,password:'correct horse battery staple'}},res,()=>{called=true;});
  assert.equal(status,400);
  assert.equal(called,false);
});
test('registration compliance allows validated request through', () => {
  let called=false;
  registrationCompliance({method:'POST',body:{age_confirmed:true,password:'correct horse battery staple'}},{},()=>{called=true;});
  assert.equal(called,true);
});
