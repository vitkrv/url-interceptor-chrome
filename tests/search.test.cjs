const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMatcher}=require('../shared/search.js');
test('partial words are ANDed case insensitively in any order across fields',()=>{
  const matches=createMatcher('  PAGE   loc  ');
  assert.equal(matches(['Local service','PageOS']),true);
  assert.equal(matches('PageOS production'),false);
  assert.equal(matches('Local service'),false);
});
test('all whitespace separates terms and blank queries match everything',()=>{
  assert.equal(createMatcher('page\tloc\nDEV\u00a0cdn')(['Development','PageOS','Local','cdn.test']),true);
  assert.equal(createMatcher(' \t\n')(null),true);
  assert.equal(createMatcher('')(undefined),true);
  assert.equal(createMatcher('missing')([null,undefined]),false);
});
test('punctuation is literal and repeated words do not change matching',()=>{
  assert.equal(createMatcher('a.b [dev] a.b')('[dev] a.b'),true);
  assert.equal(createMatcher('a.b')('axb'),false);
  assert.equal(createMatcher('https://local:3000')(['https://local:3000/a']),true);
});
