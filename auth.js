/* Google Identity Services login. No ID token is written to browser storage. */
(function(){
 'use strict';
 let clientId='',token=null,subject=null,expires=0;
 let initialized=false,manualOnly=false,buttonElement=null;
 const listeners=new Set();
 const status=()=>({configured:!!clientId,signedIn:!!token&&Date.now()<expires,subject:subject});
 const notify=()=>listeners.forEach(f=>f(status()));
 function parseJwt(value){
  try{const part=value.split('.')[1];const b=part.replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(atob(b.padEnd(Math.ceil(b.length/4)*4,'=')))}catch{return null}
 }
 function receive(response){
  const value=typeof response?.credential==='string'?response.credential:'';
  const claims=parseJwt(value);
  // Parsing JWT is ONLY for UI display. Server must verify the signature,
  // issuer, audience, expiry, user and household for every request.
  if(!claims||claims.aud!==clientId||!claims.sub||Number(claims.exp)*1000<=Date.now()){signOut();return}
  token=value;subject=claims.sub;expires=Math.min(Number(claims.exp)*1000,Date.now()+55*60*1000);
  notify();
 }
 function configure(value,options={}){
  manualOnly=options.manualOnly===true;
  clientId=typeof value==='string'&&/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(value)?value:'';
  initialized=false;buttonElement=null;signOut();
 }
 function initialize(){
  if(initialized)return true;
  if(!clientId||!window.google?.accounts?.id)return false;
  window.google.accounts.id.initialize({client_id:clientId,callback:receive,auto_select:!manualOnly,cancel_on_tap_outside:true,...(manualOnly?{use_fedcm_for_button:true}:{})});
  initialized=true;return true;
 }
 function signIn(){
  if(!initialize())return false;
  const el=document.getElementById('google-login-button');
  if(!el)return false;
  if(buttonElement===el)return true;
  el.replaceChildren();
  window.google.accounts.id.renderButton(el,{theme:'outline',size:'large',text:'signin_with',width:240});
  buttonElement=el;
  return true;
 }
 function restore(){
  if(!initialize())return false;
  window.google.accounts.id.prompt();
  return true;
 }
 function signOut(){
  const previous=subject;
  token=null;subject=null;expires=0;
  if(previous&&window.google?.accounts?.id)window.google.accounts.id.disableAutoSelect();
  notify();
 }
 function getToken(){if(!token||Date.now()>=expires){token=null;subject=null;return null}return token}
 function subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)}
 window.KurashiAuth={configure,signIn,restore,signOut,getToken,status,subscribe};
 window.addEventListener('load',()=>{if(clientId&&!manualOnly)restore()});
})();
