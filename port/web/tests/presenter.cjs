const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHaloPresenter } = require('../site/presenter.js');
for (const mode of ['copy', 'bitmap']) {
  for (const fails of [false, true]) test(`${mode}: release frame and gate on ${fails ? 'failure' : 'success'}`, () => {
    const calls = [], gate = new Int32Array(new SharedArrayBuffer(4)); gate[0] = 1;
    const draw = () => { calls.push('draw'); if (fails) throw Error('draw failed'); };
    const canvas = {width:0,height:0,getContext:()=>({drawImage:draw,transferFromImageBitmap:draw})};
    const bitmap = {width:320,height:240,close:()=>calls.push('close')};
    const present = createHaloPresenter(canvas, mode, ()=>calls.push('before'),()=>calls.push('after'),()=>gate);
    if (fails) assert.throws(()=>present(bitmap)); else present(bitmap);
    assert.deepEqual(calls, fails ? ['before','draw','close'] : ['before','draw','after','close']);
    assert.equal(gate[0],0); assert.equal(canvas.width,320); assert.equal(canvas.height,240);
  });
}
test('worker caps outstanding frames until the main thread acknowledges', () => {
  let lib;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web_library.js'),'utf8'),{addToLibrary:x=>lib=x});
  let made=0, sent=0;
  const gate=new Int32Array(new SharedArrayBuffer(4));
  const context={Atomics,webHalo:{canvas:{transferToImageBitmap:()=>{made++;return {close(){}}}},presentationGate:gate,post:()=>sent++}};
  const present=vm.runInNewContext('('+lib.web_js_gl_present.toString()+')', context);
  present();present();present();
  assert.equal(made,1);assert.equal(sent,1);
  Atomics.store(gate,0,0);present();assert.equal(made,2);
});
test('worker releases its gate and bitmap if delivery fails', () => {
  let lib;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web_library.js'),'utf8'),{addToLibrary:x=>lib=x});
  let closed=0;const gate=new Int32Array(new SharedArrayBuffer(4));
  const context={Atomics,webHalo:{canvas:{transferToImageBitmap:()=>({close(){closed++}})},presentationGate:gate,post:()=>{throw Error('post failed')}}};
  const present=vm.runInNewContext('('+lib.web_js_gl_present.toString()+')',context);
  assert.throws(present);assert.equal(gate[0],0);assert.equal(closed,1);
});
const { createHaloPixelPresenter } = require('../site/presenter.js');
test('pixel presenter flips rows, reuses storage and acknowledges frames', () => {
  let allocations=0, shown, frames=0;
  const gate=new Int32Array(new SharedArrayBuffer(4));
  const context={createImageData:(w,h)=>{allocations++;return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)}},putImageData:i=>shown=Array.from(i.data)};
  const canvas={getContext:()=>context};
  const present=createHaloPixelPresenter(canvas,()=>{},()=>frames++,()=>gate);
  const source=new Uint8Array(new SharedArrayBuffer(8)); source.set([1,2,3,4,5,6,7,8]);
  gate[0]=1;present(source.buffer,1,2);
  assert.deepEqual(shown,[5,6,7,8,1,2,3,4]);assert.equal(gate[0],0);
  source[0]=9;gate[0]=1;present(source.buffer,1,2);
  assert.equal(shown[4],9);assert.equal(allocations,1);assert.equal(frames,2);
});
test('pixel presenter releases its gate on an exception', () => {
  const gate=new Int32Array(new SharedArrayBuffer(4));gate[0]=1;
  const canvas={getContext:()=>({createImageData:()=>{throw Error('out of memory')}})};
  assert.throws(()=>createHaloPixelPresenter(canvas,()=>{},()=>{},()=>gate)(new SharedArrayBuffer(4),1,1));
  assert.equal(gate[0],0);
});
test('readback worker never allocates ImageBitmaps and reuses fixed buffers', () => {
  let lib, sends=0;const bindings=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web_library.js'),'utf8'),{addToLibrary:x=>lib=x});
  const gate=new Int32Array(new SharedArrayBuffer(4));
  const gl={READ_FRAMEBUFFER:1,READ_FRAMEBUFFER_BINDING:2,RGBA:3,UNSIGNED_BYTE:4,getParameter:()=>7,bindFramebuffer:(t,f)=>bindings.push(f),readPixels:(x,y,w,h,f,t,b)=>b.fill(42)};
  const halo={canvas:{width:2,height:2,transferToImageBitmap(){throw Error('unexpected bitmap')}},presentationGate:gate,readback:true,context:gl,post:()=>sends++};
  const present=vm.runInNewContext('('+lib.web_js_gl_present.toString()+')',{Atomics,Uint8Array,SharedArrayBuffer,webHalo:halo});
  present();const buffer=halo.pixels.buffer;present();assert.equal(sends,1);
  gate[0]=0;present();assert.equal(halo.pixels.buffer,buffer);assert.equal(sends,2);
  assert.equal(halo.pixels[0],42);assert.deepEqual(bindings,[null,7,null,7]);
});

test('direct worker submits one notification per yielded iteration without pixel transport', () => {
  let lib;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web_library.js'),'utf8'),{addToLibrary:x=>lib=x});
  const sent=[];
  const halo={direct:true,canvas:{transferToImageBitmap(){throw Error('unexpected bitmap')}},post:(...args)=>sent.push(args)};
  const context={webHalo:halo}; // No Atomics/readPixels available: direct must never use them.
  const present=vm.runInNewContext('('+lib.web_js_gl_present.toString()+')',context);
  const end=vm.runInNewContext('('+lib.web_js_direct_frame_end.toString()+')',context);
  present();present();assert.equal(sent.length,0);
  end();end();assert.equal(sent.length,1);assert.equal(sent[0][0],'haloDirectFrame');
  present();end();assert.equal(sent.length,2);
});

test('direct worker uses the transferred canvas and never creates a private canvas', () => {
  let lib;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web_library.js'),'utf8'),{addToLibrary:x=>lib=x});
  let createCount=0;
  class Canvas {
    constructor(){createCount++;}
    getContext(){return {};}
    addEventListener(){}
  }
  const canvas=new Canvas(), halo={post(){}};
  const context={Module:{canvas},OffscreenCanvas:Canvas,webHalo:halo,Int32Array,SharedArrayBuffer,GL:{registerContext:()=>17,makeContextCurrent(){}}};
  const create=vm.runInNewContext('('+lib.web_js_gl_create.toString()+')',context);
  assert.equal(create(640,480,false,false,true),17);
  assert.equal(createCount,1);assert.equal(halo.canvas,canvas);assert.equal(canvas.width,640);
  assert.equal(halo.direct,true);
});

test('direct mode fails clearly if its transferred canvas is missing', () => {
  let lib;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web_library.js'),'utf8'),{addToLibrary:x=>lib=x});
  const messages=[];
  const context={Module:{},OffscreenCanvas:class {},webHalo:{post:(...args)=>messages.push(args)}};
  const create=vm.runInNewContext('('+lib.web_js_gl_create.toString()+')',context);
  assert.equal(create(640,480,false,false,true),0);
  assert.match(messages[0][1][1],/Reload with \?present=readback/);
});


test('launcher defaults to direct presentation and accepts explicit readback', () => {
  const app = fs.readFileSync(path.join(__dirname, '../site/app.js'), 'utf8');
  assert.match(app, /\['bitmap', 'copy', 'readback', 'direct'\]\.includes\(requestedPresentation\) \? requestedPresentation : 'direct'/);
});
