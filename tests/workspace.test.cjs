const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
  const elements=new Map();
  class Element {
    constructor(){this.dataset={};this.value='';this.textContent='';this.hidden=false;this.children=[];this.listeners={};this.attributes={};const classes=new Set();this.classList={add(c){classes.add(c)},remove(c){classes.delete(c)},contains(c){return classes.has(c)},toggle(c,on){if(on)classes.add(c);else classes.delete(c)}};this.scrollTop=0;this.scrollHeight=100;this.clientHeight=100;}
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn)}
    setAttribute(k,v){this.attributes[k]=v} removeAttribute(k){delete this.attributes[k]}
    appendChild(e){this.children.push(e);return e} append(...es){this.children.push(...es)} prepend(e){this.children.unshift(e)} replaceChildren(...es){this.children=es} remove(){} after(){} focus(){this.focused=true} scrollIntoView(){this.scrolled=true} close(){this.open=false} showModal(){this.open=true}
    querySelectorAll(){return []} querySelector(){return new Element()} closest(){return new Element()}
    set innerHTML(v){this.children=[]} get innerHTML(){return ''}
  }
  const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
  const messages=[]; let response={rules:[],categories:[],logs:[],globalEnabled:true};
  const document={getElementById:el,createElement:()=>new Element(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},body:new Element()};
  const context=vm.createContext({document,console,URL,location:{hash:'#rules'},history:{replaceState(){}},window:{addEventListener(){},scrollTo(){},scrollY:0},setTimeout:()=>0,clearTimeout(){},chrome:{runtime:{onMessage:{addListener(){}},sendMessage(payload,cb){messages.push(payload);cb(payload.type==='get-state'?response:{ok:true})}}}});
  el('enabledFilter').value='all';el('modeFilter').value='all';
  vm.runInContext(fs.readFileSync('shared/search.js','utf8'),context);
  vm.runInContext(fs.readFileSync('options/options.js','utf8'),context);
  vm.runInContext(fs.readFileSync('options/workspace.js','utf8'),context);
  return {context,el,messages,setResponse:r=>response=r,run:code=>vm.runInContext(code,context)};
}
test('workspace initializes with all rules and renders all three view infrastructure without missing bindings',async()=>{
 const app=setup();await new Promise(setImmediate);assert.equal(app.run('selectedCategoryId'), '__all__');assert.equal(app.el('rulesTitle').textContent,'All rules');
});
test('category, name/URL/category search, enabled and mode filters combine',async()=>{
 const a=setup();await new Promise(setImmediate);
 a.run(`categories=[{id:'c',name:'Development'}];rules=[{id:'a',name:'API',categoryId:'c',source:'https://api.example.com',destination:'https://local.test',enabled:true,mode:'domain'},{id:'b',name:'Other',source:'x',destination:'y',enabled:false,mode:'exact'}]`);
 a.el('ruleSearch').value=' DEVELOPMENT ';assert.equal(a.run('getVisibleRules().length'),1);
 a.el('enabledFilter').value='disabled';assert.equal(a.run('getVisibleRules().length'),0);
 a.run('clearFilters();selectedCategoryId=""');assert.equal(a.run('getVisibleRules()[0].id'),'b');
});
test('paused log snapshot survives unrelated state refresh',async()=>{
 const a=setup();await new Promise(setImmediate);a.run('logs=[{info:"old"}]; logsPaused=true');a.setResponse({rules:[],categories:[],logs:[{info:'new'}],globalEnabled:true});await a.run('refresh(true)');assert.equal(a.run('logs[0].info'),'old');a.run('logsPaused=false');await a.run('refresh(true)');assert.equal(a.run('logs[0].info'),'new');
});
test('ordering sends global/category contracts and refuses filtered reorder',async()=>{
 const a=setup();await new Promise(setImmediate);await a.run('persistOrder(["a","b"],"a")');let payload=a.messages.find(m=>m.type==='reorder-rules');assert.equal('categoryId' in payload,false);
 a.messages.length=0;a.run('selectedCategoryId=""');await a.run('persistOrder(["b","a"],"a")');assert.equal(a.messages.find(m=>m.type==='reorder-rules').categoryId,null);
 a.messages.length=0;a.el('ruleSearch').value='hidden';await a.run('persistOrder(["b"],"b")');assert.equal(a.messages.length,0);
});
test('failed refresh retains existing data and exposes retry',async()=>{
 const a=setup();await new Promise(setImmediate);a.run('rules=[{id:"keep"}]');a.setResponse(undefined);await a.run('refresh()');assert.equal(a.run('rules[0].id'),'keep');assert.equal(a.el('loadError').hidden,false);
});


for (const [target,card,control] of [['ua','uaSettings','userAgentValue'],['pw-bot','pwBotSettings','pwBotDetectionToggle'],['csp','cspSettings','cspBypassToggle']]) {
  test('header shortcut opens and focuses ' + target + ' settings without changing saved configuration',async()=>{
    const a=setup(); await new Promise(setImmediate);
    a.messages.length=0;
    a.run('location.hash="#settings/' + target + '"; navigate()');
    assert.equal(a.run('activeView'),'settings');
    assert.equal(a.el(card).scrolled,true);
    assert.equal(a.el(control).focused,true);
    assert.equal(a.messages.length,0);
    if(target==='ua') {
      a.el('userAgentValue').value='Unsaved draft';
      a.run('navigate()');
      assert.equal(a.el('userAgentValue').value,'Unsaved draft');
    }
  });
}

test('UA actions appear only for changed fields and disappear on revert',async()=>{
  const a=setup();await new Promise(setImmediate);
  assert.equal(a.run('uaDirty()'),false);
  assert.equal(a.el('uaActions').classList.contains('has-changes'),false);
  a.el('userAgentValue').value='Custom/1.0';a.run('updateUAActions()');
  assert.equal(a.el('uaActions').classList.contains('has-changes'),true);
  a.run('resetUserAgentEditor()');
  assert.equal(a.run('uaDirty()'),false);
  a.el('userAgentMode').value='replace';a.run('updateUAActions()');
  assert.equal(a.run('uaDirty()'),true);
  a.el('userAgentMode').value='attach';a.run('updateUAActions()');
  assert.equal(a.el('uaActions').classList.contains('has-changes'),false);
});
test('UA draft survives state refresh and failed save',async()=>{
  const a=setup();await new Promise(setImmediate);a.el('userAgentValue').value='My draft';
  await a.run('refresh(true)');assert.equal(a.el('userAgentValue').value,'My draft');
  a.run('chrome.runtime.sendMessage=(payload,callback)=>callback({ok:false,error:"Save failed"})');
  await a.el('userAgentForm').listeners.submit[0]({preventDefault(){}});
  assert.equal(a.el('userAgentError').textContent,'Save failed');
  assert.equal(a.el('userAgentValue').value,'My draft');
  assert.equal(a.run('uaDirty()'),true);
  assert.equal(a.el('userAgentValue').disabled,false);
});
test('saving UA clears pending changes and preserves enabled setting',async()=>{
  const a=setup();await new Promise(setImmediate);a.el('userAgentValue').value='Custom/1.0';a.el('userAgentMode').value='replace';
  a.setResponse({rules:[],categories:[],logs:[],globalEnabled:true,userAgentOverride:{enabled:false,mode:'replace',value:'Custom/1.0'}});
  await a.el('userAgentForm').listeners.submit[0]({preventDefault(){}});
  assert.equal(a.run('uaDirty()'),false);
  assert.equal(a.el('uaActions').classList.contains('has-changes'),false);
  assert.equal(a.run('userAgentOverride.enabled'),false);
  assert.equal(a.el('userAgentMode').value,'replace');
});

test('category title actions are visible only for a selected custom category and rename opens its modal',async()=>{
  const a=setup();await new Promise(setImmediate);
  assert.equal(a.el('categoryTitleActions').hidden,true);
  a.run('categories=[{id:"cat",name:"PageOS"}]; selectedCategoryId="cat"; renderRules()');
  assert.equal(a.el('categoryTitleActions').hidden,false);
  a.el('btnRenameCategory').onclick();
  assert.equal(a.el('categoryModalTitle').textContent,'Rename Category');
  assert.equal(a.el('categoryName').value,'PageOS');
  assert.equal(a.el('categoryId').value,'cat');
  a.run('selectedCategoryId="";renderRules()');
  assert.equal(a.el('categoryTitleActions').hidden,true);
});
test('title trash action requires confirmation before deleting the selected category',async()=>{
  const a=setup();await new Promise(setImmediate);
  a.run('categories=[{id:"cat",name:"PageOS"}];selectedCategoryId="cat"');
  a.el('categoryId').value='stale-modal-category';a.messages.length=0;
  a.el('btnDeleteCategory').listeners.click[0]();
  assert.equal(a.el('confirmModal').open,true);
  assert.equal(a.messages.some(m=>m.type==='delete-category'),false);
  await a.el('btnYes').listeners.click[0]();
  assert.equal(a.messages.find(m=>m.type==='delete-category').categoryId,'cat');
});

test('rule search ANDs partial words across fields in any order, alongside existing filters',async()=>{
  const a=setup();await new Promise(setImmediate);
  a.run('categories=[{id:"dev",name:"Development"}];rules=[{id:"a",name:"Local PageOS",source:"https://cdn.test/page.js",destination:"https://localhost:3000",categoryId:"dev",enabled:true,mode:"exact"},{id:"b",name:"PageOS",source:"https://cdn.test",destination:"https://prod.test",enabled:true,mode:"exact"}]');
  a.el('ruleSearch').value='DEVEL page LOCALH';assert.equal(a.run('getVisibleRules().length'),1);
  a.el('ruleSearch').value='page missing';assert.equal(a.run('getVisibleRules().length'),0);
  a.el('ruleSearch').value='page local';a.el('enabledFilter').value='disabled';assert.equal(a.run('getVisibleRules().length'),0);
});
test('log search requires every partial term and retains event type filtering',async()=>{
  const a=setup();await new Promise(setImmediate);
  a.run('logs=[{time:"2026-10-29T12:00:00Z",info:"Local PageOS development applied"},{time:"2026-10-29T12:00:01Z",info:"PageOS production applied"}]');
  a.el('logsTypeFilter').value='all';a.el('logsSearch').value='DEVEL page';assert.equal(a.run('getVisibleLogs().length'),1);
  a.el('logsSearch').value='page absent';assert.equal(a.run('getVisibleLogs().length'),0);
  a.el('logsSearch').value='page';a.el('logsTypeFilter').value='user-agent';assert.equal(a.run('getVisibleLogs().length'),0);
});
