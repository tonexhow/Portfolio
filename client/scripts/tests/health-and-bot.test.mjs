import test from 'node:test';
import assert from 'node:assert/strict';
import {variation,variantCount} from '../chat/response-variants.js';

for(const category of ['welcome','intro','career','skills','experience','contact','certificates','projects','general']){
  test(`${category} has at least eight nonrepeating portfolio response variants`,()=>{
    assert.ok(variantCount(category)>=8);
    let previous='';
    const observed=new Set();
    for(let i=0;i<60;i++){
      const phrase=variation(category);
      assert.notEqual(phrase,previous,'Adjacent responses must not be identical');
      assert.ok(!phrase.includes('undefined'));
      previous=phrase;observed.add(phrase);
    }
    assert.ok(observed.size>=5,`Too little variety for ${category}`);
  });
}
