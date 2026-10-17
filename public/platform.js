'use strict';
const $=id=>document.getElementById(id);
let shops=[],editing=null;
function notice(message,error=false){$('message').textContent=message;$('message').classList.toggle('error',error);}
async function api(path,options={}){
 const response=await fetch('/api/platform'+path,{credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
 let data={};try{data=await response.json();}catch{}
 if(!response.ok)throw new Error(data.error||'Request failed.');return data;
}
function showWorkspace(yes){$('workspace').hidden=!yes;$('login').hidden=yes;}
function resetForm(){editing=null;$('shopForm').reset();$('formTitle').textContent='Add a shop';$('save').textContent='Create shop';$('cancel').hidden=true;$('shopForm').elements.slug.disabled=false;}
function button(label,fn){const b=document.createElement('button');b.type='button';b.className='small secondary';b.textContent=label;b.addEventListener('click',fn);return b;}
function row(shop){
 const tr=document.createElement('tr');const first=document.createElement('td');const strong=document.createElement('strong');strong.textContent=shop.company_name;first.append(strong);const sub=document.createElement('small');sub.textContent=shop.slug;first.append(sub);
 const accounts=document.createElement('td');accounts.textContent=String(shop.accounts);const jobs=document.createElement('td');jobs.textContent=String(shop.jobs);const action=document.createElement('td');action.append(button('Edit',()=>edit(shop)));tr.append(first,accounts,jobs,action);return tr;
}
function render(){const q=$('search').value.toLowerCase().trim();const filtered=shops.filter(s=>(s.company_name+' '+s.slug).toLowerCase().includes(q));$('shops').replaceChildren(...filtered.map(row));$('empty').hidden=filtered.length!==0;$('total').textContent=String(shops.length);$('accountCount').textContent=String(shops.reduce((n,s)=>n+Number(s.accounts||0),0));$('jobCount').textContent=String(shops.reduce((n,s)=>n+Number(s.jobs||0),0));}
function edit(s){editing=s.id;const form=$('shopForm');for(const key of ['company_name','slug','service_address','phone'])form.elements[key].value=s[key]||'';form.elements.slug.disabled=true;$('formTitle').textContent='Edit shop #'+s.id;$('save').textContent='Save changes';$('cancel').hidden=false;form.scrollIntoView({behavior:'smooth',block:'start'});}
async function refresh(){const data=await api('/shops');shops=data.shops||[];render();}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;notice('');try{const result=await api('/login',{method:'POST',body:JSON.stringify({email:$('email').value,password:$('password').value,code:$('code').value})});$('loginForm').reset();$('adminLabel').textContent=result.email;showWorkspace(true);await refresh();}catch(err){notice(err.message,true);}finally{b.disabled=false;}});
$('shopForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('save');b.disabled=true;notice('');const form=e.currentTarget;const payload={company_name:form.elements.company_name.value,slug:form.elements.slug.value,service_address:form.elements.service_address.value,phone:form.elements.phone.value};try{if(editing){await api('/shops/'+editing,{method:'PATCH',body:JSON.stringify(payload)});notice('Shop updated.');}else{await api('/shops',{method:'POST',body:JSON.stringify(payload)});notice('Shop created. Provision a manager account separately.');}resetForm();await refresh();}catch(err){notice(err.message,true);}finally{b.disabled=false;}});
$('search').addEventListener('input',render);$('cancel').addEventListener('click',resetForm);
$('logout').addEventListener('click',async()=>{try{await api('/logout',{method:'POST'});}catch{}showWorkspace(false);shops=[];render();notice('Signed out.');});
(async()=>{try{const me=await api('/me');$('adminLabel').textContent=me.email;showWorkspace(true);await refresh();}catch{showWorkspace(false);}})();
