import test from 'node:test';
import assert from 'node:assert/strict';
import {mergePublishedMedia} from '../tools/snapshot-helpers.mjs';

const sample={schema_version:1,revision:10,information:{name:{full:'Jhon Anthony Pano'}},
  projects:[],certificates:[],feedback:[]};
test('new live snapshot removes a deleted certificate instead of resurrecting it',()=>{
  const old={...sample,certificates:[{id:2,image_url:'/assets/published/certificate-2.png'}]};
  const live={...sample,revision:11,certificates:[]};
  const data=mergePublishedMedia(live,old).snapshot;
  assert.deepEqual(data.certificates,[]);
});
test('new live certificates use Supabase Storage directly',()=>{
  const url='https://project.supabase.co/storage/v1/object/public/portfolio-media/certificates/new.png';
  const live={...sample,certificates:[{id:19,image_url:url,download_url:url}]};
  assert.equal(mergePublishedMedia(live,sample).snapshot.certificates[0].image_url,url);
});
test('old PostgreSQL blob URLs fall back only for matching, still-visible certificate IDs',()=>{
  const old={...sample,certificates:[{id:7,image_url:'/assets/published/certificate-7.png'}]};
  const live={...sample,certificates:[{id:7,image_url:'/api/public/certificates/7/image',download_url:'/api/public/certificates/7/download'}]};
  assert.equal(mergePublishedMedia(live,old).snapshot.certificates[0].image_url,'/assets/published/certificate-7.png');
});
test('drafts and pending feedback cannot be exported through public RPC',()=>{
  assert.throws(()=>mergePublishedMedia({...sample,projects:[{visible:false}]},sample),/Unsafe/);
  assert.throws(()=>mergePublishedMedia({...sample,feedback:[{status:'pending'}]},sample),/Unsafe/);
});
